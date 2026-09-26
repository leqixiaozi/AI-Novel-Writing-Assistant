import type {PoolClient} from 'pg';
import {assertFound} from '../domain/errors';
import {createRecordCard,findRecordCard,listRecordCards,requireRecordCard,type RecordCardDb} from './recordCards';
import {createGenerationBatch,updateGenerationBatch} from './bookCreationProduction/repository';

/** Batch ownership is checked before returning either a frozen input or an output. */
export async function readBookGeneration(db:RecordCardDb,bookId:string,id:string,contract:string,lock=false){
  const row=await findRecordCard(db,id,'ai_generation_batch',{lock});
  return row?.book_id===bookId&&row.input_payload?.contract===contract?row:null;
}

/** The caller owns the request transaction and its idempotency lock. */
export async function createBookGeneration(db:PoolClient,bookId:string,values:Record<string,unknown>){
  const book=assertFound((await db.query('SELECT space_id FROM new_design.books WHERE id=$1',[bookId])).rows[0],'书籍不存在。');
  return createGenerationBatch(db,String(book.space_id),{operation:'form_assist',status:'running',stage:'generating',...values,book_id:bookId});
}

/** Only used after model execution, outside the caller's transaction. No model runs inside this transaction. */
export async function finishBookGeneration(db:PoolClient,bookId:string,id:string,contract:string,patch:Record<string,unknown>){
  await db.query('BEGIN');
  try{
    const row=await readBookGeneration(db,bookId,id,contract,true);
    const saved=row?.status==='running'?await updateGenerationBatch(db,id,patch):null;
    await db.query('COMMIT');return saved;
  }catch(error){await db.query('ROLLBACK');throw error;}
}

export async function readBatchDecision(db:RecordCardDb,batchId:string,requestKey:string){
  return(await listRecordCards(db,'form_ai_draft_decision',{where:{batch_id:batchId,idempotency_key:requestKey}}))[0]??null;
}

/** Decision payloads are immutable records; replay returns the original frozen receipt. */
export async function saveBatchDecision(db:PoolClient,batchId:string,values:Record<string,unknown>){
  const batch=await requireRecordCard(db,batchId,'ai_generation_batch','原候选批次不存在。');
  return createRecordCard(db,{id:values.id as string|undefined,spaceId:batch.recordSpaceId,typeKey:'form_ai_draft_decision',title:'候选确认回执',values:{candidate_id:null,selected_field_keys:[],selected_tag_keys:[],saved_card_id:null,saved_card_version_id:null,...values,batch_id:batchId}});
}
