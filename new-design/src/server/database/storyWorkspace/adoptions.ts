import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {StoryBatchDraft} from '../../../common/storyWorkspace';
import {NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';
import {formHash,freezeFormContext} from '../formAssist';
import {readStoryBatch,checkStoryBatchSlot,StoryBatchError} from './index';
export const visibleAdoptionSchema=z.object({slotId:z.string().uuid(),fieldKeys:z.array(z.string().min(1)).min(1).max(300),sourceHash:z.string().regex(/^[a-f0-9]{64}$/),requestKey:z.string().uuid()}).strict().refine(input=>new Set(input.fieldKeys).size===input.fieldKeys.length,'字段不可重复。');
type Input=z.infer<typeof visibleAdoptionSchema>;
export async function readVisibleAdoption(bookId:string,batchKey:string,input:Input):Promise<StoryBatchDraft|null>{
 const db=await(await getNewDesignPool()).connect();
 try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`visible-adoption:${batchKey}:${input.requestKey}`]);
 const row=(await db.query("SELECT decision.* FROM new_design.form_ai_draft_decisions decision JOIN new_design.ai_generation_batches batch ON batch.id=decision.batch_id WHERE decision.batch_id=$1 AND batch.book_id=$2 AND decision.idempotency_key=$3 AND batch.input_payload->>'contract'='story_workspace_ai_v1'",[batchKey,bookId,input.requestKey])).rows[0];
 if(row&&(row.request_hash!==formHash({bookId,batchKey,input})||row.decision!=='adopt'||row.candidate_id!==input.slotId))throw new StoryBatchError('原外显采用回执与完整输入不同，请保留原凭证核对。',409,'unknown');
 const result=row?row.draft_snapshot:null;await db.query('COMMIT');return result;
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
export async function adoptVisibleFields(bookId:string,batchKey:string,input:Input):Promise<StoryBatchDraft>{
 const parsed=visibleAdoptionSchema.parse(input);
 const db=await(await getNewDesignPool()).connect();let committing=false;
 try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`visible-adoption:${batchKey}:${parsed.requestKey}`]);
  const existing=(await db.query('SELECT * FROM new_design.form_ai_draft_decisions WHERE batch_id=$1 AND idempotency_key=$2',[batchKey,parsed.requestKey])).rows[0];
  if(existing){if(existing.request_hash!==formHash({bookId,batchKey,input:parsed}))throw new StoryBatchError('原采用凭证已有不同输入，结果待核对。',409,'unknown');committing=true;await db.query('COMMIT');return existing.draft_snapshot;}
  const checked=await checkStoryBatchSlot(bookId,batchKey,parsed.slotId),record=await readStoryBatch(bookId,batchKey);
  if(!record||!['visible_prepare','visible_adjust'].includes(record.snapshot.mode)||!checked.slot.target)throw new NewDesignError('本次不是人物外显候选。',422);
  if(parsed.sourceHash!==checked.slot.sourceHash||parsed.fieldKeys.some(key=>!Object.hasOwn(checked.values,key)||!checked.slot.fields.some(field=>field.key===key)))throw new NewDesignError('所选字段与原外显候选不一致，请保留填写。',409);
  const fresh=await freezeFormContext(db,checked.slot.target,checked.slot.values,[]);if(fresh.sourceHash!==parsed.sourceHash)throw new NewDesignError('人物、字段或引用在确认后已更新，采用尚未写入。',409);
  const decisionId=randomUUID(),result:StoryBatchDraft={...checked,decisionId,values:Object.fromEntries(parsed.fieldKeys.map(key=>[key,checked.values[key]]))};
  await db.query("INSERT INTO new_design.form_ai_draft_decisions(id,batch_id,candidate_id,decision,selected_field_keys,draft_snapshot,request_hash,source_hash,idempotency_key) VALUES($1,$2,$3,'adopt',$4,$5::jsonb,$6,$7,$8)",[decisionId,batchKey,parsed.slotId,parsed.fieldKeys,JSON.stringify(result),formHash({bookId,batchKey,input:parsed}),parsed.sourceHash,parsed.requestKey]);
  committing=true;await db.query('COMMIT');return result;
 }catch(error){let rolledBack=false;try{await db.query('ROLLBACK');rolledBack=true;}catch{}if(error instanceof StoryBatchError)throw error;throw new StoryBatchError(error instanceof NewDesignError?error.message:'外显采用服务未完成，保留原凭证核对。',error instanceof NewDesignError?error.status:503,!committing&&rolledBack?'not_written':'unknown');}finally{db.release();}
}
