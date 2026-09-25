import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {FieldDefinition} from '../../../common/contracts';
import type {AssemblyEdge,BookAssembly,CardTemplateGraph} from '../../../common/cardAssembly';
import {validateBookAssembly,validateCardTemplateGraph} from '../../../common/cardAssembly';
import {fieldDefinitionSchema} from '../../domain/validation';
import {NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard,type RecordCardRow} from '../recordCards';

const SYSTEM_SPACE_ID='00000000-0000-4000-8000-000000000001';
type Kind='meta_card'|'card_template';
type DefinitionInput={id?:string;key:string;name:string;description:string;category:string;kind?:'book_root'|'ordinary';fields?:FieldDefinition[];graph?:CardTemplateGraph;expectedRevision?:number};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keyPattern=/^[a-z][a-z0-9_]{1,63}$/;

async function transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await(await getNewDesignPool()).connect();
  try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result}
  catch(error){await client.query('ROLLBACK');throw error}
  finally{client.release()}
}

function publicDefinition(row:RecordCardRow){return{
  id:row.id,key:String(row.definition_key),name:String(row.name),description:String(row.description??''),category:String(row.category??''),
  kind:row.kind??'ordinary',fields:row.draft_fields??[],graph:row.draft_graph??{slots:[],edges:[]},
  status:row.status,revision:Number(row.revision),currentVersionId:row.current_version_id??null,
}}

export async function listDefinitions(kind:Kind){return(await listRecordCards(await getNewDesignPool(),kind)).map(publicDefinition)}
export async function listDefinitionVersions(kind:Kind,id:string){
  const type=kind==='meta_card'?'meta_card_version':'card_template_version';
  const field=kind==='meta_card'?'meta_id':'template_id';
  return(await listRecordCards(await getNewDesignPool(),type,{where:{[field]:id}})).map(row=>({
    id:row.id,version:Number(row.version),metaId:row.meta_id,templateId:row.template_id,
    fields:row.fields,graph:row.graph,cardTypeId:row.card_type_id,cardTypeVersionId:row.card_type_version_id,
    contentHash:row.content_hash,createdAt:row.created_at,
  })).sort((a,b)=>b.version-a.version);
}

export async function saveDefinition(kind:Kind,input:DefinitionInput){return transaction(async client=>{
  if(!keyPattern.test(input.key))throw new NewDesignError('稳定 key 须以小写字母开头，只含小写字母、数字和下划线。',422);
  if(!input.name.trim())throw new NewDesignError('名称不能为空。',422);
  if(kind==='meta_card'){
    const fields=input.fields??[];
    const keys=new Set<string>();
    for(const field of fields){if(!fieldDefinitionSchema.strict().safeParse(field).success)throw new NewDesignError(`字段“${field.key}”的规格不完整。`,422);if(keys.has(field.key))throw new NewDesignError(`字段 key“${field.key}”重复。`,422);keys.add(field.key)}
  }
  const id=input.id??randomUUID(),now=new Date().toISOString();
  const values={name:input.name.trim(),description:input.description,category:input.category,
    ...(kind==='meta_card'?{kind:input.kind??'ordinary',draft_fields:input.fields??[]}:{draft_graph:input.graph??{slots:[],edges:[]}})};
  if(input.id){
    const prior=await findRecordCard(client,id,kind,{lock:true});
    if(!prior)throw new NewDesignError('定义不存在。',404);
    if(prior.definition_key!==input.key)throw new NewDesignError('发布后的稳定 key 不能更改。',422);
    if(Number(prior.revision)!==input.expectedRevision)throw new NewDesignError('定义已变化，请重新读取后再保存。',409);
    return publicDefinition(await replaceRecordCard(client,{id,spaceId:SYSTEM_SPACE_ID,typeKey:kind,title:values.name,values:{...prior,...values,revision:prior.revision+1,updated_at:now}}));
  }
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${kind}:${input.key}`]);
  if((await listRecordCards(client,kind,{includeArchived:true,where:{definition_key:input.key}})).length)throw new NewDesignError('稳定 key 已存在。',409);
  return publicDefinition(await createRecordCard(client,{id,spaceId:SYSTEM_SPACE_ID,typeKey:kind,title:values.name,values:{id,definition_key:input.key,...values,status:'draft',revision:1,current_version_id:null,created_at:now,updated_at:now}}));
})}

async function snapshotRelationVersions(client:PoolClient):Promise<Set<string>>{
  const result=await client.query("SELECT id FROM new_design.relation_type_versions WHERE status='published'");
  return new Set(result.rows.map(row=>String(row.id)));
}

async function assertRelationEndpoints(client:PoolClient,nodes:Array<{id:string;metaVersionId:string}>,edges:AssemblyEdge[],metaById:Map<string,RecordCardRow>){
  const typed=await client.query(`SELECT version.id,type.type_key FROM new_design.card_type_versions version
    JOIN new_design.card_types type ON type.id=version.card_type_id WHERE version.id=ANY($1::uuid[])`,
    [nodes.map(node=>metaById.get(node.metaVersionId)?.card_type_version_id).filter(Boolean)]);
  const typeByVersion=new Map(typed.rows.map(row=>[String(row.id),String(row.type_key)]));
  const typeByNode=new Map(nodes.map(node=>[node.id,typeByVersion.get(String(metaById.get(node.metaVersionId)?.card_type_version_id))]));
  const selected=edges.filter(edge=>edge.kind==='card_relation');
  const rules=await client.query('SELECT * FROM new_design.relation_type_versions WHERE id=ANY($1::uuid[])',[selected.map(edge=>edge.relationTypeVersionId).filter(Boolean)]);
  const ruleById=new Map(rules.rows.map(row=>[String(row.id),row]));
  for(const edge of selected){
    const source=typeByNode.get(edge.from),target=typeByNode.get(edge.to),rule=ruleById.get(String(edge.relationTypeVersionId));
    if(!source||!target||!rule)throw new NewDesignError('关系连线的卡片类型或关系版本无法解析。',422,{[`edges.${edge.id}`]:'请检查两端元卡片和关系类型的发布版本。'});
    const fits=(left:string,right:string)=>((rule.source_type_keys as string[]).length===0||(rule.source_type_keys as string[]).includes(left))&&((rule.target_type_keys as string[]).length===0||(rule.target_type_keys as string[]).includes(right));
    if(!fits(source,target)&&!(rule.direction==='undirected'&&fits(target,source)))throw new NewDesignError(`关系“${rule.name}”不能连接所选两种元卡片。`,422,{[`edges.${edge.id}`]:'请选择允许这两个卡片类型的关系。'});
  }
}

export async function listAssemblyRelationTypes(){
  const result=await(await getNewDesignPool()).query(`SELECT version.id,version.relation_type_id,version.relation_key,version.name,version.direction
    FROM new_design.relation_type_versions version WHERE version.status='published' ORDER BY version.name,version.version DESC`);
  return result.rows;
}

export async function publishDefinition(kind:Kind,id:string,expectedRevision:number){return transaction(async client=>{
  const prior=await findRecordCard(client,id,kind,{lock:true});
  if(!prior)throw new NewDesignError('定义不存在。',404);
  if(Number(prior.revision)!==expectedRevision)throw new NewDesignError('定义已变化，请重新读取后再发布。',409);
  const versionKind=kind==='meta_card'?'meta_card_version':'card_template_version';
  const foreignKey=kind==='meta_card'?'meta_id':'template_id';
  const versions=await listRecordCards(client,versionKind,{where:{[foreignKey]:id}});
  const version=Math.max(0,...versions.map(row=>Number(row.version)))+1;
  const versionId=randomUUID(),now=new Date().toISOString();
  let frozen:Record<string,unknown>;
  if(kind==='meta_card'){
    const fields=prior.draft_fields as FieldDefinition[];
    if(!fields?.length)throw new NewDesignError('元卡片至少需要一个字段。',422);
    if(prior.kind==='book_root'){
      const common={bookName:'short_text',description:'long_text',storyFormat:'select',targetWordCount:'number',genre:'short_text',styleKeywords:'short_text',targetAudience:'short_text'} as const;
      for(const [key,type] of Object.entries(common))if(!fields.some(field=>field.key===key&&field.type===type))throw new NewDesignError(`书籍信息根卡缺少通用字段 ${key}，或字段类型不符。`,422);
      if(!fields.find(field=>field.key==='bookName')?.required)throw new NewDesignError('书名必须是根卡必填字段。',422);
    }
    const typeKey=`meta_${prior.definition_key}`;
    let type=await client.query('SELECT id FROM new_design.card_types WHERE space_id=$1 AND type_key=$2 FOR UPDATE',[SYSTEM_SPACE_ID,typeKey]);
    const cardTypeId=type.rows[0]?.id??randomUUID(),cardTypeVersionId=randomUUID();
    if(!type.rows.length)await client.query(`INSERT INTO new_design.card_types(id,space_id,type_key,name,description,status,revision,draft_fields,is_system,is_internal)
      VALUES($1,$2,$3,$4,$5,'published',1,$6::jsonb,true,false)`,[cardTypeId,SYSTEM_SPACE_ID,typeKey,prior.name,prior.description,JSON.stringify(fields)]);
    await client.query('INSERT INTO new_design.card_type_versions(id,card_type_id,version,fields) VALUES($1,$2,$3,$4::jsonb)',[cardTypeVersionId,cardTypeId,version,JSON.stringify(fields)]);
    await client.query(`UPDATE new_design.card_types SET name=$2,description=$3,draft_fields=$4::jsonb,current_version_id=$5,status='published',revision=revision+1 WHERE id=$1`,[cardTypeId,prior.name,prior.description,JSON.stringify(fields),cardTypeVersionId]);
    frozen={fields,card_type_id:cardTypeId,card_type_version_id:cardTypeVersionId,kind:prior.kind};
  }else{
    const graph=prior.draft_graph as CardTemplateGraph;
    const metas=await listRecordCards(client,'meta_card_version');
    const issues=validateCardTemplateGraph(graph,new Set(metas.map(row=>row.id)),await snapshotRelationVersions(client));
    if(issues.length)throw new NewDesignError('卡片模板不能发布，请修正图结构。',422,Object.fromEntries(issues.map(item=>[item.path,item.message])));
    await assertRelationEndpoints(client,graph.slots,graph.edges,new Map(metas.map(row=>[row.id,row])));
    frozen={graph};
  }
  await createRecordCard(client,{id:versionId,spaceId:SYSTEM_SPACE_ID,typeKey:versionKind,title:String(prior.name),values:{id:versionId,[foreignKey]:id,version,...frozen,content_hash:hash(frozen),created_at:now}});
  const updated=await replaceRecordCard(client,{id,spaceId:SYSTEM_SPACE_ID,typeKey:kind,values:{...prior,status:'published',current_version_id:versionId,revision:prior.revision+1,updated_at:now}});
  return{definition:publicDefinition(updated),version:{id:versionId,version,...frozen}};
})}

export async function resolveBookAssembly(client:PoolClient,assembly:BookAssembly){
  const metas=await listRecordCards(client,'meta_card_version');
  const templates=await listRecordCards(client,'card_template_version');
  const metaById=new Map(metas.map(row=>[row.id,row]));
  const templateById=new Map(templates.map(row=>[row.id,row]));
  const issues=validateBookAssembly(assembly,new Set(templateById.keys()),new Set(metaById.keys()),await snapshotRelationVersions(client));
  if(issues.length)throw new NewDesignError('书籍模板装配图无效。',422,Object.fromEntries(issues.map(item=>[item.path,item.message])));
  const root=metaById.get(assembly.root.metaVersionId)!;
  if(root.kind!=='book_root')throw new NewDesignError('根节点必须使用书籍信息元卡片。',422);
  if(!(root.fields as FieldDefinition[]).some(field=>field.key==='bookName'&&field.required))throw new NewDesignError('书籍信息元卡片须包含必填 bookName 字段。',422);
  for(const module of assembly.modules){const version=templateById.get(module.cardTemplateVersionId)!;
    if(String(version.template_id)!==module.cardTemplateId)throw new NewDesignError('模块版本与卡片模板不匹配。',422);
    const graph=version.graph as CardTemplateGraph;
    const internalIssues=validateCardTemplateGraph(graph,new Set(metaById.keys()),await snapshotRelationVersions(client));
    if(internalIssues.length)throw new NewDesignError('引用的卡片模板版本含失效来源。',422,Object.fromEntries(internalIssues.map(item=>[item.path,item.message])));
    await assertRelationEndpoints(client,graph.slots,graph.edges,metaById);
  }
  await assertRelationEndpoints(client,[{id:assembly.root.id,metaVersionId:assembly.root.metaVersionId},...assembly.standalone],assembly.edges,metaById);
  return{metaById,templateById};
}
