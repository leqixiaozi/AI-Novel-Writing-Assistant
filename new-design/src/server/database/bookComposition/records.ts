import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../domain/errors';
import {createRecordCard,listRecordCards} from '../recordCards';
import {requireCardWorkflowTypes} from '../cardWorkflow';
import {formHash} from '../formAssist';
export {planningObjectRows,planningVersionReferenceRows,chapterWritingRequestRows,chapterAdoptionPreparationRows,chapterBodyOperationRows} from '../chapterProduction/persistence';
export {patchPlanningRecord,lockPlanningBook} from '../planning/records';
export {lockStoryRecords} from '../storyTimeline/persistence';

type ReceiptKind='book_composition_order_event'|'book_composition_timeline_command';
function originalUnavailable(message:string){return Object.assign(new NewDesignError(message,503),{mutationOutcome:'unknown'});}
export async function readCompositionReceipt(client:PoolClient,typeKey:ReceiptKind,bookId:string,key:string){
  await requireCardWorkflowTypes(client,[typeKey]);
  const rows=await listRecordCards(client,typeKey,{where:{book_id:bookId,request_key:key},includeArchived:true});
  if(rows.length>1)throw originalUnavailable('原编排请求键身份不唯一，请保留原凭证核对。');
  if(!rows.length)return null;
  const row=rows[0];
  const inputHash=row.full_input?formHash(typeKey==='book_composition_order_event'?{bookId,input:row.full_input}:row.full_input):null;
  if(!row.receipt||row.receipt.bookId!==bookId||row.receipt.requestKey!==key||row.receipt.inputHash!==row.input_hash||row.input_hash!==inputHash||row.receipt_hash!==formHash(row.receipt))
    throw originalUnavailable('原编排回执与本书、请求或完整内容不一致，请保留原凭证核对。');
  return row;
}

/** Called under the original book/request lock and the caller-owned write transaction. */
export async function appendCompositionReceipt(client:PoolClient,typeKey:ReceiptKind,bookId:string,key:string,inputHash:string,input:unknown,receipt:{bookId:string;requestKey:string;inputHash:string},id=randomUUID()):Promise<void>{
  await requireCardWorkflowTypes(client,[typeKey],true);
  if(await readCompositionReceipt(client,typeKey,bookId,key))throw new NewDesignError('原编排请求已经保存，不能覆盖回执。',409);
  if(receipt.bookId!==bookId||receipt.requestKey!==key||receipt.inputHash!==inputHash)throw new NewDesignError('编排回执与原请求不一致，未提交。',422);
  const book=assertFound((await client.query('SELECT space_id FROM new_design.books WHERE id=$1',[bookId])).rows[0],'原书籍不存在。');
  await createRecordCard(client,{id,spaceId:String(book.space_id),typeKey,title:'全书编排原请求回执',values:{id,book_id:bookId,request_key:key,input_hash:inputHash,full_input:input,receipt,receipt_hash:formHash(receipt)}});
}

export async function compositionStoryIds(client:PoolClient,typeKey:'story_time_proposal'|'story_relation_proposal'|'story_event_narrative_occurrence',bookId:string,lock:boolean){
  return(await listRecordCards(client,typeKey,{where:{book_id:bookId},lock})).map(row=>({id:row.id})).sort((a,b)=>a.id.localeCompare(b.id));
}
