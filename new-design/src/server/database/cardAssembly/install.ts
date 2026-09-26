import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {BookAssembly,CardTemplateGraph,ModuleInstance} from '../../../common/cardAssembly';
import {instantiateModule,planBookInstances} from '../../../common/cardAssembly';
import {NewDesignError} from '../../domain/errors';
import {createCardInTransaction} from '../store';
import {createRecordCard,listRecordCards} from '../recordCards';

export interface AssemblySnapshotPayload {
  assembly?:BookAssembly;
  assemblyGraphs?:Record<string,CardTemplateGraph>;
  cardTypes:Array<{key:string;sourceVersionId:string}>;
}

async function createModuleInstanceRecords(client:PoolClient,input:{bookId:string;spaceId:string;moduleRefNodeId:string;instance:ModuleInstance}){
  const instance=input.instance;
  const groupId=randomUUID(),groupVersionId=randomUUID(),groupName=`卡片组 ${instance.ordinal}`;
  await createRecordCard(client,{id:groupId,spaceId:input.spaceId,typeKey:'material_group',title:groupName,values:{id:groupId,space_id:input.spaceId,book_id:input.bookId,group_key:`assembly_${instance.id.replaceAll('-','')}`,name:groupName,parent_id:null,sort_order:instance.ordinal,visibility:'space',revision:1,current_version_id:groupVersionId,status:'active',created_by:'user'}});
  await createRecordCard(client,{id:groupVersionId,spaceId:input.spaceId,typeKey:'material_group_version',title:groupName,values:{id:groupVersionId,group_id:groupId,version:1,name:groupName,parent_id:null,sort_order:instance.ordinal,status:'active',created_by:'user'}});
  await client.query('SELECT new_design.register_dependency_resource($1,$2,$3)',['material_group_version',groupId,groupVersionId]);
  await createRecordCard(client,{id:instance.id,spaceId:input.spaceId,typeKey:'book_template_module_instance',title:`模块实例 ${instance.ordinal}`,values:{id:instance.id,book_id:input.bookId,module_ref_node_id:input.moduleRefNodeId,source_card_template_version_id:instance.sourceCardTemplateVersionId,group_id:groupId,ordinal:instance.ordinal,status:'active'}});
  for(const slot of instance.slots)await createRecordCard(client,{id:slot.id,spaceId:input.spaceId,typeKey:'book_template_slot',title:`待填槽位 ${instance.ordinal}`,values:{id:slot.id,book_id:input.bookId,node_id:slot.nodeId,module_instance_id:instance.id,source_node_id:slot.sourceSlotId,meta_version_id:slot.metaVersionId,required:slot.required,card_id:null,status:'pending'}});
  for(const edge of instance.edges)await createRecordCard(client,{id:edge.id,spaceId:input.spaceId,typeKey:'book_template_pending_relation',title:edge.label??'待绑定关系',values:{id:edge.id,book_id:input.bookId,module_instance_id:instance.id,source_edge_id:edge.sourceEdgeId,from_node_id:edge.fromNodeId,to_node_id:edge.toNodeId,relation_type_version_id:edge.relationTypeVersionId??null,required:edge.required??false,label:edge.label??'',status:'pending',relation_id:null}});
}

export async function installBookAssembly(client:PoolClient,input:{bookId:string;spaceId:string;templateVersionId:string;bookName:string;description:string;rootValues?:Record<string,unknown>;payload:AssemblySnapshotPayload}){
  const {assembly,assemblyGraphs}=input.payload;
  if(!assembly)return null;
  if(!assemblyGraphs)throw new NewDesignError('书籍模板缺少冻结的模块图，无法安装。',422);
  // The payload card type stores the projected card-type version; the root
  // meta version ID is resolved from the published snapshot record below.
  const metaVersions=await listRecordCards(client,'meta_card_version',{includeArchived:true});
  const rootMeta=metaVersions.find(row=>row.id===assembly.root.metaVersionId);
  if(!rootMeta)throw new NewDesignError('书籍根卡的冻结元卡片版本不存在。',422);
  const typePayload=input.payload.cardTypes.find(type=>type.sourceVersionId===rootMeta.card_type_version_id);
  if(!typePayload)throw new NewDesignError('书籍根卡的类型未安装到模板快照。',422);
  const rootType=(await client.query('SELECT id FROM new_design.card_types WHERE space_id=$1 AND type_key=$2',[input.spaceId,typePayload.key])).rows[0];
  if(!rootType)throw new NewDesignError('书籍根卡类型安装失败。',500);
  const fieldKeys=new Set((rootMeta.fields as Array<{key:string}>).map(field=>field.key));
  const values:Record<string,unknown>={};
  if(fieldKeys.has('bookName'))values.bookName=input.bookName;
  else if(fieldKeys.has('name'))values.name=input.bookName;
  else throw new NewDesignError('书籍信息元卡片缺少稳定书名字段 bookName。',422);
  if(fieldKeys.has('description'))values.description=input.description;
  for(const [key,value] of Object.entries(input.rootValues??{}))if(fieldKeys.has(key))values[key]=value;
  const storyFormat=input.rootValues?.storyFormat;
  if(storyFormat&&typeof storyFormat==='object'&&!Array.isArray(storyFormat)){
    const format=storyFormat as Record<string,unknown>;
    if(fieldKeys.has('storyFormat')&&typeof format.form==='string')values.storyFormat=format.form;
    if(fieldKeys.has('targetWordCount')&&typeof format.targetWordCount==='number')values.targetWordCount=format.targetWordCount;
  }
  // The book row and its formal root card share one source of truth at creation.
  values.bookName=input.bookName;
  if(fieldKeys.has('description'))values.description=input.description;
  const saved=await createCardInTransaction(client,{spaceId:input.spaceId,cardTypeId:String(rootType.id),title:input.bookName,values});
  await client.query('UPDATE new_design.books SET root_card_id=$2,root_node_id=$3 WHERE id=$1',[input.bookId,saved.id,assembly.root.id]);
  await createRecordCard(client,{spaceId:input.spaceId,typeKey:'book_assembly_snapshot',title:'本书结构快照',values:{book_id:input.bookId,source_template_version_id:input.templateVersionId,assembly,assembly_graphs:assemblyGraphs,root_card_id:saved.id,root_node_id:assembly.root.id}});
  const installedNodes=new Map<string,string>([[assembly.root.id,assembly.root.id]]);
  for(const slot of assembly.standalone){const nodeId=randomUUID();installedNodes.set(slot.id,nodeId);await createRecordCard(client,{spaceId:input.spaceId,typeKey:'book_template_slot',title:'待填独立元卡片',values:{book_id:input.bookId,node_id:nodeId,source_node_id:slot.id,meta_version_id:slot.metaVersionId,module_instance_id:null,required:slot.required,card_id:null,status:'pending'}})}
  for(const edge of assembly.edges.filter(item=>item.kind==='card_relation')){
    const fromNodeId=installedNodes.get(edge.from),toNodeId=installedNodes.get(edge.to);
    if(!fromNodeId||!toNodeId)throw new NewDesignError('书籍模板资料关系缺少可实例化端点。',422);
    await createRecordCard(client,{spaceId:input.spaceId,typeKey:'book_template_pending_relation',title:edge.label??'待绑定关系',values:{book_id:input.bookId,module_instance_id:null,source_edge_id:edge.id,from_node_id:fromNodeId,to_node_id:toNodeId,relation_type_version_id:edge.relationTypeVersionId??null,required:edge.required??false,label:edge.label??'',status:'pending',relation_id:null}});
  }
  for(const instance of planBookInstances(assembly.modules,assemblyGraphs,randomUUID))await createModuleInstanceRecords(client,{bookId:input.bookId,spaceId:input.spaceId,moduleRefNodeId:instance.moduleRefNodeId,instance});
  return{rootCardId:saved.id};
}

export async function addBookModuleInstance(client:PoolClient,input:{bookId:string;moduleRefNodeId:string}){
  const book=(await client.query('SELECT space_id,installed_payload FROM new_design.books WHERE id=$1 FOR UPDATE',[input.bookId])).rows[0];
  if(!book)throw new NewDesignError('书籍不存在。',404);
  const payload=book.installed_payload as AssemblySnapshotPayload;
  const module=payload.assembly?.modules.find(item=>item.id===input.moduleRefNodeId);
  if(!module)throw new NewDesignError('这本书没有该卡片模板模块。',404);
  const graph=payload.assemblyGraphs?.[module.cardTemplateVersionId];
  if(!graph)throw new NewDesignError('模块的冻结图不存在。',422);
  const instances=await listRecordCards(client,'book_template_module_instance',{spaceId:String(book.space_id),where:{book_id:input.bookId,module_ref_node_id:module.id}});
  const ordinal=Math.max(0,...instances.map(row=>Number(row.ordinal)))+1;
  const instance=instantiateModule(module,graph,ordinal,randomUUID);
  await createModuleInstanceRecords(client,{bookId:input.bookId,spaceId:String(book.space_id),moduleRefNodeId:module.id,instance});
  return instance;
}
