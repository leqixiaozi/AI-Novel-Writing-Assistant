import type { ContextAuthorCatalog, ContextAuthorSource } from "../../../common/contextAuthor";
import { NewDesignError, assertFound } from "../../domain/errors";
import { getNewDesignPool } from "../runtime";
import {listRecordCards,findRecordCard} from "../recordCards";
import {readReadyKnowledgeRows} from "../knowledgeReference/content";
import {readRecipeSlots} from "../aiContracts/records";

export async function getContextAuthorCatalog(bookId:string):Promise<ContextAuthorCatalog>{
  const pool=await getNewDesignPool(),book=assertFound((await pool.query("SELECT space_id,status FROM new_design.books WHERE id=$1",[bookId])).rows[0],"书籍不存在。");
  if(book.status!=="active")throw new NewDesignError("请先恢复书籍，再编辑参考资料规则。",409);
  const spaceId=String(book.space_id),sources:ContextAuthorSource[]=[];let truncated=false;
  const boundedRows=<T>(rows:T[])=>{if(rows.length>200)truncated=true;return rows.slice(0,200);};
  const bounded=async(sql:string,params:unknown[])=>{const rows=(await pool.query(sql+" LIMIT 201",params)).rows;if(rows.length>200)truncated=true;return rows.slice(0,200);};
  const assets=await readReadyKnowledgeRows(pool,bookId);if(assets.length>100)truncated=true;
  for(const row of assets.slice(0,100)){const version=(await pool.query("SELECT version FROM new_design.asset_versions WHERE id=$1",[row.parsed_version_id])).rows[0];if(version)sources.push({kind:"asset_version",stableId:String(row.parsed_asset_id),versionId:String(row.parsed_version_id),revision:Number(version.version),label:String(row.title),current:true});}
  const types=await bounded("SELECT type_key id,name label FROM new_design.card_types WHERE space_id=$1 AND status='published' AND NOT is_internal ORDER BY name",[spaceId]);
  const scopes=await bounded("SELECT card.id,card.title label,type.type_key kind FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.space_id=$1 AND card.status='active' AND type.type_key=ANY($2::text[]) ORDER BY card.title",[spaceId,["volume","chapter","scene"]]);
  const cards=await bounded(`SELECT card.id stable_id,version.id version_id,version.revision,version.title label,type.type_key,card.current_version_id=version.id current
    FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.card_versions version ON version.card_id=card.id WHERE card.status='active' AND NOT type.is_internal
    AND (card.space_id=$1 OR (type.type_key='prompt_component' AND NOT EXISTS(SELECT 1 FROM new_design.books owner WHERE owner.space_id=card.space_id))) ORDER BY card.title,version.revision DESC`,[spaceId]);
  sources.push(...cards.map(row=>({kind:row.type_key==="prompt_component"?"prompt_component" as const:"card_version" as const,stableId:String(row.stable_id),versionId:String(row.version_id),revision:Number(row.revision),label:String(row.label),current:Boolean(row.current)})));
  const bodies=await bounded(`SELECT document.id stable_id,version.id version_id,version.version revision,document.title label,document.revision document_revision,document.adopted_version_id,document.adopted_version_id=version.id current
    FROM new_design.chapter_documents document JOIN new_design.chapter_body_versions version ON version.chapter_document_id=document.id WHERE document.book_id=$1 AND document.status='active' ORDER BY document.logical_order,version.version DESC`,[bookId]);
  sources.push(...bodies.map(row=>({kind:"body_version" as const,stableId:String(row.stable_id),versionId:String(row.version_id),revision:Number(row.revision),label:String(row.label),current:Boolean(row.current),checkpoint:{chapterDocumentId:row.stable_id,documentRevision:Number(row.document_revision),...(row.adopted_version_id?{bodyVersionId:row.adopted_version_id}:{})}})));
  const objects=await listRecordCards(pool,"planning_object",{where:{book_id:bookId}}),planRows:Record<string,any>[]=[];
  for(const object of objects){if(object.status==="archived")continue;for(const version of await listRecordCards(pool,"planning_version",{where:{object_id:object.id}})){if(version.status!=="rejected")planRows.push({kind:"planning_version",stableId:object.id,versionId:version.id,revision:Number(version.version),label:String(object.title),current:object.adopted_version_id===version.id});}}
  sources.push(...boundedRows(planRows.sort((a,b)=>a.label.localeCompare(b.label)||b.revision-a.revision)) as ContextAuthorSource[]);
  for(const [kind,type,label]of [["canonical_fact","canonical_fact","已确认事实"],["state_change","state_change","状态变化"],["knowledge_state_change","knowledge_state_change","认知变化"],["story_time","story_event_timing","故事时间"],["story_event_relation","story_event_relation","事件关系"]] as const){
    const rows=await listRecordCards(pool,type,{where:{book_id:bookId,status:type==="canonical_fact"?"confirmed":"active"}});
    rows.sort((a,b)=>type==="canonical_fact"?String(b.created_at).localeCompare(String(a.created_at)):Number(b.sequence)-Number(a.sequence));
    sources.push(...boundedRows(rows).map(row=>({kind,stableId:String(kind==="knowledge_state_change"||kind==="story_event_relation"?row.proposal_id:row.id),versionId:row.id,revision:Number(kind==="canonical_fact"?row.revision:row.sequence),label:kind==="story_time"?String(row.start_label??label):label,current:true})));
  }
  const references=await listRecordCards(pool,"book_research_reference",{where:{book_id:bookId}}),researchIds=new Set<string>();
  for(const reference of references){if(reference.research_version_id)researchIds.add(String(reference.research_version_id));if(reference.pack_version_id)for(const item of await listRecordCards(pool,"research_reference_pack_item",{where:{pack_version_id:reference.pack_version_id}}))researchIds.add(String(item.research_version_id));}
  const researchRows:ContextAuthorSource[]=[],documentIds=new Set<string>();
  for(const id of researchIds){
    const version=await findRecordCard(pool,id,"research_record_version");if(!version)continue;
    const record=await findRecordCard(pool,String(version.record_id),"research_record");if(!record)continue;
    if(record.source_document_version_id)documentIds.add(String(record.source_document_version_id));
    if(record.status==="active"&&["completed","partial"].includes(version.run_status))researchRows.push({kind:"research_version",stableId:record.id,versionId:version.id,revision:Number(version.version),label:String(record.title),current:record.current_version_id===version.id});
  }
  sources.push(...boundedRows(researchRows.sort((a,b)=>a.label.localeCompare(b.label)||b.revision-a.revision)));
  const docs=await bounded("SELECT document.id stable_id,version.id version_id,version.version revision,document.title label,document.current_version_id=version.id current FROM new_design.research_documents document JOIN new_design.research_document_versions version ON version.document_id=document.id WHERE version.id=ANY($1::uuid[]) AND document.status='active' ORDER BY document.title,version.version DESC",[[...documentIds]]);
  sources.push(...docs.map(row=>({kind:"research_document_version" as const,stableId:String(row.stable_id),versionId:String(row.version_id),revision:Number(row.revision),label:String(row.label),current:Boolean(row.current)})));
  const packRows:Array<{id:string;label:string;stable_id:string;revision:number;current:boolean}>=[];
  for(const id of new Set(references.map(ref=>ref.pack_version_id).filter(Boolean))){
    const version=await findRecordCard(pool,String(id),"research_reference_pack_version");if(!version)continue;
    const pack=await findRecordCard(pool,String(version.pack_id),"research_reference_pack");if(pack?.status==="published")packRows.push({id:version.id,label:String(pack.name),stable_id:pack.id,revision:Number(version.version),current:pack.current_version_id===version.id});
  }
  const packs=boundedRows(packRows.sort((a,b)=>a.label.localeCompare(b.label)||b.revision-a.revision));
  sources.push(...packs.map(row=>({kind:"research_pack_version" as const,stableId:row.stable_id,versionId:row.id,revision:row.revision,label:row.label,current:row.current})));
  const tagRows:Record<string,unknown>[]=[],dimensions=new Map((await listRecordCards(pool,"material_tag_dimension",{where:{status:"active"}})).map(row=>[row.id,row]));
  for(const tag of await listRecordCards(pool,"material_tag",{where:{status:"active"}})){
    const dimension=dimensions.get(String(tag.dimension_id));if(!dimension||!(dimension.owner_space_id===null||dimension.owner_space_id===spaceId))continue;
    const version=await findRecordCard(pool,String(tag.current_version_id),"material_tag_version");if(version)tagRows.push({id:tag.id,label:version.name,parent_id:tag.parent_id});
  }
  const tags=boundedRows(tagRows.sort((a,b)=>String(a.label).localeCompare(String(b.label)))),viewRows:Record<string,unknown>[]=[];
  for(const view of await listRecordCards(pool,"smart_view",{where:{book_id:bookId,status:"active"}})){const version=await findRecordCard(pool,String(view.current_version_id),"smart_view_version");if(version)viewRows.push({id:view.id,label:version.name});}
  const views=boundedRows(viewRows.sort((a,b)=>String(a.label).localeCompare(String(b.label))));
  const relations=await bounded("SELECT id,name label FROM new_design.relation_types WHERE status='published' AND (owner_space_id=$1 OR owner_space_id IS NULL) ORDER BY name",[spaceId]);
  const retrievals=await bounded("SELECT id,COALESCE(NULLIF(query_summary,''),'参考资料检索') label FROM new_design.retrieval_runs WHERE book_id=$1 AND status='succeeded' ORDER BY created_at DESC",[bookId]);
  const spaces=await bounded("SELECT space.id,space.name label FROM new_design.card_spaces space WHERE NOT EXISTS(SELECT 1 FROM new_design.books owner WHERE owner.space_id=space.id) ORDER BY space.name",[]);
  const tasks=await bounded(`SELECT contract.task_key id,contract.name label,version.task_group group_key FROM new_design.task_contracts contract JOIN new_design.task_contract_versions version ON version.id=contract.published_version_id WHERE contract.status='active' ORDER BY contract.name`,[]);
  const groups=[...new Map(tasks.map(task=>[String(task.group_key),{id:String(task.group_key),label:`${String(task.label)}相关任务`}])).values()];
  const publishedRecipes=(await pool.query("SELECT version.prompt_recipe_version_id FROM new_design.task_contracts contract JOIN new_design.task_contract_versions version ON version.id=contract.published_version_id WHERE contract.status='active'")).rows,slotRows:Array<{id:string;label:string}>=[];
  for(const recipeId of new Set(publishedRecipes.map(row=>String(row.prompt_recipe_version_id))))for(const slot of await readRecipeSlots(pool,recipeId))slotRows.push({id:String(slot.slot_key),label:String(slot.variable_contract?.title||`参考位置 ${slot.sort_order}`)});
  const slots=boundedRows([...new Map(slotRows.map(row=>[`${row.id}:${row.label}`,row])).values()].sort((a,b)=>a.id.localeCompare(b.id)));
  const routeOverrides=await bounded("SELECT override_key id,name label FROM new_design.model_route_configs WHERE scope='one_time' AND status='active' AND (book_id=$1 OR book_id IS NULL) ORDER BY name",[bookId]);
  const choices=(rows:Record<string,unknown>[])=>[...new Map(rows.map(row=>[String(row.id),{id:String(row.id),label:String(row.label),...(row.kind?{kind:String(row.kind)}:{}),...(row.parent_id?{parentId:String(row.parent_id)}:{})}])).values()];
  return {bookId,types:choices(types),scopes:choices(scopes),sources,tags:choices(tags),views:choices(views),relations:choices(relations),packs:choices(packs),retrievals:choices(retrievals),spaces:choices(spaces),tasks:choices(tasks),groups,slots:choices(slots),routeOverrides:choices(routeOverrides),truncated};
}
