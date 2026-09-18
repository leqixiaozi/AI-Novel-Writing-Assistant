import {readStoryFormat} from "../../../common/storyFormat";
import type { AdoptedChapterPlanContract, BookMaterialReadiness, BookOverview, BookOverviewMetric, PlanningCenterWorkspace, PlanningObject } from "../../../common/contracts";
import { NewDesignError, assertFound } from "../../domain/errors";
import { getNewDesignPool } from "../runtime";
import { getPlanningObject } from "./store";
import type {PoolClient} from "pg";

/** Exact adopted-plan reader for an owning chapter transaction. No second pool. */
export async function getAdoptedChapterPlanContractInTransaction(client:Pick<PoolClient,"query">,bookId:string,chapterCardId:string):Promise<AdoptedChapterPlanContract>{
  const row=assertFound((await client.query(`SELECT object.id,object.revision,object.updated_at,card.current_version_id chapter_card_version_id,version.id version_id,version.version,version.content_hash,version.execution_mode,version.content,version.based_on_parent_version_id
    FROM new_design.planning_objects object JOIN new_design.books book ON book.id=object.book_id
    JOIN new_design.cards card ON card.id=object.card_id AND card.space_id=book.space_id
    JOIN new_design.planning_versions version ON version.id=object.adopted_version_id AND version.object_id=object.id AND version.book_id=book.id
    WHERE object.book_id=$1 AND object.card_id=$2 AND object.level='chapter' AND object.status='active' AND version.status='adopted' AND version.stale_at IS NULL`,[bookId,chapterCardId])).rows[0],"目标章节没有可用的采用计划版本。");
  if(!row.based_on_parent_version_id)throw new NewDesignError("章节采用计划缺少卷计划版本依据。",409);
  const references=(await client.query(`SELECT reference.*,version.title,type.type_key,type.name type_name FROM new_design.planning_version_references reference
    JOIN new_design.card_versions version ON version.id=reference.card_version_id AND version.card_id=reference.card_id
    JOIN new_design.cards card ON card.id=reference.card_id JOIN new_design.card_types type ON type.id=card.card_type_id
    WHERE reference.planning_version_id=$1 AND reference.book_id=$2 ORDER BY reference.reference_role,reference.sort_order,reference.id`,[row.version_id,bookId])).rows;
  return{bookId,planningObjectId:String(row.id),planningObjectRevision:Number(row.revision),chapterCardId,chapterCardVersionId:String(row.chapter_card_version_id),planningVersionId:String(row.version_id),planningVersionNumber:Number(row.version),planningContentHash:String(row.content_hash),executionMode:row.execution_mode,content:row.content,basedOnVolumePlanVersionId:String(row.based_on_parent_version_id),updatedAt:asDate(row.updated_at)!,references:references.map(reference=>({id:String(reference.id),planningVersionId:String(reference.planning_version_id),role:reference.reference_role,cardId:String(reference.card_id),cardVersionId:String(reference.card_version_id),cardTypeKey:String(reference.type_key),cardTypeName:String(reference.type_name),title:String(reference.title),action:reference.action_key??null,note:String(reference.note),sortOrder:Number(reference.sort_order)}))};
}

const asDate=(value:unknown)=>value===null||value===undefined?null:value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
const isFilled=(value:unknown)=>value!==null&&value!==undefined&&value!==""&&(!Array.isArray(value)||value.length>0);
const text=(value:unknown)=>typeof value==="string"?value.trim():"";

export async function getPlanningCenterWorkspace(bookId:string):Promise<PlanningCenterWorkspace>{
  const pool=await getNewDesignPool();
  assertFound((await pool.query("SELECT id FROM new_design.books WHERE id=$1",[bookId])).rows[0],"书籍不存在。");
  const [objectRows,materials,settlements]=await Promise.all([
    pool.query("SELECT id FROM new_design.planning_objects WHERE book_id=$1 ORDER BY CASE level WHEN 'story' THEN 0 WHEN 'volume' THEN 1 WHEN 'chapter' THEN 2 ELSE 3 END,sort_order,id",[bookId]),
    pool.query(`SELECT card.id card_id,card.current_version_id card_version_id,type.type_key,type.name type_name,card.title,card.updated_at
      FROM new_design.books book JOIN new_design.cards card ON card.space_id=book.space_id AND card.status='active'
      JOIN new_design.card_types type ON type.id=card.card_type_id
      WHERE book.id=$1 AND card.current_version_id IS NOT NULL
      ORDER BY type.sort_order,type.name,card.title,card.id`,[bookId]),
    pool.query(`SELECT
      (SELECT count(DISTINCT checkpoint.chapter_document_id) FROM new_design.chapter_stable_checkpoints checkpoint WHERE checkpoint.book_id=$1 AND checkpoint.status='stable') stable,
      count(*) FILTER(WHERE session.status IN ('reviewing','adopted_pending_proposals','pending_review','partially_confirmed','settling')) pending,
      count(*) FILTER(WHERE session.status='failed') failed,
      count(*) FILTER(WHERE session.status='impact_review_required') impact_review,
      (SELECT count(*) FROM new_design.chapter_revision_executions execution WHERE execution.book_id=$1 AND execution.status IN ('queued','running','awaiting_review')) revision_running,
      (SELECT count(*) FROM new_design.chapter_revision_executions execution WHERE execution.book_id=$1 AND execution.status IN ('partially_failed','failed','dead_letter')) revision_failed,
      (SELECT count(*) FROM new_design.chapter_revision_review_flags flag WHERE flag.book_id=$1 AND flag.status IN ('pending_review','in_review')) downstream_review
      FROM new_design.chapter_adoption_sessions session WHERE session.book_id=$1`,[bookId]),
  ]);
  const creationSources=(await pool.query("SELECT id,source_payload->'storyFormat' format FROM new_design.book_content_sources WHERE book_id=$1 AND confirmation_status='confirmed' ORDER BY id",[bookId])).rows;
  const creationFormat=creationSources.length===1?readStoryFormat(creationSources[0].format):null;
  const objects:PlanningObject[]=await Promise.all(objectRows.rows.map(row=>getPlanningObject(String(row.id))));
  const settlement=settlements.rows[0];return{bookId,creationStoryFormat:creationFormat?{sourceId:String(creationSources[0].id),format:creationFormat}:null,objects,materials:materials.rows.map(row=>({cardId:String(row.card_id),cardVersionId:String(row.card_version_id),typeKey:String(row.type_key),typeName:String(row.type_name),title:String(row.title),updatedAt:asDate(row.updated_at)!})),settlementSummary:{stable:Number(settlement.stable),pending:Number(settlement.pending),failed:Number(settlement.failed),impactReview:Number(settlement.impact_review),revisionRunning:Number(settlement.revision_running),revisionFailed:Number(settlement.revision_failed),downstreamReview:Number(settlement.downstream_review)},aiCapability:{configured:true,taskKey:"planning.candidate.generate",taskContractVersionId:null,message:"AI 会读取本书资料和已采用规划，生成一份可比较、可修改的候选，不会自动采用。"},updatedAt:new Date().toISOString()};
}

export async function getBookOverview(bookId:string):Promise<BookOverview>{
  const pool=await getNewDesignPool(),book=assertFound((await pool.query("SELECT id,space_id,updated_at FROM new_design.books WHERE id=$1",[bookId])).rows[0],"书籍不存在。");
  const [story,materialRows,planCounts,bodyCounts,settlementCounts,facts,changes,issues,dependencies,tasks,context]=await Promise.all([
    pool.query(`SELECT object.id,object.title,object.updated_at,version.id version_id,version.content FROM new_design.planning_objects object JOIN new_design.planning_versions version ON version.id=object.adopted_version_id WHERE object.book_id=$1 AND object.level='story' AND object.status='active'`,[bookId]),
    pool.query(`SELECT type.type_key,type.name type_name,COALESCE(category.name,'未分组') category_name,version.fields,card.id card_id,card.values,card.updated_at
      FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id
      LEFT JOIN new_design.card_type_categories category ON category.id=type.category_id
      LEFT JOIN new_design.cards card ON card.card_type_id=type.id AND card.space_id=$1 AND card.status='active'
      WHERE type.space_id=$1 AND type.status='published' ORDER BY category.sort_order,type.sort_order,type.name,card.id`,[book.space_id]),
    pool.query(`SELECT count(*) FILTER(WHERE level='volume' AND status='active') volume_total,count(*) FILTER(WHERE level='volume' AND status='active' AND adopted_version_id IS NOT NULL) volume_adopted,count(*) FILTER(WHERE level='chapter' AND status='active') chapter_total,count(*) FILTER(WHERE level='chapter' AND status='active' AND adopted_version_id IS NOT NULL) chapter_adopted,max(updated_at) updated_at FROM new_design.planning_objects WHERE book_id=$1`,[bookId]),
    pool.query("SELECT count(*) FILTER(WHERE status='active') document_total,count(*) FILTER(WHERE status='active' AND adopted_version_id IS NOT NULL) written_total,max(updated_at) updated_at FROM new_design.chapter_documents WHERE book_id=$1",[bookId]),
    pool.query(`SELECT count(DISTINCT checkpoint.chapter_document_id) FILTER(WHERE checkpoint.status='stable') stable_total,
      count(*) FILTER(WHERE session.status IN ('reviewing','adopted_pending_proposals','pending_review','partially_confirmed','settling','failed','impact_review_required')) attention_total,
      (SELECT count(*) FROM new_design.chapter_revision_executions execution WHERE execution.book_id=$1 AND execution.status IN ('queued','running','awaiting_review','partially_failed','failed','dead_letter')) revision_attention,
      (SELECT count(*) FROM new_design.chapter_revision_review_flags flag WHERE flag.book_id=$1 AND flag.status IN ('pending_review','in_review')) review_attention,
      max(session.updated_at) updated_at FROM new_design.chapter_adoption_sessions session LEFT JOIN new_design.chapter_stable_checkpoints checkpoint ON checkpoint.session_id=session.id WHERE session.book_id=$1`,[bookId]),
    pool.query("SELECT count(*) count,max(updated_at) updated_at FROM new_design.canonical_facts WHERE book_id=$1 AND status='proposed'",[bookId]),
    pool.query(`SELECT count(*) count,max(item.updated_at) updated_at FROM new_design.chapter_settlement_items item JOIN new_design.chapter_adoption_sessions session ON session.id=item.session_id WHERE session.book_id=$1 AND item.decision IN ('pending','defer')`,[bookId]),
    pool.query("SELECT count(*) count,max(updated_at) updated_at FROM new_design.quality_issues WHERE book_id=$1 AND current_status IN ('open','acknowledged','deferred','fix_proposed')",[bookId]),
    pool.query("SELECT count(*) count,max(updated_at) updated_at FROM new_design.dependency_resource_states WHERE book_id=$1 AND state IN ('stale','invalid','needs_review','recompute_pending','recomputing')",[bookId]),
    pool.query("SELECT id,task_key,status,source_route,updated_at FROM new_design.ai_tasks WHERE book_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 5",[bookId]),
    pool.query(`SELECT total.adopted_count,preview.status preview_status,preview.created_at preview_at
      FROM (SELECT count(*) adopted_count FROM new_design.context_bindings WHERE (book_id=$1 OR book_id IS NULL) AND status='active' AND adopted_version_id IS NOT NULL) total
      LEFT JOIN LATERAL (SELECT status,created_at FROM new_design.context_previews WHERE book_id=$1 ORDER BY created_at DESC LIMIT 1) preview ON true`,[bookId]),
  ]);
  const grouped=new Map<string,{typeKey:string;typeName:string;categoryName:string;fields:Array<{key?:string;required?:boolean}>;cards:Array<{values:Record<string,unknown>;updatedAt:string|null}>}>();
  for(const row of materialRows.rows){const key=String(row.type_key),entry=grouped.get(key)??{typeKey:key,typeName:String(row.type_name),categoryName:String(row.category_name),fields:(row.fields??[]) as Array<{key?:string;required?:boolean}>,cards:[]};if(row.card_id)entry.cards.push({values:(row.values??{}) as Record<string,unknown>,updatedAt:asDate(row.updated_at)});grouped.set(key,entry);}
  const materials:BookMaterialReadiness[]=[...grouped.values()].map(entry=>{const required=entry.fields.filter(field=>field.required&&field.key),filled=entry.cards.reduce((sum,card)=>sum+required.filter(field=>isFilled(card.values[String(field.key)])).length,0),expected=required.length*entry.cards.length;return{typeKey:entry.typeKey,typeName:entry.typeName,categoryName:entry.categoryName,activeCount:entry.cards.length,requiredFieldCount:expected,filledRequiredFieldCount:filled,state:entry.cards.length===0?"unavailable":expected===0||filled===expected?"ready":"needs_input",sourceRoute:`/new-design/books/${bookId}/cards?typeKey=${encodeURIComponent(entry.typeKey)}`,updatedAt:entry.cards.map(card=>card.updatedAt).filter(Boolean).sort().at(-1)??null};});
  const pc=planCounts.rows[0],bc=bodyCounts.rows[0],settlement=settlementCounts.rows[0],fact=facts.rows[0],change=changes.rows[0],issue=issues.rows[0],dependency=dependencies.rows[0];
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
  const contextRow=context.rows[0],adoptedCount=Number(contextRow?.adopted_count??0),previewStatus=contextRow?.preview_status?String(contextRow.preview_status):null;
  return{bookId,direction:storyRow?{planningObjectId:String(storyRow.id),planningVersionId:String(storyRow.version_id),title:String(storyRow.title),summary,updatedAt:asDate(storyRow.updated_at)!}:null,materials,metrics,recentTasks:tasks.rows.map(row=>({id:String(row.id),taskKey:String(row.task_key),status:String(row.status),sourceRoute:String(row.source_route),updatedAt:asDate(row.updated_at)!})),context:{state:adoptedCount>0?(previewStatus==="invalid"||previewStatus==="stale"?"attention":"ready"):"unknown",adoptedRuleCount:adoptedCount,latestPreviewStatus:previewStatus,detail:adoptedCount===0?"暂无可用的上下文规则。":previewStatus?`最近一次装配预览：${previewStatus}`:"规则可用，尚无装配预览。",sourceRoute:"/new-design/structure/context",updatedAt:asDate(contextRow?.preview_at)},updatedAt:new Date().toISOString()};
}

export async function getAdoptedChapterPlanContract(bookId:string,chapterCardId:string):Promise<AdoptedChapterPlanContract>{
  const pool=await getNewDesignPool(),row=assertFound((await pool.query(`SELECT object.id,object.revision,object.adopted_version_id,object.updated_at,card.current_version_id chapter_card_version_id
    FROM new_design.planning_objects object JOIN new_design.books book ON book.id=object.book_id
    JOIN new_design.cards card ON card.id=object.card_id AND card.space_id=book.space_id
    WHERE object.book_id=$1 AND object.card_id=$2 AND object.level='chapter' AND object.status='active'`,[bookId,chapterCardId])).rows[0],"章节计划不存在。");
  if(!row.adopted_version_id)throw new NewDesignError("该章节还没有采用的计划版本。",409);
  const object=await getPlanningObject(String(row.id)),version=assertFound(object.adoptedVersion,"该章节还没有采用的计划版本。");
  if(!version.basedOnParentVersionId)throw new NewDesignError("章节采用计划缺少卷计划版本依据。",409);
  return{bookId,planningObjectId:object.id,planningObjectRevision:object.revision,chapterCardId,chapterCardVersionId:String(row.chapter_card_version_id),planningVersionId:version.id,planningVersionNumber:version.version,planningContentHash:version.contentHash,executionMode:version.executionMode,content:version.content,references:version.references,basedOnVolumePlanVersionId:version.basedOnParentVersionId,updatedAt:asDate(row.updated_at)!};
}
