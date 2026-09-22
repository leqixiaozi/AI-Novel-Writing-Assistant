import type { RegisteredBackgroundHandlerResult, RegisteredBackgroundHandlers } from "../database/outbox";
import { getNewDesignPool } from "../database/runtime";
import { NewDesignError } from "../domain/errors";

type RequestRow = { id:string; book_id:string; status:string; strategy_key:string; receipt_id:string|null; receipt_outcome:string|null; output_hash:string|null };

export function resolveDependencyRequestJob(job:{specializedRequestId:string;bookId:string|null;executionGeneration:number},row:RequestRow|null):RegisteredBackgroundHandlerResult{
  if(!row||row.id!==job.specializedRequestId||row.book_id!==job.bookId)throw new NewDesignError("依赖重算请求与后台作业来源不一致。",409);
  const idempotencyKey=`dependency-request:${row.id}:generation:${job.executionGeneration}`;
  if(row.status==="pending"&&row.strategy_key==="manual_review")return{outcome:"business_rejected",resultMetadata:{requestId:row.id,sourceStatus:row.status,reason:"manual_review_required"},idempotencyKey};
  if(row.status==="cancelled"||row.status==="failed")return{outcome:"business_rejected",resultMetadata:{requestId:row.id,sourceStatus:row.status},idempotencyKey};
  if(row.status==="superseded")return{outcome:"rejected_stale",resultMetadata:{requestId:row.id,sourceStatus:row.status},idempotencyKey};
  if(row.status==="completed"&&row.receipt_id&&row.receipt_outcome==="applied"&&row.output_hash)return{outcome:"applied",specializedResultKind:"dependency_recompute_receipt",specializedResultId:row.receipt_id,resultHash:row.output_hash,resultMetadata:{requestId:row.id,sourceStatus:row.status},idempotencyKey};
  throw new NewDesignError("依赖重算来源尚未完成或回执不匹配，保留原作业待核对。",409);
}

export function createDependencyReceiptBackgroundHandlers():RegisteredBackgroundHandlers{return{
  "dependency.recompute":async({job,heartbeat})=>{
    await heartbeat();
    const pool=await getNewDesignPool();
    const row=(await pool.query<RequestRow>(`SELECT request.id,request.book_id,request.status,request.strategy_key,
      receipt.id receipt_id,receipt.outcome receipt_outcome,receipt.output_hash
      FROM (SELECT fields.* FROM new_design.cards record JOIN new_design.card_types record_type ON record_type.id=record.card_type_id AND record_type.type_key='dependency_recompute_request' JOIN new_design.card_versions record_version ON record_version.id=record.current_version_id AND record_version.card_id=record.id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,book_id uuid,target_resource_id uuid,invalidation_event_id uuid,required_upstream_versions jsonb,priority integer,status text,reason text,strategy_key text,task_contract_version_id uuid,idempotency_key text,created_at timestamptz,started_at timestamptz,completed_at timestamptz) WHERE record.status='active') request
      LEFT JOIN LATERAL (SELECT id,outcome,output_hash FROM (SELECT fields.* FROM new_design.cards record JOIN new_design.card_types record_type ON record_type.id=record.card_type_id AND record_type.type_key='dependency_recompute_receipt' JOIN new_design.card_versions record_version ON record_version.id=record.current_version_id AND record_version.card_id=record.id CROSS JOIN LATERAL jsonb_to_record(record_version.values) AS fields(id uuid,request_id uuid,book_id uuid,input_dependency_snapshot jsonb,input_snapshot_hash char(64),output_resource_id uuid,output_version_id uuid,output_hash char(64),outcome text,detail text,idempotency_key text,created_at timestamptz) WHERE record.status='active') dependency_recompute_receipt_record WHERE request_id=request.id ORDER BY created_at DESC,id DESC LIMIT 1) receipt ON true
      WHERE request.id=$1`,[job.specializedRequestId])).rows[0]??null;
    return resolveDependencyRequestJob(job,row);
  },
};}
