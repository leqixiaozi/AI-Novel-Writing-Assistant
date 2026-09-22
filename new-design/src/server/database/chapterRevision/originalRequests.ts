import type {Pool,PoolClient} from 'pg';
import {NewDesignError} from '../../domain/errors';
import {stableHash} from '../aiContracts/integrity';
import {listRecordCards,requireRecordCard} from '../recordCards';

/** Read the persisted complete request, never infer a successful replay from plan or session identity alone. */
export async function assertRevisionOriginal(db:Pool|PoolClient,typeKey:string,id:string,request:Record<string,unknown>):Promise<void>{
  const row=await requireRecordCard(db,id,typeKey,'原换稿请求未能读取，请保留原键核对。',{includeArchived:true});
  if(row.request_hash!==stableHash(request)||stableHash(row.request_input??null)!==stableHash(request))
    throw Object.assign(new NewDesignError('原换稿请求与完整输入不一致或回放证据缺失，请保留原键核对，不能覆盖。',409),{mutationOutcome:'unknown'});
}

export async function readRevisionOriginal(db:Pool|PoolClient,typeKey:string,scopeType:string,scopeId:string,request:Record<string,unknown>){
  const scope=await requireRecordCard(db,scopeId,scopeType,'原换稿来源不存在。');
  const rows=await listRecordCards(db,typeKey,{where:{book_id:scope.book_id,idempotency_key:request.idempotencyKey},includeArchived:true});
  if(rows.length>1)throw Object.assign(new NewDesignError('原换稿请求键身份冲突，请保留原键核对。',409),{mutationOutcome:'unknown'});
  if(!rows.length)return null;
  await assertRevisionOriginal(db,typeKey,rows[0].id,request);
  return rows[0];
}

export async function revisionFailure(client:PoolClient,error:unknown,committing:boolean):Promise<Error>{
  let rolledBack=false;
  try{await client.query('ROLLBACK');rolledBack=true;}catch{/* A lost connection cannot prove the outcome. */}
  if(error instanceof Error&&'mutationOutcome' in error)return error;
  return Object.assign(new NewDesignError(error instanceof NewDesignError?error.message:'换稿结果未能确认，请保留原键和完整输入核对。',error instanceof NewDesignError?error.status:503),{
    mutationOutcome:committing||!rolledBack?'unknown':'not_written',cause:error,
  });
}
