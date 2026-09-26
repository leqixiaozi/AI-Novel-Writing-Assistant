import {storyRecordCtes} from '../storyTimeline/persistence';
import type {PoolClient} from "pg";
import type {ProfessionalObject,ProfessionalState,ProfessionalKnowledge,ProfessionalMilestone,ProfessionalConsistencyIssue} from "../../../common/worldCharacterMaintenance";
import {professionalDisplay,professionalWritingAction,professionalRelationAction,professionalFields} from "./presentation";
import {validateFieldValue} from "../../domain/validation";
import {validateDictionaryTreeValues} from "../treeResources";
type Row=Record<string,any>;
const bool=(value:unknown)=>value===true;
const nullable=(value:unknown)=>value===null||value===undefined?null:String(value);

export async function readProfessionalState(client:PoolClient,bookId:string,objects:ProfessionalObject[],relations:Row[],objectLabels:Map<string,string>,dictionaryLabels:Map<string,string>,subjectIds?:string[]):Promise<{items:ProfessionalState[];truncated:boolean}>{
 const rows=(await client.query(`WITH ${storyRecordCtes.current_state_projections},
${storyRecordCtes.entity_initial_state_versions},
${storyRecordCtes.entity_initial_states},
${storyRecordCtes.state_changes},
${storyRecordCtes.chapter_adoption_sessions}
SELECT projection.*,initial.id initial_id,initial.current_version_id initial_current,initial_version.value_json initial_value,
 change.id change_id,change.status change_status,change.after_json change_value,change.chapter_document_id,change.body_version_id,
 settlement.status settlement_status,document.adopted_version_id,document.status document_status,body.archived_at,
 session.id session_id,
 (initial.book_id=projection.book_id AND initial.subject_kind=projection.subject_kind AND initial.subject_id=projection.subject_id AND initial.state_key=projection.state_key AND initial_version.id=initial.current_version_id AND initial_version.value_json=projection.value_json) initial_valid,
 (change.book_id=projection.book_id AND change.subject_kind=projection.subject_kind AND change.subject_id=projection.subject_id AND change.state_key=projection.state_key AND change.after_json=projection.value_json AND change.status='active' AND settlement.status='committed' AND settlement.book_id=projection.book_id AND document.book_id=projection.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id AND body.archived_at IS NULL) change_valid
 FROM current_state_projections projection
 LEFT JOIN entity_initial_state_versions initial_version ON initial_version.id=projection.source_initial_version_id
 LEFT JOIN entity_initial_states initial ON initial.id=initial_version.initial_state_id
 LEFT JOIN state_changes change ON change.id=projection.source_state_change_id
 LEFT JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id AND settlement.body_version_id=change.body_version_id AND settlement.chapter_document_id=change.chapter_document_id
 LEFT JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id
 LEFT JOIN new_design.chapter_body_versions body ON body.id=change.body_version_id AND body.chapter_document_id=document.id
 LEFT JOIN chapter_adoption_sessions session ON session.settlement_id=settlement.id AND session.book_id=projection.book_id AND session.chapter_document_id=document.id AND session.body_version_id=body.id
 WHERE projection.book_id=$1 AND ($2::uuid[] IS NULL OR projection.subject_id=ANY($2)) ORDER BY projection.subject_kind,projection.subject_id,projection.state_key LIMIT 201`,[bookId,subjectIds??null])).rows as Row[];
 const items:ProfessionalState[]=[];for(const row of rows.slice(0,200)){
  const object=objects.find(object=>object.id===row.subject_id),relation=relations.find(relation=>relation.id===row.subject_id);
  const field=row.subject_kind==="card"?object?.fields.find(item=>item.field.key===row.state_key)?.field:professionalFields(relation?.properties_schema).find(field=>field.key===row.state_key);
  const sourceKind:ProfessionalState["sourceKind"]=row.source_state_change_id?"settlement":row.source_initial_version_id?"initial":"unknown",valid=sourceKind==="settlement"?bool(row.change_valid):sourceKind==="initial"?bool(row.initial_valid):false;
  const subjectValid=row.subject_kind==="card"?Boolean(object?.versionId)&&!object?.unavailableReason:bool(relation?.version_valid)&&relation?.type_status==="published";
  const valueIssue=field?validateFieldValue(field,row.value_json)??Object.values(await validateDictionaryTreeValues(client,[field],{[field.key]:row.value_json}))[0]??null:null;
  const available=valid&&!row.is_stale&&subjectValid&&Boolean(field)&&!valueIssue,reason=!subjectValid?"对象或正式关系来源已不可用。":!field?"当前正式规格没有对应字段，请核对来源字段，不使用自由键改写。":valueIssue?"历史值与当前正式类型或字典范围不一致，请打开真实来源核对。":row.is_stale||!valid?"投影来源已变化、正文已切版或缺少真实来源；旧值保留，不能作为当前状态。":null;
  items.push({id:`${row.subject_kind}:${row.subject_id}:${row.state_key}`,subjectId:String(row.subject_id),subjectKind:row.subject_kind as "card"|"relation",subjectLabel:object?.title??(relation?`${relation.source_label} → ${relation.target_label}`:"历史对象不可用"),fieldLabel:field?.name??"历史状态字段需核对",display:professionalDisplay(row.value_json,field,objectLabels,dictionaryLabels),available,reason,projectionRevision:Number(row.projection_revision),sourceKind,sourceId:nullable(row.source_state_change_id??row.source_initial_version_id),bodyVersionId:nullable(row.body_version_id),action:sourceKind==="settlement"?professionalWritingAction(bookId,nullable(row.chapter_document_id),nullable(row.session_id),String(row.subject_id)):row.subject_kind==="relation"?professionalRelationAction(bookId):professionalWritingAction(bookId,null,null)});
 }return{items,truncated:rows.length>200};
}

export async function readProfessionalKnowledge(client:PoolClient,bookId:string,objects:ProfessionalObject[],objectLabels:Map<string,string>,dictionaryLabels:Map<string,string>,scope?:{resourceIds:string[];characterId:string}):Promise<{items:ProfessionalKnowledge[];truncated:boolean}>{
 const rows=(await client.query(`WITH ${storyRecordCtes.current_knowledge_state_projections},
${storyRecordCtes.epistemic_claims},
${storyRecordCtes.knowledge_state_changes},
${storyRecordCtes.knowledge_state_proposals},
${storyRecordCtes.knowledge_state_proposal_versions},
${storyRecordCtes.canonical_facts},
${storyRecordCtes.chapter_adoption_sessions}
SELECT projection.*,claim.subject_card_id,claim.predicate,claim.value_kind,claim.value_json,claim.object_card_id,claim.truth_fact_id,
 fact.status truth_status,fact.value_json truth_value,change.id change_id,version.chapter_document_id,version.body_version_id,version.text_anchor_id,proposal.source,
 session.id session_id,
 (change.status='active' AND change.book_id=projection.book_id AND change.claim_id=projection.claim_id AND change.holder_kind=projection.holder_kind AND change.holder_key=projection.holder_key AND change.holder_card_id IS NOT DISTINCT FROM projection.holder_card_id AND change.stance=projection.stance AND change.confidence IS NOT DISTINCT FROM projection.confidence AND proposal.status='confirmed' AND proposal.confirmed_change_id=change.id AND proposal.current_version_id=version.id AND proposal.claim_id=claim.id AND proposal.holder_kind=projection.holder_kind AND proposal.holder_key=projection.holder_key AND version.stance=projection.stance) change_valid,
 (document.book_id=projection.book_id AND document.status='active' AND document.adopted_version_id=version.body_version_id AND body.archived_at IS NULL AND (version.text_anchor_id IS NULL OR (anchor.status='active' AND anchor.body_version_id=version.body_version_id AND anchor.book_id=projection.book_id))) body_valid
 FROM current_knowledge_state_projections projection JOIN epistemic_claims claim ON claim.id=projection.claim_id AND claim.book_id=projection.book_id
 LEFT JOIN knowledge_state_changes change ON change.id=projection.source_change_id
 LEFT JOIN knowledge_state_proposals proposal ON proposal.id=change.proposal_id AND proposal.book_id=projection.book_id
 LEFT JOIN knowledge_state_proposal_versions version ON version.id=change.proposal_version_id AND version.proposal_id=proposal.id
 LEFT JOIN new_design.chapter_documents document ON document.id=version.chapter_document_id
 LEFT JOIN new_design.chapter_body_versions body ON body.id=version.body_version_id AND body.chapter_document_id=document.id
 LEFT JOIN new_design.text_anchors anchor ON anchor.id=version.text_anchor_id
 LEFT JOIN canonical_facts fact ON fact.id=claim.truth_fact_id AND fact.book_id=projection.book_id
 LEFT JOIN new_design.chapter_settlement_items item ON item.knowledge_proposal_id=proposal.id
 LEFT JOIN chapter_adoption_sessions session ON session.id=item.session_id AND session.book_id=projection.book_id AND session.chapter_document_id=document.id AND session.body_version_id=body.id
 WHERE projection.book_id=$1 AND ($2::uuid[] IS NULL OR (claim.subject_card_id=ANY($2) OR claim.object_card_id=ANY($2)) AND (projection.holder_kind='reader' OR projection.holder_card_id=$3::uuid)) ORDER BY projection.holder_kind,projection.holder_key,projection.claim_id LIMIT 201`,[bookId,scope?.resourceIds??null,scope?.characterId??null])).rows as Row[];
 const stanceLabels:Record<string,string>={knows:"知道",believes:"相信",suspects:"怀疑",misunderstands:"误解",unknown:"不知道"};
 const items=rows.slice(0,200).map(row=>{
  const subject=objects.find(object=>object.id===row.subject_card_id),field=subject?.fields.find(item=>item.field.key===row.predicate)?.field;
  const holderValid=row.holder_kind==="reader"||objects.some(object=>object.id===row.holder_card_id&&object.typeKey==="character"&&object.versionId&&!object.unavailableReason),subjectValid=(!row.subject_card_id||Boolean(subject?.versionId)&&!subject?.unavailableReason)&&(row.value_kind!=="card_reference"||objects.some(object=>object.id===row.object_card_id&&object.versionId&&!object.unavailableReason));
  const sourceValid=bool(row.change_valid)&&(row.body_version_id?bool(row.body_valid):row.source!=="ai")&&(row.source!=="ai"||Boolean(row.text_anchor_id)),available=sourceValid&&holderValid&&subjectValid;
  return{id:String(row.source_change_id),subjectId:nullable(row.subject_card_id),objectId:nullable(row.object_card_id),holderKind:row.holder_kind as 'reader'|'character',holderId:nullable(row.holder_card_id),holderLabel:row.holder_kind==="reader"?"读者":objectLabels.get(String(row.holder_card_id))??"历史人物不可用",predicateLabel:field?.name??"认知命题（未匹配当前正式字段）",display:row.value_kind==="card_reference"?objectLabels.get(String(row.object_card_id))??"历史资料引用不可用":professionalDisplay(row.value_json,field,objectLabels,dictionaryLabels),stanceLabel:stanceLabels[String(row.stance)]??"历史认知需核对",truthLabel:!row.truth_fact_id?"尚未关联客观真相":row.truth_status==="confirmed"?"已关联本书确认事实":"原客观事实已变化，需重新核对",available,reason:!holderValid||!subjectValid?"所知人物或命题对象已不可用。":!sourceValid?"认知来源或已采用正文版本变化，旧结果保留，不作为当前所知。":null,bodyVersionId:nullable(row.body_version_id),projectionRevision:Number(row.projection_revision),action:professionalWritingAction(bookId,nullable(row.chapter_document_id),nullable(row.session_id),nullable(row.holder_card_id)??nullable(row.subject_card_id)??undefined)};
 });return{items,truncated:rows.length>200};
}

export async function readProfessionalMilestones(client:PoolClient,bookId:string):Promise<{items:ProfessionalMilestone[];truncated:boolean}>{
 const rows=(await client.query(`WITH ${storyRecordCtes.state_milestone_snapshots},
${storyRecordCtes.chapter_adoption_sessions}
SELECT milestone.*,session.id session_id,
 (document.book_id=milestone.book_id AND document.status='active' AND document.adopted_version_id=milestone.body_version_id AND body.archived_at IS NULL AND (milestone.source_settlement_id IS NULL OR settlement.status='committed')) body_valid
 FROM state_milestone_snapshots milestone LEFT JOIN new_design.chapter_documents document ON document.id=milestone.chapter_document_id
 LEFT JOIN new_design.chapter_body_versions body ON body.id=milestone.body_version_id AND body.chapter_document_id=document.id
 LEFT JOIN new_design.chapter_settlements settlement ON settlement.id=milestone.source_settlement_id AND settlement.book_id=milestone.book_id AND settlement.body_version_id=milestone.body_version_id
 LEFT JOIN chapter_adoption_sessions session ON session.settlement_id=settlement.id AND session.book_id=milestone.book_id AND session.chapter_document_id=document.id AND session.body_version_id=body.id
 WHERE milestone.book_id=$1 ORDER BY milestone.created_at DESC,milestone.id LIMIT 101`,[bookId])).rows as Row[];
 return{items:rows.slice(0,100).map(row=>({id:String(row.id),label:String(row.label),statusLabel:row.status==="active"&&(!row.body_version_id||bool(row.body_valid))?"历史稳定快照":"快照来源需核对",createdAt:row.created_at instanceof Date?row.created_at.toISOString():String(row.created_at),bodyVersionId:nullable(row.body_version_id),available:row.status==="active"&&(!row.body_version_id||bool(row.body_valid)),action:professionalWritingAction(bookId,nullable(row.chapter_document_id),nullable(row.session_id))})),truncated:rows.length>100};
}

export async function readProfessionalIssues(client:PoolClient,bookId:string,objects:ProfessionalObject[]):Promise<{items:ProfessionalConsistencyIssue[];truncated:boolean}>{
 const rows=(await client.query(`WITH ${storyRecordCtes.canonical_fact_conflicts},
${storyRecordCtes.canonical_facts}
SELECT conflict.id,conflict.reason,a.subject_card_id subject_a,b.subject_card_id subject_b FROM canonical_fact_conflicts conflict
 JOIN canonical_facts a ON a.id=conflict.fact_a_id AND a.book_id=conflict.book_id JOIN canonical_facts b ON b.id=conflict.fact_b_id AND b.book_id=conflict.book_id
 WHERE conflict.book_id=$1 AND conflict.status='open' AND a.status IN ('proposed','confirmed') AND b.status IN ('proposed','confirmed') ORDER BY conflict.created_at DESC,conflict.id LIMIT 101`,[bookId])).rows as Row[];
 return{items:rows.slice(0,100).map(row=>({id:String(row.id),label:"原事实一致性问题",summary:String(row.reason),objectIds:[String(row.subject_a),String(row.subject_b)].filter((id,index,all)=>all.indexOf(id)===index&&objects.some(object=>object.id===id)),action:professionalWritingAction(bookId,null,null)})),truncated:rows.length>100};
}
