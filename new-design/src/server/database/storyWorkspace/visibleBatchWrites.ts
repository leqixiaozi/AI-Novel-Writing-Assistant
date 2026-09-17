import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {StoryBatchRecord,StoryBatchDraft,VisibleBatchWriteReceipt} from '../../../common/storyWorkspace';
import {NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';
import {formHash,freezeFormContext} from '../formAssist';
import {updateAuthorMaterialInTransaction} from '../authorMaterials';
import {StoryBatchError,validateStoryBatchSlot} from './index';
import {visibleAdoptionSchema} from './adoptions';

export const visibleBatchWriteSchema=z.object({requestKey:z.string().uuid(),items:z.array(z.object({...visibleAdoptionSchema.shape,saveRequestKey:z.string().uuid()}).strict()).min(1).max(20)}).strict().refine(input=>{
 const ids=input.items.map(item=>item.slotId),keys=[input.requestKey,...input.items.flatMap(item=>[item.requestKey,item.saveRequestKey])];
 return new Set(ids).size===ids.length&&new Set(keys).size===keys.length;
},'人物和原请求凭证不可重复。').refine(input=>input.items.every(item=>new Set(item.fieldKeys).size===item.fieldKeys.length),'字段不可重复。');
type Input=z.infer<typeof visibleBatchWriteSchema>;
const hash=(bookId:string,batchKey:string,input:Input)=>formHash({contract:'visible_batch_write_v1',bookId,batchKey,input});
const lock=(db:import('pg').PoolClient,bookId:string,batchKey:string,key:string)=>db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`visible-batch-write:${bookId}:${batchKey}:${key}`]);
function receipt(row:Record<string,any>|undefined,inputHash:string):VisibleBatchWriteReceipt|null{
 if(!row)return null;
 if(row.request_hash!==inputHash||row.decision!=='adopt'||row.candidate_id!==null||row.draft_snapshot?.contract!=='visible_batch_write_v1')throw new StoryBatchError('原批量凭证已有不同范围或输入，请保留原请求核对。',409,'unknown');
 return row.draft_snapshot;
}
export async function readVisibleBatchWrite(bookId:string,batchKey:string,input:Input):Promise<VisibleBatchWriteReceipt|null>{
 const parsed=visibleBatchWriteSchema.parse(input),db=await(await getNewDesignPool()).connect();
 try{await db.query('BEGIN READ ONLY');await lock(db,bookId,batchKey,parsed.requestKey);
  const row=(await db.query("SELECT decision.* FROM new_design.form_ai_draft_decisions decision JOIN new_design.ai_generation_batches batch ON batch.id=decision.batch_id WHERE decision.batch_id=$1 AND batch.book_id=$2 AND decision.idempotency_key=$3 AND batch.input_payload->>'contract'='story_workspace_ai_v1'",[batchKey,bookId,parsed.requestKey])).rows[0];
  const result=receipt(row,hash(bookId,batchKey,parsed));await db.query('COMMIT');return result;
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
/** All candidates, author versions, origins and immutable receipts use one physical commit. */
export async function writeVisibleBatch(bookId:string,batchKey:string,input:Input):Promise<VisibleBatchWriteReceipt>{
 const parsed=visibleBatchWriteSchema.parse(input),db=await(await getNewDesignPool()).connect();let committing=false,sessionLocked=false;
 try{
  // Acquire the original-request lock before the serializable snapshot, so a queued duplicate sees the committed receipt.
  await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[`visible-batch-write:${bookId}:${batchKey}:${parsed.requestKey}`]);sessionLocked=true;await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  const prior=(await db.query('SELECT * FROM new_design.form_ai_draft_decisions WHERE batch_id=$1 AND idempotency_key=$2',[batchKey,parsed.requestKey])).rows[0],original=receipt(prior,hash(bookId,batchKey,parsed));
  if(original){committing=true;await db.query('COMMIT');return original;}
  const batch=(await db.query("SELECT * FROM new_design.ai_generation_batches WHERE id=$1 AND book_id=$2 AND input_payload->>'contract'='story_workspace_ai_v1'",[batchKey,bookId])).rows[0];
  if(!batch||!['visible_prepare','visible_adjust'].includes(batch.input_payload.snapshot.mode))throw new NewDesignError('所选原请求不是本书的外显候选。',422);
  const record:StoryBatchRecord={id:batch.id,bookId,requestKey:batchKey,request:batch.input_payload.request,status:batch.status,stage:batch.stage,error:batch.error_message??'',snapshot:batch.input_payload.snapshot,output:batch.output_payload?.result??null,createdAt:new Date(batch.created_at).toISOString()};
  await db.query("SELECT card.id FROM new_design.cards card JOIN new_design.books book ON book.space_id=card.space_id WHERE book.id=$1 AND card.id=ANY($2::uuid[]) AND card.status='active' ORDER BY card.id FOR UPDATE OF card",[bookId,parsed.items.map(item=>item.slotId)]);
  const drafts=new Map<string,StoryBatchDraft>();
  for(const item of parsed.items){
   const draft=await validateStoryBatchSlot(db,record,item.slotId);
   if(!draft.slot.target||item.sourceHash!==draft.slot.sourceHash||item.fieldKeys.some(key=>!Object.hasOwn(draft.values,key)||!draft.slot.fields.some(field=>field.key===key)))throw new NewDesignError('勾选字段与原人物候选不同，整批未保存。',409);
   drafts.set(item.slotId,draft);
  }
  const items:VisibleBatchWriteReceipt['items']=[];
  for(const item of parsed.items){
   const draft=drafts.get(item.slotId)!,target=draft.slot.target!,adoption={slotId:item.slotId,fieldKeys:item.fieldKeys,sourceHash:item.sourceHash,requestKey:item.requestKey};
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`visible-adoption:${batchKey}:${item.requestKey}`]);
   const existing=(await db.query('SELECT * FROM new_design.form_ai_draft_decisions WHERE batch_id=$1 AND idempotency_key=$2',[batchKey,item.requestKey])).rows[0];
   if(existing&&(existing.request_hash!==formHash({bookId,batchKey,input:adoption})||existing.candidate_id!==item.slotId||existing.decision!=='adopt'))throw new StoryBatchError('原人物采用凭证已有不同输入，保留原批量请求核对。',409,'unknown');
   const decisionId=existing?.id??randomUUID(),selected={...draft,decisionId,values:Object.fromEntries(item.fieldKeys.map(key=>[key,draft.values[key]]))};
   if(!existing)await db.query("INSERT INTO new_design.form_ai_draft_decisions(id,batch_id,candidate_id,decision,selected_field_keys,draft_snapshot,request_hash,source_hash,idempotency_key) VALUES($1,$2,$3,'adopt',$4,$5::jsonb,$6,$7,$8)",[decisionId,batchKey,item.slotId,item.fieldKeys,JSON.stringify(selected),formHash({bookId,batchKey,input:adoption}),item.sourceHash,item.requestKey]);
   const context=await freezeFormContext(db,target,draft.slot.values,[]),localKeys=new Set(context.localFieldKeys),values:Record<string,unknown>={},localValues:Record<string,unknown>={};
   for(const [key,value] of Object.entries({...draft.slot.values,...selected.values}))if(localKeys.has(key))localValues[key]=value;else values[key]=value;
   items.push(await updateAuthorMaterialInTransaction(db,bookId,target.cardId!,{requestKey:item.saveRequestKey,cardTypeId:target.cardTypeId,revision:target.cardRevision!,title:draft.slot.title,values,localValues,formVersionId:target.formVersionId,formResolutionKind:target.formVersionId?'installed_form':'type_schema',aiDraftDecisionIds:[decisionId]}));
  }
  const result:VisibleBatchWriteReceipt={contract:'visible_batch_write_v1',bookId,batchKey,requestKey:parsed.requestKey,inputHash:hash(bookId,batchKey,parsed),items};
  await db.query("INSERT INTO new_design.form_ai_draft_decisions(id,batch_id,candidate_id,decision,draft_snapshot,request_hash,source_hash,idempotency_key) VALUES($1,$2,NULL,'adopt',$3::jsonb,$4,$5,$6)",[randomUUID(),batchKey,JSON.stringify(result),result.inputHash,formHash(parsed.items.map(item=>[item.slotId,item.sourceHash])),parsed.requestKey]);
  committing=true;await db.query('COMMIT');return result;
 }catch(error){let rolledBack=false;try{await db.query('ROLLBACK');rolledBack=true;}catch{}if(error instanceof StoryBatchError)throw error;throw new StoryBatchError(error instanceof NewDesignError?error.message:'批量保存未完成，保留原请求核对。',error instanceof NewDesignError?error.status:503,!committing&&rolledBack?'not_written':'unknown');}finally{let releaseError:Error|undefined;if(sessionLocked)try{await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`visible-batch-write:${bookId}:${batchKey}:${parsed.requestKey}`]);}catch{releaseError=new Error('Original request lock connection must be discarded.');}db.release(releaseError);}
}
