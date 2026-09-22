import type {PoolClient} from 'pg';
import {recordWorkflowAction} from '../cardWorkflow';

export const professionalReceiptRows=`(SELECT action.created_at,action.receipt,data.*
 FROM new_design.card_version_actions action
 CROSS JOIN LATERAL jsonb_to_record(action.payload) data(request_key text,input_hash text,operation text,resource_card_id uuid,resource_version_id uuid,book_id uuid,preview_id uuid,issue_id uuid,preference boolean,feedback_effect text,feedback_note text)
 WHERE action.action_key='professional.resource.command')`;
export async function saveProfessionalReceipt(client:PoolClient,cardId:string,input:{request_key:string;input_hash:string;operation:string;resource_card_id?:unknown;resource_version_id?:unknown;book_id?:unknown;preview_id?:unknown;issue_id?:unknown;preference?:unknown;feedback_effect?:unknown;feedback_note?:unknown;receipt:Record<string,unknown>}){
 const {receipt,...payload}=input;
 await recordWorkflowAction(client,{cardId,actionKey:'professional.resource.command',requestKey:`professional-resource:${input.request_key}`,inputHash:input.input_hash,payload,receipt});
}
