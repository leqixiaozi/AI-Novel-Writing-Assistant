import { randomUUID } from "node:crypto";
import { getNewDesignPool } from "../runtime";
import { getDictionary, listDictionaries, saveDictionary } from "../compositionStore";
import { createMaterialTag } from "../materialManagement";
import { saveTagDimension, listTagDimensions } from "../treeResources";
import { getBusinessFormAi } from "./store";
import { freezeFormContext } from "./context";
import { NewDesignError, assertFound } from "../../domain/errors";
import { selectableTreeNodeIds } from "../../../common/treePolicy";
import {findRecordCard,listRecordCards} from "../recordCards";

// This explicit author confirmation creates only book-owned resources. Global sources are copied, not changed.
export async function confirmFormAiNewNode(bookId:string,runId:string,input:{suggestionId:string;name:string;idempotencyKey:string}):Promise<{nodeId:string;requiresBinding:boolean;message:string}>{
  const pool=await getNewDesignPool(),run=await getBusinessFormAi(bookId,runId),suggestion=assertFound(run.newNodes.find(item=>item.id===input.suggestionId),"新增建议不存在。"),tree=assertFound(run.snapshot.trees.find(item=>item.key===suggestion.treeKey),"建议的选项范围不存在。");
  const book=assertFound((await pool.query("SELECT space_id FROM new_design.books WHERE id=$1",[bookId])).rows[0],"本书不存在。");
  const key=`ai_${suggestion.id.replaceAll("-","")}`;
  // Stable suggestion identity permits retry after an uncertain network response, without another node.
  if(tree.kind==="dictionary"){
    const definitions=(await listRecordCards(pool,"dictionary_definition",{spaceId:String(book.space_id),includeArchived:true})).filter(item=>String(item.owner_space_id)===String(book.space_id)),existing=(await listRecordCards(pool,"dictionary_item",{includeArchived:true})).find(item=>item.item_key===key&&definitions.some(definition=>String(definition.id)===String(item.dictionary_id)));
    if(existing){if(existing.label!==input.name)throw new NewDesignError("此建议已按其他名称确认，请直接编辑书内选项。",409);return {nodeId:existing.id,requiresBinding:tree.scope!=="book",message:"书内选项已创建，请重新生成建议以使用最新范围。"};}
  }else {const tags=await listRecordCards(pool,"material_tag",{spaceId:String(book.space_id),includeArchived:true,where:{tag_key:key}}),tag=tags[0],version=tag?await findRecordCard(pool,String(tag.current_version_id),'material_tag_version',{includeArchived:true}):null;if(tag&&version){if(version.name!==input.name)throw new NewDesignError("此建议已按其他名称确认，请直接编辑书内标签。",409);return {nodeId:tag.id,requiresBinding:tree.scope!=="book",message:"书内标签已创建，请重新生成建议。"};}}
  if(run.status!=="review"||!tree.rule.aiSuggestible||!tree.rule.allowInlineCreate)throw new NewDesignError("该范围不允许原地新增，请到创作资源中维护书内选项。",422);
  const current=await freezeFormContext(pool,run.snapshot.target,run.snapshot.values,run.snapshot.tagIds,run.snapshot.referenceCardIds??[],run.snapshot.referenceKnowledgeSources??[]);if(current.sourceHash!==run.snapshot.sourceHash)throw new NewDesignError("建议来源已变化，请重新生成后确认新增。",409);
  const nodeId=randomUUID(),proposed={id:nodeId,parentId:suggestion.parentId,name:input.name,status:"active" as const};
  if(!selectableTreeNodeIds([...tree.nodes,proposed],tree.rule).has(nodeId))throw new NewDesignError("新增位置不满足当前分支或层级限制，请到书内选项树维护。",422);
  if(tree.kind==="dictionary"){
    const source=await getDictionary(tree.sourceId),copy=source.scope!=="book"||source.ownerSpaceId!==book.space_id;
    if(source.readOnly&&!copy)throw new NewDesignError("系统固定语义不能通过 AI 新增。",422);
    let items=source.items.map(item=>({...item})),parentId=suggestion.parentId;
    if(copy){const mapping=new Map(items.map(item=>[item.id,randomUUID()]));items=items.map(item=>({...item,id:mapping.get(item.id)!,parentId:item.parentId?mapping.get(item.parentId)!:null}));parentId=parentId?mapping.get(parentId)??null:null;}
    items.push({id:nodeId,key,label:input.name,description:"经作者确认的 AI 选项建议",parentId,value:{},sortOrder:items.length*10+10,status:"active",revision:1,currentVersionId:null,path:[],childCount:0,referenceCount:0});
    if(copy){const previous=(await listDictionaries(book.space_id)).find(item=>item.key===`copy_${key}`);await saveDictionary({id:previous?.id,key:`copy_${key}`,name:`${source.name}（本书）`,description:source.description,scope:"book",ownerSpaceId:book.space_id,revision:previous?.revision,readOnly:false,items});}
    else await saveDictionary({...source,items});
    return {nodeId,requiresBinding:copy,message:copy?"已建立本书独立选项树。请在内容类型中选择该书内字典后使用；系统资源没有改变。":"书内选项已创建，请重新生成建议以使用最新范围。"};
  }
  const dimensions=await listTagDimensions(book.space_id);let dimension=dimensions.find(item=>item.id===tree.sourceId),copy=!dimension;
  if(copy)dimension=await saveTagDimension({name:`${tree.name}（本书）`,description:"经作者确认的独立标签维度",scope:"book",ownerSpaceId:book.space_id,readOnly:false});
  if(dimension?.readOnly)throw new NewDesignError("这个标签维度只读，请先创建书内副本。",422);
  const saved=await createMaterialTag({bookId},{key,name:input.name,aliases:[],metadata:{description:"经作者确认的 AI 标签建议"},dimensionId:dimension!.id,parentId:copy?null:suggestion.parentId,sortOrder:1000,idempotencyKey:`form-node:${suggestion.id}`});
  return {nodeId:saved.id,requiresBinding:copy,message:copy?"已建立本书标签。请在内容类型中绑定本书标签维度后使用；系统资源没有改变。":"书内标签已创建，请重新生成建议。"};
}
