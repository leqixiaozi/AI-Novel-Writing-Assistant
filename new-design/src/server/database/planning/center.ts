import {listRecordCards,type RecordCardDb} from '../recordCards';
import {planningVersion,planningReferences} from './records';
import {readStoryFormat} from "../../../common/storyFormat";
import type { AdoptedChapterPlanContract, BookMaterialReadiness, BookOverview, BookOverviewMetric, PlanningCenterWorkspace, PlanningObject } from "../../../common/contracts";
import { NewDesignError, assertFound } from "../../domain/errors";
import { getNewDesignPool } from "../runtime";
import { getPlanningObject } from "./store";
import type {PoolClient} from "pg";

/** Exact adopted-plan reader for an owning chapter transaction. No second pool. */
export async function getAdoptedChapterPlanContractInTransaction(client:Pick<PoolClient,"query">,bookId:string,chapterCardId:string):Promise<AdoptedChapterPlanContract>{
  const object=(await listRecordCards(client,'planning_object',{where:{book_id:bookId,card_id:chapterCardId,level:'chapter',status:'active'}}))[0];
  if(!object?.adopted_version_id)throw new NewDesignError('目标章节没有可用的采用计划版本。',404);
  const version=await planningVersion(client,object.adopted_version_id,object.id),card=(await client.query('SELECT card.current_version_id FROM new_design.cards card JOIN new_design.books book ON book.space_id=card.space_id WHERE book.id=$1 AND card.id=$2',[bookId,chapterCardId])).rows[0];
  if(!card||version.book_id!==bookId||version.status!=='adopted'||version.stale_at)throw new NewDesignError('目标章节没有可用的采用计划版本。',409);
  const row={...object,chapter_card_version_id:card.current_version_id,version_id:version.id,version:version.version,content_hash:version.content_hash,execution_mode:version.execution_mode,content:version.content,based_on_parent_version_id:version.based_on_parent_version_id};
  if(!row.based_on_parent_version_id)throw new NewDesignError('章节采用计划缺少卷计划版本依据。',409);
  const references=await planningReferences(client,{planning_version_id:row.version_id,book_id:bookId},true);
  return{bookId,planningObjectId:String(row.id),planningObjectRevision:Number(row.revision),chapterCardId,chapterCardVersionId:String(row.chapter_card_version_id),planningVersionId:String(row.version_id),planningVersionNumber:Number(row.version),planningContentHash:String(row.content_hash),executionMode:row.execution_mode,content:row.content,basedOnVolumePlanVersionId:String(row.based_on_parent_version_id),updatedAt:asDate(row.updated_at)!,references:references.map(reference=>({id:String(reference.id),planningVersionId:String(reference.planning_version_id),role:reference.reference_role,cardId:String(reference.card_id),cardVersionId:String(reference.card_version_id),cardTypeKey:String(reference.type_key),cardTypeName:String(reference.type_name),title:String(reference.title),action:reference.action_key??null,note:String(reference.note),sortOrder:Number(reference.sort_order)}))};
}

const asDate=(value:unknown)=>value===null||value===undefined?null:value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
const isFilled=(value:unknown)=>value!==null&&value!==undefined&&value!==""&&(!Array.isArray(value)||value.length>0);
const text=(value:unknown)=>typeof value==="string"?value.trim():"";

async function planningRows(db:RecordCardDb,bookId:string){
 return(await listRecordCards(db,'planning_object',{where:{book_id:bookId},includeArchived:true})).sort((a,b)=>['story','volume','chapter','scene'].indexOf(a.level)-['story','volume','chapter','scene'].indexOf(b.level)||Number(a.sort_order)-Number(b.sort_order)||a.id.localeCompare(b.id));
}
const latest=(rows:Record<string,any>[],field='updated_at')=>rows.map(row=>row[field]).filter(Boolean).map(value=>asDate(value)!).sort().at(-1)??null;
async function settlementSummary(db:RecordCardDb,bookId:string){
 const where={book_id:bookId},[sessions,checkpoints,executions,flags]=await Promise.all(['chapter_adoption_session','chapter_stable_checkpoint','chapter_revision_execution','chapter_revision_review_flag'].map(kind=>listRecordCards(db,kind,{where})));
 const count=(rows:Record<string,any>[],statuses:string[])=>rows.filter(row=>statuses.includes(row.status)).length,stable=new Set(checkpoints.filter(row=>row.status==='stable').map(row=>row.chapter_document_id)).size;
 const pending=count(sessions,['reviewing','adopted_pending_proposals','pending_review','partially_confirmed','settling']),failed=count(sessions,['failed']),impact=count(sessions,['impact_review_required']),running=count(executions,['queued','running','awaiting_review']),revisionFailed=count(executions,['partially_failed','failed','dead_letter']),downstream=count(flags,['pending_review','in_review']);
 return{stable,pending,failed,impact_review:impact,revision_running:running,revision_failed:revisionFailed,downstream_review:downstream,stable_total:stable,attention_total:pending+failed+impact,revision_attention:running+revisionFailed,review_attention:downstream,updated_at:latest(sessions),sessionIds:sessions.map(row=>row.id)};
}
async function countRecords(db:RecordCardDb,kind:string,bookId:string,field:string,statuses:string[]){
 const rows=(await listRecordCards(db,kind,{where:{book_id:bookId}})).filter(row=>statuses.includes(row[field]));
 return{count:rows.length,updated_at:latest(rows)};
}
async function contextSummary(db:RecordCardDb,bookId:string){
 const bindings=(await listRecordCards(db,'context_binding')).filter(row=>(!row.book_id||row.book_id===bookId)&&row.status==='active'&&row.adopted_version_id),preview=(await listRecordCards(db,'context_preview',{where:{book_id:bookId}})).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
 return{adopted_count:bindings.length,preview_status:preview?.status??null,preview_at:preview?.created_at??null};
}

export async function getPlanningCenterWorkspace(bookId:string):Promise<PlanningCenterWorkspace>{
  const pool=await getNewDesignPool();
  assertFound((await pool.query("SELECT id FROM new_design.books WHERE id=$1",[bookId])).rows[0],"书籍不存在。");
  const [objectRows,materials,settlements]=await Promise.all([
    planningRows(pool,bookId).then(rows=>({rows})),
    pool.query(`SELECT card.id card_id,card.current_version_id card_version_id,type.type_key,type.name type_name,card.title,card.updated_at
      FROM new_design.books book JOIN new_design.cards card ON card.space_id=book.space_id AND card.status='active'
      JOIN new_design.card_types type ON type.id=card.card_type_id AND type.space_id=book.space_id
      WHERE book.id=$1 AND card.current_version_id IS NOT NULL
      ORDER BY type.sort_order,type.name,card.title,card.id`,[bookId]),
    settlementSummary(pool,bookId).then(row=>({rows:[row]})),
  ]);
  const creationSources=(await listRecordCards(pool,'book_content_source',{where:{book_id:bookId,confirmation_status:'confirmed'}})).sort((a,b)=>a.id.localeCompare(b.id)).map(row=>({id:row.id,format:row.source_payload?.storyFormat}));
  const creationFormat=creationSources.length===1?readStoryFormat(creationSources[0].format):null;
  const objects:PlanningObject[]=await Promise.all(objectRows.rows.map(row=>getPlanningObject(String(row.id))));
  const settlement=settlements.rows[0];return{bookId,creationStoryFormat:creationFormat?{sourceId:String(creationSources[0].id),format:creationFormat}:null,objects,materials:materials.rows.map(row=>({cardId:String(row.card_id),cardVersionId:String(row.card_version_id),typeKey:String(row.type_key),typeName:String(row.type_name),title:String(row.title),updatedAt:asDate(row.updated_at)!})),settlementSummary:{stable:Number(settlement.stable),pending:Number(settlement.pending),failed:Number(settlement.failed),impactReview:Number(settlement.impact_review),revisionRunning:Number(settlement.revision_running),revisionFailed:Number(settlement.revision_failed),downstreamReview:Number(settlement.downstream_review)},aiCapability:{configured:true,taskKey:"planning.candidate.generate",taskContractVersionId:null,message:"AI 会读取本书资料和已采用规划，生成一份可比较、可修改的候选，不会自动采用。"},updatedAt:new Date().toISOString()};
}

export async function getBookOverview(bookId:string):Promise<BookOverview>{
  const pool=await getNewDesignPool(),book=assertFound((await pool.query("SELECT id,space_id,updated_at FROM new_design.books WHERE id=$1",[bookId])).rows[0],"书籍不存在。");
  const plans=await planningRows(pool,bookId),storyObject=plans.find(row=>row.level==='story'&&row.status==='active'&&row.adopted_version_id),storyVersion=storyObject?await planningVersion(pool,storyObject.adopted_version_id,storyObject.id):null;
  const story={rows:storyObject&&storyVersion?[{id:storyObject.id,title:String(storyObject.title),updated_at:storyObject.updated_at,version_id:storyVersion.id,content:storyVersion.content}]:[]};
  const [materialRows,bodyCounts,settlement,fact,issue,dependency,tasks,contextRow]=await Promise.all([
    pool.query(`SELECT type.type_key,type.name type_name,type.category_id,type.sort_order,type.name,version.fields,card.id card_id,card.values,card.updated_at
      FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id
      LEFT JOIN new_design.cards card ON card.card_type_id=type.id AND card.space_id=$1 AND card.status='active'
      WHERE type.space_id=$1 AND type.status='published' ORDER BY type.sort_order,type.name,card.id`,[book.space_id]),
    pool.query("SELECT count(*) FILTER(WHERE status='active') document_total,count(*) FILTER(WHERE status='active' AND adopted_version_id IS NOT NULL) written_total,max(updated_at) updated_at FROM new_design.chapter_documents WHERE book_id=$1",[bookId]),
    settlementSummary(pool,bookId),
    countRecords(pool,'canonical_fact',bookId,'status',['proposed']),
    countRecords(pool,'quality_issue',bookId,'current_status',['open','acknowledged','deferred','fix_proposed']),
    countRecords(pool,'dependency_resource_state',bookId,'state',['stale','invalid','needs_review','recompute_pending','recomputing']),
    pool.query('SELECT id,task_key,status,source_route,updated_at FROM new_design.ai_tasks WHERE book_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 5',[bookId]),
    contextSummary(pool,bookId),
  ]);
  const categories=await listRecordCards(pool,'card_type_category',{spaceId:book.space_id});
  for(const row of materialRows.rows){const category=categories.find(item=>item.id===row.category_id);row.category_name=category?.name??'未分组';row.category_sort=category?.sort_order??0;}
  materialRows.rows.sort((a,b)=>Number(a.category_sort)-Number(b.category_sort)||Number(a.sort_order)-Number(b.sort_order)||String(a.name).localeCompare(String(b.name))||String(a.card_id).localeCompare(String(b.card_id)));
  const planCount=(level:string,adopted=false)=>plans.filter(row=>row.level===level&&row.status==='active'&&(!adopted||row.adopted_version_id)).length;
  const pc={volume_total:planCount('volume'),volume_adopted:planCount('volume',true),chapter_total:planCount('chapter'),chapter_adopted:planCount('chapter',true),updated_at:latest(plans)},bc=bodyCounts.rows[0];
  const change=(await pool.query("SELECT count(*) count,max(updated_at) updated_at FROM new_design.chapter_settlement_items WHERE session_id=ANY($1::uuid[]) AND decision IN ('pending','defer')",[settlement.sessionIds])).rows[0];
  const grouped=new Map<string,{typeKey:string;typeName:string;categoryName:string;fields:Array<{key?:string;required?:boolean}>;cards:Array<{values:Record<string,unknown>;updatedAt:string|null}>}>();
  for(const row of materialRows.rows){const key=String(row.type_key),entry=grouped.get(key)??{typeKey:key,typeName:String(row.type_name),categoryName:String(row.category_name),fields:(row.fields??[]) as Array<{key?:string;required?:boolean}>,cards:[]};if(row.card_id)entry.cards.push({values:(row.values??{}) as Record<string,unknown>,updatedAt:asDate(row.updated_at)});grouped.set(key,entry);}
  const materials:BookMaterialReadiness[]=[...grouped.values()].map(entry=>{const required=entry.fields.filter(field=>field.required&&field.key),filled=entry.cards.reduce((sum,card)=>sum+required.filter(field=>isFilled(card.values[String(field.key)])).length,0),expected=required.length*entry.cards.length;return{typeKey:entry.typeKey,typeName:entry.typeName,categoryName:entry.categoryName,activeCount:entry.cards.length,requiredFieldCount:expected,filledRequiredFieldCount:filled,state:entry.cards.length===0?"unavailable":expected===0||filled===expected?"ready":"needs_input",sourceRoute:`/new-design/books/${bookId}/cards?typeKey=${encodeURIComponent(entry.typeKey)}`,updatedAt:entry.cards.map(card=>card.updatedAt).filter(Boolean).sort().at(-1)??null};});
  const metric=(key:string,label:string,value:number|null,unit:string,state:BookOverviewMetric["state"],detail:string,sourceLabel:string,sourceRoute:string,updatedAt:unknown):BookOverviewMetric=>({key,label,value,unit,state,detail,sourceLabel,sourceRoute,updatedAt:asDate(updatedAt)});
  const metrics=[
    metric("volume_plans","卷规划",Number(pc.volume_adopted),`/${Number(pc.volume_total)}`,Number(pc.volume_total)>0&&Number(pc.volume_adopted)===Number(pc.volume_total)?"ready":"attention","采用后的卷计划才会约束章节规划。","规划版本账本",`/new-design/books/${bookId}/planning`,pc.updated_at),
    metric("chapter_plans","章节规划",Number(pc.chapter_adopted),`/${Number(pc.chapter_total)}`,Number(pc.chapter_total)>=3&&Number(pc.chapter_adopted)>=3?"ready":"attention","前三章各自需要一个明确采用的计划版本。","规划版本账本",`/new-design/books/${bookId}/planning`,pc.updated_at),
    metric("written_chapters","已写章节",Number(bc.written_total),`/${Number(bc.document_total)}`,Number(bc.written_total)>0?"ready":"attention","只统计存在采用正文版本的章节。","正文版本账本",`/new-design/books/${bookId}/views/chapters`,bc.updated_at),
    metric("stable_chapters","稳定章节",Number(settlement.stable_total)," 章",Number(settlement.attention_total)+Number(settlement.revision_attention)+Number(settlement.review_attention)>0?"attention":Number(settlement.stable_total)>0?"ready":"unknown","下一章只读取完成正文采用、变化确认和换稿复核的稳定检查点。","章节结算账本",`/new-design/books/${bookId}/writing`,settlement.updated_at),
    metric("revision_attention","换稿后续",Number(settlement.revision_attention)+Number(settlement.review_attention)," 项",Number(settlement.revision_attention)+Number(settlement.review_attention)>0?"attention":"ready","汇总选择性重算、失败恢复和后续章节正文复核。","换稿重算账本",`/new-design/books/${bookId}/writing`,settlement.updated_at),
    metric("pending_facts","待确认事实",Number(fact.count)," 条",Number(fact.count)>0?"attention":"ready","候选事实需要确认后才进入正式事实。","事实账本",`/new-design/books/${bookId}/views/events`,fact.updated_at),
    metric("pending_changes","待确认变化",Number(change.count)," 条",Number(change.count)>0?"attention":"ready","汇总章节采用清单中的待确认和稍后处理内容。","章节结算账本",`/new-design/books/${bookId}/writing`,change.updated_at),
    metric("continuity_issues","连续性与质量问题",Number(issue.count)," 项",Number(issue.count)>0?"attention":"ready","包括待处理、已知悉和已有修复候选的问题。","质量审查账本",`/new-design/books/${bookId}/views/quality`,issue.updated_at),
    metric("stale_items","待复核或重算",Number(dependency.count)," 项",Number(dependency.count)>0?"attention":"ready","来源版本变化后等待复核、失效或重算的派生项。","依赖失效账本",`/new-design/books/${bookId}/dependency-review`,dependency.updated_at),
  ];
  const storyRow=story.rows[0],storyContent=(storyRow?.content??{}) as Record<string,unknown>,summary=["summary","direction","goal","premise"].map(key=>text(storyContent[key])).find(Boolean)??"已采用故事方向，详细内容可进入故事规划查看。";
  const adoptedCount=Number(contextRow?.adopted_count??0),previewStatus=contextRow?.preview_status?String(contextRow.preview_status):null;
  return{bookId,direction:storyRow?{planningObjectId:String(storyRow.id),planningVersionId:String(storyRow.version_id),title:String(storyRow.title),summary,updatedAt:asDate(storyRow.updated_at)!}:null,materials,metrics,recentTasks:tasks.rows.map(row=>({id:String(row.id),taskKey:String(row.task_key),status:String(row.status),sourceRoute:String(row.source_route),updatedAt:asDate(row.updated_at)!})),context:{state:adoptedCount>0?(previewStatus==="invalid"||previewStatus==="stale"?"attention":"ready"):"unknown",adoptedRuleCount:adoptedCount,latestPreviewStatus:previewStatus,detail:adoptedCount===0?"暂无可用的上下文规则。":previewStatus?`最近一次装配预览：${previewStatus}`:"规则可用，尚无装配预览。",sourceRoute:"/new-design/structure/context",updatedAt:asDate(contextRow?.preview_at)},updatedAt:new Date().toISOString()};
}

export async function getAdoptedChapterPlanContract(bookId:string,chapterCardId:string):Promise<AdoptedChapterPlanContract>{
  const pool=await getNewDesignPool(),record=(await listRecordCards(pool,'planning_object',{where:{book_id:bookId,card_id:chapterCardId,level:'chapter',status:'active'}}))[0];
  if(!record)throw new NewDesignError('章节计划不存在。',404);
  const card=assertFound((await pool.query('SELECT card.current_version_id FROM new_design.cards card JOIN new_design.books book ON book.space_id=card.space_id WHERE book.id=$1 AND card.id=$2',[bookId,chapterCardId])).rows[0],'章节资料不存在。'),row={...record,chapter_card_version_id:card.current_version_id};
  if(!record.adopted_version_id)throw new NewDesignError("该章节还没有采用的计划版本。",409);
  const object=await getPlanningObject(String(row.id)),version=assertFound(object.adoptedVersion,"该章节还没有采用的计划版本。");
  if(!version.basedOnParentVersionId)throw new NewDesignError("章节采用计划缺少卷计划版本依据。",409);
  return{bookId,planningObjectId:object.id,planningObjectRevision:object.revision,chapterCardId,chapterCardVersionId:String(row.chapter_card_version_id),planningVersionId:version.id,planningVersionNumber:version.version,planningContentHash:version.contentHash,executionMode:version.executionMode,content:version.content,references:version.references,basedOnVolumePlanVersionId:version.basedOnParentVersionId,updatedAt:asDate(row.updated_at)!};
}
