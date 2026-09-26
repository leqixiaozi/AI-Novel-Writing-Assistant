import type {RecordCardDb} from '../recordCards';
import {listRecordCards} from '../recordCards';

/** Approval requests are card records; each final decision is an immutable action. */
export const approvalRequestRows=`(SELECT data.* FROM new_design.cards record
 JOIN new_design.card_types type ON type.id=record.card_type_id AND type.type_key='ai_approval_request'
 JOIN new_design.card_versions version ON version.id=record.current_version_id AND version.card_id=record.id
 CROSS JOIN LATERAL jsonb_to_record(version.values) data(id uuid,task_id uuid,step_id uuid,attempt_id uuid,request_version integer,scope_kind text,scope_id uuid,reason_code text,reason_detail text,request_hash text,requested_by_kind text,requested_by text,created_at timestamptz))`;
export const approvalDecisionRows=`(SELECT action.id,action.created_at,data.*
 FROM new_design.card_version_actions action
 CROSS JOIN LATERAL jsonb_to_record(action.payload) data(request_id uuid,task_id uuid,decision text,decided_by_kind text,decided_by text,policy_version text,reason text)
 WHERE action.action_key='ai.approval.decide')`;
export async function readApprovalRequests(db:RecordCardDb,taskId:string){
 return (await listRecordCards(db,'ai_approval_request',{where:{task_id:taskId},includeArchived:true}))
  .sort((a,b)=>new Date(a.created_at as string).getTime()-new Date(b.created_at as string).getTime()||a.id.localeCompare(b.id));
}
export async function readApprovalDecisions(db:RecordCardDb,taskId:string){
 return (await db.query(`SELECT * FROM ${approvalDecisionRows} decision WHERE task_id=$1`,[taskId])).rows;
}
