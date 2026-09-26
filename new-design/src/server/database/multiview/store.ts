import {qualityReportBodyVersionRows,qualityAuditReportRows,qualityIssueRows,stateChangeProposalRows,knowledgeStateProposalVersionRows,knowledgeStateProposalRows,chapterStableCheckpointRows,canonicalFactRows,stateChangeRows,qualityIssueEvidenceRows,qualityFixCandidateRows,qualityIssueVersionRows} from '../chapterProduction/persistence/queries';
import type {PoolClient} from "pg";
import type {BookInsightChapter,BookInsightFact,BookInsightQualityItem,BookInsightStateChange,BookMultiviewWorkspace,QualityIssueStatus,QualitySeverity} from "../../../common/contracts";
import {assertFound} from "../../domain/errors";
import {getNewDesignPool} from "../runtime";

const narrativePlacementRows=`(SELECT data.* FROM new_design.cards record JOIN new_design.card_types type ON type.id=record.card_type_id AND type.type_key='narrative_placement' JOIN new_design.card_versions version ON version.id=record.current_version_id AND version.card_id=record.id CROSS JOIN LATERAL jsonb_to_record(version.values) data(id uuid,space_id uuid,subject_card_id uuid,chapter_card_id uuid,role text,status text))`;
type Row=Record<string,unknown>;
const objectiveCategories=new Set(["continuity","plan_obligation","fact","knowledge","character_state","relationship","prop","event","timeline","foreshadow","world_rule","planning","structure"]);
const date=(value:unknown)=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
const nullable=(value:unknown)=>value===null||value===undefined?null:String(value);
const numberOrNull=(value:unknown)=>value===null||value===undefined?null:Number(value);

function mapChapter(row:Row):BookInsightChapter{
  return{chapterDocumentId:String(row.chapter_document_id),chapterCardId:String(row.chapter_card_id),title:String(row.title),logicalOrder:Number(row.logical_order),documentRevision:Number(row.document_revision),adoptedBodyVersionId:nullable(row.adopted_body_version_id),adoptedBodyVersion:numberOrNull(row.adopted_body_version),candidateCount:Number(row.candidate_count),stableCheckpointId:nullable(row.stable_checkpoint_id),stableState:row.stable_checkpoint_id?"stable":row.stale_checkpoint_id?"stale":"pending",openIssueCount:Number(row.open_issue_count),pendingProposalCount:Number(row.pending_proposal_count),updatedAt:date(row.updated_at)};
}
function mapFact(row:Row):BookInsightFact{
  return{id:String(row.id),subjectCardId:String(row.subject_card_id),subjectTitle:String(row.subject_title),subjectTypeKey:String(row.subject_type_key),predicate:String(row.predicate),value:row.value_json,status:row.status as BookInsightFact["status"],confidence:numberOrNull(row.confidence),sourceMethod:String(row.source_method),updatedAt:date(row.updated_at)};
}
function mapStateChange(row:Row):BookInsightStateChange{
  return{id:String(row.id),subjectKind:row.subject_kind as "card"|"relation",subjectId:String(row.subject_id),subjectTitle:String(row.subject_title),subjectTypeKey:nullable(row.subject_type_key),stateKey:String(row.state_key),beforeValue:row.before_json??null,afterValue:row.after_json,deltaValue:row.delta_json??null,reason:String(row.reason),chapterDocumentId:String(row.chapter_document_id),chapterTitle:String(row.chapter_title),bodyVersionId:String(row.body_version_id),anchorId:nullable(row.text_anchor_id),anchorLabel:String(row.anchor_label??""),effectiveStoryOrder:numberOrNull(row.effective_story_order),status:row.status as BookInsightStateChange["status"],createdAt:date(row.created_at)};
}
function mapQuality(row:Row):BookInsightQualityItem{
  const categoryKey=String(row.category_key);
  return{issueId:String(row.issue_id),reportId:String(row.report_id),chapterDocumentId:nullable(row.chapter_document_id),chapterTitle:String(row.chapter_title??"全书"),bodyVersionId:nullable(row.body_version_id),reportStale:Boolean(row.stale_at),reportStaleReason:String(row.stale_reason??""),categoryKey,qualityKind:objectiveCategories.has(categoryKey)?"objective":"subjective",severity:row.severity as QualitySeverity,confidence:numberOrNull(row.confidence),title:String(row.title),description:String(row.description),suggestedAction:String(row.suggested_action??""),status:row.current_status as QualityIssueStatus,isQualityDebt:Boolean(row.is_quality_debt),revision:Number(row.revision),evidenceCount:Number(row.evidence_count),fixCandidateCount:Number(row.fix_candidate_count),updatedAt:date(row.updated_at)};
}

async function readChapters(client:PoolClient,bookId:string):Promise<BookInsightChapter[]>{
  const rows=await client.query(`SELECT document.id AS chapter_document_id,document.chapter_card_id,document.title,document.logical_order,document.revision AS document_revision,document.adopted_version_id AS adopted_body_version_id,body.version AS adopted_body_version,document.updated_at,
    (SELECT count(*) FROM new_design.chapter_body_versions candidate WHERE candidate.chapter_document_id=document.id AND candidate.archived_at IS NULL) AS candidate_count,
    stable.id AS stable_checkpoint_id,stale.id AS stale_checkpoint_id,
    (SELECT count(DISTINCT issue.id) FROM ${qualityReportBodyVersionRows} binding JOIN ${qualityAuditReportRows} report ON report.id=binding.report_id AND report.stale_at IS NULL JOIN ${qualityIssueRows} issue ON issue.report_id=report.id WHERE binding.chapter_document_id=document.id AND issue.current_status IN ('open','acknowledged','deferred','fix_proposed','fixed')) AS open_issue_count,
    ((SELECT count(*) FROM ${stateChangeProposalRows} proposal WHERE proposal.chapter_document_id=document.id AND proposal.status='proposed')+(SELECT count(*) FROM ${knowledgeStateProposalVersionRows} version JOIN ${knowledgeStateProposalRows} proposal ON proposal.current_version_id=version.id WHERE version.chapter_document_id=document.id AND proposal.status='proposed')) AS pending_proposal_count
    FROM new_design.chapter_documents document
    LEFT JOIN new_design.chapter_body_versions body ON body.id=document.adopted_version_id
    LEFT JOIN LATERAL (SELECT checkpoint.id FROM ${chapterStableCheckpointRows} checkpoint WHERE checkpoint.chapter_document_id=document.id AND checkpoint.status='stable' ORDER BY checkpoint.created_at DESC LIMIT 1) stable ON true
    LEFT JOIN LATERAL (SELECT checkpoint.id FROM ${chapterStableCheckpointRows} checkpoint WHERE checkpoint.chapter_document_id=document.id AND checkpoint.status='stale' ORDER BY checkpoint.created_at DESC LIMIT 1) stale ON true
    WHERE document.book_id=$1 AND document.status='active' ORDER BY document.logical_order`,[bookId]);
  return rows.rows.map(mapChapter);
}

async function readFacts(client:PoolClient,bookId:string):Promise<BookInsightFact[]>{
  const rows=await client.query(`SELECT fact.*,card.title AS subject_title,type.type_key AS subject_type_key FROM ${canonicalFactRows} fact JOIN new_design.cards card ON card.id=fact.subject_card_id JOIN new_design.card_types type ON type.id=card.card_type_id WHERE fact.book_id=$1 ORDER BY card.title,fact.predicate,fact.updated_at DESC`,[bookId]);
  return rows.rows.map(mapFact);
}

async function readStateChanges(client:PoolClient,bookId:string):Promise<BookInsightStateChange[]>{
  const rows=await client.query(`SELECT change.*,COALESCE(card.title,relation_type.name||'关系') AS subject_title,type.type_key AS subject_type_key,document.title AS chapter_title,anchor.label AS anchor_label
    FROM ${stateChangeRows} change
    JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id
    LEFT JOIN new_design.cards card ON change.subject_kind='card' AND card.id=change.subject_id
    LEFT JOIN new_design.card_types type ON type.id=card.card_type_id
    LEFT JOIN new_design.card_relations relation ON change.subject_kind='relation' AND relation.id=change.subject_id
    LEFT JOIN new_design.relation_types relation_type ON relation_type.id=relation.relation_type_id
    LEFT JOIN new_design.text_anchors anchor ON anchor.id=change.text_anchor_id
    WHERE change.book_id=$1 ORDER BY change.effective_story_order NULLS LAST,change.sequence`,[bookId]);
  return rows.rows.map(mapStateChange);
}

async function readQuality(client:PoolClient,bookId:string):Promise<BookInsightQualityItem[]>{
  const rows=await client.query(`SELECT issue.id AS issue_id,issue.report_id,issue.current_status,issue.is_quality_debt,issue.revision,issue.updated_at,version.category_key,version.severity,version.confidence,version.title,version.description,version.suggested_action,report.stale_at,report.stale_reason,binding.chapter_document_id,binding.body_version_id,document.title AS chapter_title,
    (SELECT count(*) FROM ${qualityIssueEvidenceRows} evidence WHERE evidence.issue_version_id=version.id) AS evidence_count,
    (SELECT count(*) FROM ${qualityFixCandidateRows} candidate WHERE candidate.issue_id=issue.id) AS fix_candidate_count
    FROM ${qualityIssueRows} issue JOIN ${qualityIssueVersionRows} version ON version.id=issue.current_version_id JOIN ${qualityAuditReportRows} report ON report.id=issue.report_id
    LEFT JOIN LATERAL (SELECT body.chapter_document_id,body.body_version_id FROM ${qualityReportBodyVersionRows} body WHERE body.report_id=report.id ORDER BY body.chapter_document_id LIMIT 1) binding ON true
    LEFT JOIN new_design.chapter_documents document ON document.id=binding.chapter_document_id
    WHERE issue.book_id=$1 ORDER BY report.stale_at NULLS FIRST,CASE version.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,issue.updated_at DESC`,[bookId]);
  return rows.rows.map(mapQuality);
}

export async function getBookMultiviewWorkspace(bookId:string):Promise<BookMultiviewWorkspace>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{
    assertFound((await client.query("SELECT id FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0],"书籍不存在或已归档。");
    const [chapters,facts,stateChanges,qualityItems,clueRows,failedRows]=await Promise.all([
      readChapters(client,bookId),readFacts(client,bookId),readStateChanges(client,bookId),readQuality(client,bookId),
      client.query(`SELECT card.id,card.title,plant.chapter_card_id AS plant_chapter_id,reveal.chapter_card_id AS reveal_chapter_id FROM new_design.books book JOIN new_design.cards card ON card.space_id=book.space_id AND card.status='active' JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key IN ('clue_evidence','foreshadow') LEFT JOIN ${narrativePlacementRows} plant ON plant.space_id=book.space_id AND plant.subject_card_id=card.id AND plant.role='plant' AND plant.status='active' LEFT JOIN ${narrativePlacementRows} reveal ON reveal.space_id=book.space_id AND reveal.subject_card_id=card.id AND reveal.role='reveal' AND reveal.status='active' WHERE book.id=$1 AND reveal.id IS NULL ORDER BY card.title`,[bookId]),
      client.query("SELECT id,task_key,source_route,updated_at FROM new_design.ai_tasks WHERE book_id=$1 AND status='failed' ORDER BY updated_at DESC LIMIT 100",[bookId]),
    ]);
    let throughChapterOrder=0,checkpointId:string|null=null,chapterDocumentId:string|null=null;
    for(const chapter of chapters){if(chapter.logicalOrder!==throughChapterOrder+1||chapter.stableState!=="stable")break;throughChapterOrder=chapter.logicalOrder;checkpointId=chapter.stableCheckpointId;chapterDocumentId=chapter.chapterDocumentId;}
    const objectiveIssues=qualityItems.filter(item=>item.qualityKind==="objective"&&!item.reportStale&&!(["dismissed","verified","stale","superseded"] as QualityIssueStatus[]).includes(item.status));
    return{bookId,chapters,facts,stateChanges,qualityItems,stableRead:{bookId,
      unresolvedClues:clueRows.rows.map(row=>({cardId:String(row.id),title:String(row.title),plantChapterId:nullable(row.plant_chapter_id),revealChapterId:nullable(row.reveal_chapter_id)})),
      objectiveIssues:objectiveIssues.map(item=>({issueId:item.issueId,title:item.title,severity:item.severity,chapterDocumentId:item.chapterDocumentId})),
      pendingOrStaleChapters:chapters.filter((item):item is BookInsightChapter&{stableState:"pending"|"stale"}=>item.stableState!=="stable").map(item=>({chapterDocumentId:item.chapterDocumentId,title:item.title,state:item.stableState})),
      unconfirmedFacts:facts.filter(item=>!["confirmed","rejected","superseded"].includes(item.status)).map(item=>({factId:item.id,subjectTitle:item.subjectTitle,predicate:item.predicate,status:item.status})),
      failedTasks:failedRows.rows.map(row=>({taskId:String(row.id),taskKey:String(row.task_key),sourceRoute:String(row.source_route),updatedAt:date(row.updated_at)})),
      stableExportRange:{throughChapterOrder,chapterDocumentId,checkpointId},generatedAt:new Date().toISOString()}};
  }finally{client.release();}
}
