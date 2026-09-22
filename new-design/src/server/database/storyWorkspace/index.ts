import {readBookGeneration,createBookGeneration,finishBookGeneration} from '../generationBatches';
import {updateGenerationBatch} from '../bookCreationProduction/repository';
import {findRecordCard,listRecordCards} from '../recordCards';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {StoryBatchRecord,StoryBatchRequest,StoryBatchOutput,StoryBatchDraft} from '../../../common/storyWorkspace';
import type {NewDesignAiGateway} from '../../ai/gateway';
import {AiExecutionError} from '../../ai/runtime/errors';
import {preparePrompt,storyBatchTask} from '../../ai/prompts';
import {NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';
import {formHash,freezeFormContext} from '../formAssist';
import {validateFormCandidate} from '../../domain/formAssist';
import {freezeStoryBatch} from './snapshot';
import {assertWorldUsageScopesCurrent} from '../worldUsage';

const base={requestKey:z.string().uuid(),instruction:z.string().trim().max(2000)};
export const storyBatchRequestSchema=z.discriminatedUnion('mode',[
 z.object({...base,mode:z.literal('setting'),typeIds:z.array(z.string().uuid()).min(1).max(20),newTypeId:z.string().uuid(),newCount:z.number().int().min(0).max(10)}).strict().refine(input=>new Set(input.typeIds).size===input.typeIds.length,'内容类型不能重复。'),
 ...(['visible_prepare','visible_adjust'] as const).map(mode=>z.object({...base,mode:z.literal(mode),cardIds:z.array(z.string().uuid()).min(1).max(20)}).strict().refine(input=>new Set(input.cardIds).size===input.cardIds.length,'人物不能重复。')),
 z.object({...base,mode:z.literal('planning'),scopeId:z.union([z.literal('book'),z.string().uuid()])}).strict(),
]);
const contract='story_workspace_ai_v1';
export class StoryBatchError extends NewDesignError {constructor(message:string,status:number,public readonly mutationOutcome:'not_written'|'unknown'){super(message,status);}}
function mapRecord(row:Record<string,any>):StoryBatchRecord{return {id:row.id,bookId:row.book_id,requestKey:row.input_payload.request.requestKey,request:row.input_payload.request,status:row.stage==='ended_unknown'?'ended_unknown':row.status,stage:row.stage,error:row.error_message??'',snapshot:row.input_payload.snapshot,output:row.output_payload?.result??null,createdAt:new Date(row.created_at).toISOString()};}
export async function readStoryBatch(bookId:string,key:string):Promise<StoryBatchRecord|null>{
 const db=await (await getNewDesignPool()).connect();
 try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`story-batch:${bookId}:${key}`]);const row=await readBookGeneration(db,bookId,key,contract);await db.query('COMMIT');return row?mapRecord(row):null;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
export async function validateStoryBatchSlot(db:PoolClient,record:StoryBatchRecord,slotId:string):Promise<StoryBatchDraft>{
 const bookId=record.bookId,key=record.requestKey,slot=record.snapshot.slots.find(item=>item.id===slotId);
 if(!['review','applied'].includes(record.status)||!slot||!record.output?.candidates[slotId])throw new NewDesignError('此原候选尚未准备完成或不属于本书。',409);
 if(record.snapshot.worldUsage)await assertWorldUsageScopesCurrent(db,bookId,record.snapshot.worldUsage);
  const values=record.output.candidates[slotId];
  if(slot.target){
   const fresh=await freezeFormContext(db,slot.target,slot.values,[]);
   if(fresh.sourceHash!==slot.sourceHash)throw new NewDesignError('资料、字段或关联来源已更新，请保留旧候选并另行准备；未覆盖填写。',409);
   const issues=validateFormCandidate(fresh,{id:slotId,name:'整组候选',values,tags:{}},record.snapshot.mode==='visible_prepare'||record.snapshot.mode==='visible_adjust'?'adjust':'prepare_all');
   if(Object.keys(issues).length)throw new NewDesignError('候选字段不符合本书表单，请重新准备。',422,issues);
  }else if(slot.planningId){
   const object=await findRecordCard(db,slot.planningId,'planning_object'),parent=object?.parent_object_id?await findRecordCard(db,object.parent_object_id,'planning_object'):null;
   const plan=object?.book_id===bookId&&object.status==='active'?{...object,parent_version_id:parent?.adopted_version_id??null}:null;
   if(!plan||Number(plan.revision)!==slot.revision||plan.current_version_id!==slot.baseVersionId||(plan.parent_version_id??null)!==slot.parentVersionId)throw new NewDesignError('此规划或上级采用依据已更新，请保留旧候选并另行准备。',409);
  }else if((await listRecordCards(db,'planning_object',{where:{book_id:bookId,level:'story',status:'active'}})).length)throw new NewDesignError('本书已有故事总览，请选择该规划后另行准备。',409);
  const ownIds=new Set(record.snapshot.slots.map(item=>item.target?.cardId).filter(Boolean));
  const materials=record.snapshot.materials.filter(item=>record.snapshot.mode==='planning'||!ownIds.has(item.id));
  const sources=(await db.query(`SELECT card.id,card.current_version_id FROM new_design.cards card JOIN new_design.books book ON book.space_id=card.space_id WHERE book.id=$1 AND card.id=ANY($2::uuid[]) AND card.status='active'`,[bookId,materials.map(item=>item.id)])).rows;
  if(sources.length!==materials.length||materials.some(item=>!sources.some(source=>source.id===item.id&&source.current_version_id===item.versionId)))throw new NewDesignError('本次参考资料已更新，请保留旧候选并另行准备。',409);
  const adopted=record.snapshot.adoptedPlans;
  const plans=(await listRecordCards(db,'planning_object',{where:{book_id:bookId,status:'active'}})).filter(row=>adopted.some(item=>item.id===row.id));
  if(plans.length!==adopted.length||adopted.some(item=>!plans.some(plan=>plan.id===item.id&&plan.adopted_version_id===item.versionId)))throw new NewDesignError('本次采用规划已更新，请保留旧候选并另行准备。',409);
 return {key:`${key}:${slotId}`,bookId,slot,values};
}
export async function checkStoryBatchSlot(bookId:string,key:string,slotId:string):Promise<StoryBatchDraft>{
 const record=await readStoryBatch(bookId,key);if(!record)throw new NewDesignError('此原候选不属于本书。',409);const db=await(await getNewDesignPool()).connect();
 try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await validateStoryBatchSlot(db,record,slotId);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

export async function endUnknownStoryBatch(bookId:string,key:string):Promise<StoryBatchRecord>{
 const db=await (await getNewDesignPool()).connect();
 try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`story-batch:${bookId}:${key}`]);
  const lock=(await db.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked',[`story-execution:${key}`])).rows[0];
  if(!lock?.locked)throw new NewDesignError('原模型请求仍在处理，请先核对结果，不能结束此运行占用。',409);
  const row=await readBookGeneration(db,bookId,key,contract,true);
  if(!row)throw new NewDesignError('未找到原请求，不据此推断未发送；请保留凭证。',404);
  if(row.stage==='ended_unknown'){await db.query('COMMIT');return mapRecord(row);}
  if(row.status!=='running')throw new NewDesignError('原请求已有确定结果，请读取并审阅原结果。',409);
  const ended=await updateGenerationBatch(db,key,{status:'discarded',stage:'ended_unknown',error_message:'原请求已结束占用；模型结果与实际用量仍未确认。已有资料与原请求保留。',completed_at:new Date().toISOString()});
  await db.query('COMMIT');return mapRecord(ended);
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
export async function generateStoryBatch(bookId:string,request:StoryBatchRequest,ai?:NewDesignAiGateway):Promise<StoryBatchRecord>{
 const pool=await getNewDesignPool(),db=await pool.connect(),requestHash=formHash(request);
 let committed=false,committing=false,snapshot:StoryBatchRecord['snapshot'];
 try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`story-batch:${bookId}:${request.requestKey}`]);
  const prior=await readBookGeneration(db,bookId,request.requestKey,contract);
  if(prior){if(prior.input_payload.requestHash!==requestHash)throw new StoryBatchError('原请求内容不匹配，请核对保留的请求。',409,'unknown');await db.query('ROLLBACK');return mapRecord(prior);}
  if(!ai?.generateStoryWorkspaceBatch)throw new NewDesignError('请先在模型设置中连接创作模型。',503);
  snapshot=await freezeStoryBatch(db,bookId,request);
  // Validate the managed prompt before claiming the request or invoking a model.
  const prompt=preparePrompt(storyBatchTask(snapshot.mode),snapshot);
  await createBookGeneration(db,bookId,{id:request.requestKey,instruction:request.instruction,input_payload:{contract,requestHash,request,snapshot},prompt_id:prompt.assetId,prompt_version:prompt.version});
  committing=true;await db.query('COMMIT');committed=true;
 }catch(error){let rolledBack=false;try{await db.query('ROLLBACK');rolledBack=true;}catch{}if(error instanceof StoryBatchError)throw error;throw new StoryBatchError(error instanceof NewDesignError?error.message:'准备请求未完成，请核对原请求。',error instanceof NewDesignError?error.status:503,!committing&&rolledBack?'not_written':'unknown');}finally{db.release();}
 if(!committed)throw new StoryBatchError('原请求结果待核对。',503,'unknown');
 let modelCompleted=false;
 const executionDb=await pool.connect();
 try{
  await executionDb.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[`story-execution:${request.requestKey}`]);
  const current=await readBookGeneration(executionDb,bookId,request.requestKey,contract);
  if(!current)throw new Error('原请求记录未读取。');
  if(current.status!=='running')return mapRecord(current);
  const generated=await ai!.generateStoryWorkspaceBatch!(snapshot!);modelCompleted=true;
  const result=preparePrompt(storyBatchTask(snapshot!.mode),snapshot!).parseOutput(generated.output) as StoryBatchOutput;
  const row=await finishBookGeneration(executionDb,bookId,request.requestKey,contract,{status:'review',stage:'review',progress:100,output_payload:{result,promptSnapshot:generated.promptSnapshot,modelSnapshot:generated.modelSnapshot,usedTokens:generated.usedTokens},completed_at:new Date().toISOString()});
  if(!row)throw new Error('候选保存回执待核对。');
  return mapRecord(row);
 }catch(error){
  const trace=error instanceof AiExecutionError?error.executionSnapshot:null,attempts=Array.isArray(trace?.attempts)?trace!.attempts as Array<{requestSent:boolean;responseReceived:boolean}>:null;
  const confirmedEnd=!modelCompleted&&attempts!==null&&attempts.every(attempt=>!attempt.requestSent||attempt.responseReceived);
  if(confirmedEnd){
   const row=await finishBookGeneration(executionDb,bookId,request.requestKey,contract,{status:'failed',stage:'failed',error_message:error instanceof AiExecutionError?error.message:'本次模型回复未通过候选规格，请检查来源后另行准备。',output_payload:{failureSnapshot:trace},completed_at:new Date().toISOString()}).catch(()=>null);
   if(row)return mapRecord(row);
  }
  // A transport/process failure does not prove that the provider did not execute.
  // Retain the claim. Reads never invoke the model and a repeated key never generates.
  await finishBookGeneration(executionDb,bookId,request.requestKey,contract,{stage:modelCompleted?'result_pending':'result_unknown',error_message:'候选结果待核对，请保留原请求，不重复准备。'}).catch(()=>undefined);
  throw new StoryBatchError('候选生成或保存结果待核对，请读取原请求结果；不会自动再次调用模型。',503,'unknown');
 }finally{await executionDb.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`story-execution:${request.requestKey}`]).catch(()=>undefined);executionDb.release(true);}
}

export {adoptVisibleFields,readVisibleAdoption,visibleAdoptionSchema} from "./adoptions";

export {writeVisibleBatch,readVisibleBatchWrite,visibleBatchWriteSchema} from "./visibleBatchWrites";
