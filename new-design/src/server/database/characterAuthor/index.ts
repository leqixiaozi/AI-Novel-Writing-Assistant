import {characterCapability,characterRecordCtes,insertCharacterRecords,updateCharacterRecords,lockCharacterRecord} from '../characterDialogue/storage';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {characterAuthorInputSchema,characterAuthorOutputSchema,type CharacterAuthorInput,type CharacterAuthorPromptInput,type CharacterAuthorResult,type CharacterAuthorWorkspace} from '../../../common/characterAuthor';
import {getNewDesignPool} from '../runtime';
import {stableHash} from '../aiContracts';
import {NewDesignError,assertFound} from '../../domain/errors';
import {readCharacterAuthorReply,type CharacterAuthorReplyReferences} from '../../ai/imageGeneration/receipts';
import {readCharacterAuthorSource,characterAuthorChaptersSql} from './sources';
import {freezeCharacterAuthor} from './freeze';
import {preparePrompt} from '../../ai/prompts';

export class CharacterAuthorError extends NewDesignError {
 readonly recovery;
 constructor(message:string,status=503,outcome:'unknown'|'not_written'='unknown',bookId?:string,cardId?:string){super(message,status);this.recovery={failedStep:'核对人物谈话与场景分析',summary:message,savedResult:'原消息、来源版本及原请求保留；只读核对不会重新调用模型。',sourceRoute:bookId?`/new-design/books/${bookId}/story-setting?tab=characters${cardId?`&selected=${cardId}&detail=intelligence`:''}`:'/new-design/operations/recovery',actionLabel:'返回人物来源',mutationOutcome:outcome};}
}
export async function authorTransaction<T>(work:(client:PoolClient,absent:()=>void)=>Promise<T>,key?:string):Promise<T>{
 let client:PoolClient;try{client=await(await getNewDesignPool()).connect();}catch{throw new CharacterAuthorError('人物谈话连接未建立，请保留原请求。');}
 let absent=false,commit=false;
 try{await client.query('BEGIN');if(key)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`character-author:${key}`]);const value=await work(client,()=>{absent=true;});commit=true;await client.query('COMMIT');return value;}
 catch(error){let rollback=false;try{await client.query('ROLLBACK');rollback=true;}catch{}throw new CharacterAuthorError(error instanceof NewDesignError?error.message:'人物谈话回执未确认，请保留原键核对。',error instanceof NewDesignError?error.status:503,absent&&!commit&&rollback?'not_written':'unknown');}
 finally{client.release();}
}
type Plan=Awaited<ReturnType<typeof freezeCharacterAuthor>>;
type Row={id:string;book_id:string;card_id:string;input_payload:CharacterAuthorInput;source_snapshot:CharacterAuthorResult['source'];frozen_plan:Plan;request_hash:string;step_id:string;attempt_id:string;status:CharacterAuthorResult['status'];reply:{output:unknown;execution:Record<string,unknown>}|null;output:CharacterAuthorResult['output'];summary:string;expired:boolean};
const uuid=z.string().uuid();
export const characterAuthorRefs=(row:Row):CharacterAuthorReplyReferences=>({scopeKind:'character_author',bookId:row.book_id,cardId:row.card_id,requestId:row.id,attemptId:row.attempt_id,inputHash:row.frozen_plan.inputHash});
async function capability(client:PoolClient){return characterCapability(client,['character_author_trial'],'new_design.assert_character_author_trial(jsonb,jsonb)');}
async function read(client:PoolClient,id:string,byKey=false,lock=false):Promise<Row|null>{if(!(await capability(client)).installed)return null;const sql=`WITH ${characterRecordCtes.character_author_trials}
SELECT receipt.*,step.lease_expires_at<=now() expired FROM character_author_trials receipt JOIN new_design.ai_task_steps step ON step.id=receipt.step_id WHERE receipt.${byKey?'request_key':'id'}=$1`;let row=(await client.query<Row>(sql,[id])).rows[0]??null;if(row&&lock){for(const[table,id]of [['ai_tasks',row.id],['ai_task_steps',row.step_id],['ai_task_attempts',row.attempt_id]])await client.query(`SELECT id FROM new_design.${table} WHERE id=$1 FOR UPDATE`,[id]);await lockCharacterRecord(client,row.id,'character_author_trial');row=(await client.query<Row>(sql,[id])).rows[0]??null;}return row;}
const savedReply=(row:Row)=>row.reply?Promise.resolve(row.reply):readCharacterAuthorReply(characterAuthorRefs(row));
async function present(row:Row):Promise<CharacterAuthorResult>{const saved=await savedReply(row);return{id:row.id,input:row.input_payload,source:row.source_snapshot,status:row.status,output:row.output,canCompleteSaved:row.status==='running'&&saved!==null,canEndExpired:row.status==='running'&&saved===null&&row.expired===true,summary:row.summary};}
export const readCharacterAuthorByKey=(key:string)=>authorTransaction(async client=>{const row=await read(client,uuid.parse(key),true);return row?present(row):null;});
export async function getCharacterAuthorWorkspace(bookId:string,cardId:string,cutoffBodyVersionId:string|null):Promise<CharacterAuthorWorkspace>{return authorTransaction(async client=>{
 uuid.parse(bookId);uuid.parse(cardId);if(cutoffBodyVersionId)uuid.parse(cutoffBodyVersionId);
 const book=assertFound((await client.query("SELECT space_id FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0],'本书不存在或已归档。');
 if(!(await client.query("SELECT card.id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='character' WHERE card.id=$1 AND card.space_id=$2 AND card.status='active'",[cardId,book.space_id])).rowCount)throw new NewDesignError('指定人物不属于本书，不改选其他人。',404);
 const chapters=(await client.query(characterAuthorChaptersSql,[bookId])).rows;if(chapters.length>1000)throw new NewDesignError('正文范围超过1000章，不显示截断清单。',422);
 const enabled=await capability(client),rows=enabled.installed?(await client.query<{id:string}>(`WITH ${characterRecordCtes.character_author_trials}
SELECT id FROM character_author_trials WHERE book_id=$1 AND card_id=$2 ORDER BY created_at DESC,id DESC LIMIT 201`,[bookId,cardId])).rows:[];
 const results:CharacterAuthorResult[]=[];for(const item of rows.slice(0,200))results.push(await present(assertFound(await read(client,item.id),'人物原结果未读取。')));
 return{bookId,cardId,chapters:chapters.map(item=>({bodyVersionId:String(item.bodyVersionId),title:String(item.title),order:Number(item.order)})),source:chapters.length&&!cutoffBodyVersionId?null:await readCharacterAuthorSource(client,bookId,cardId,cutoffBodyVersionId),results,resultsTruncated:rows.length>200,capability:enabled};
 });}
export async function claimCharacterAuthor(raw:unknown){const input=characterAuthorInputSchema.parse(raw);return authorTransaction(async(client,absent)=>{
 const prior=await read(client,input.requestKey,true);if(prior){if(prior.request_hash!==stableHash(input))throw new NewDesignError('同一人物谈话原键不能改动完整输入。',409);return{claimed:false as const,result:await present(prior)};}
 if((await client.query('SELECT id FROM new_design.ai_tasks WHERE request_idempotency_key=$1',[input.requestKey])).rowCount)throw new NewDesignError('原任务已存在但专属回执未确认，不重新调用模型。',409);
 absent();if(!(await capability(client)).operational)throw new NewDesignError('人物谈话与场景分析尚未启用，原消息保留。',503);
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`character-author-person:${input.bookId}:${input.cardId}`]);
 if((await client.query(`WITH ${characterRecordCtes.character_author_trials}
SELECT id FROM character_author_trials WHERE book_id=$1 AND card_id=$2 AND status='running' LIMIT 1`,[input.bookId,input.cardId])).rowCount)throw new NewDesignError('此人物有原谈话请求待核对，请先处理原结果。',409);
 const source=await readCharacterAuthorSource(client,input.bookId,input.cardId,input.cutoffBodyVersionId);if(source.hash!==input.sourceHash)throw new NewDesignError('人物或正文来源已变化，请保留消息重新读取来源。',409);
 const rounds=(await client.query<Row>(`WITH ${characterRecordCtes.character_author_trials}
SELECT * FROM character_author_trials WHERE book_id=$1 AND card_id=$2 AND status='succeeded' AND source_snapshot->>'hash'=$3 ORDER BY created_at,id LIMIT 101`,[input.bookId,input.cardId,source.hash])).rows;
 if(rounds.length>100||stableHash(rounds.map(row=>row.input_payload.requestKey))!==stableHash(input.historyKeys))throw new NewDesignError('人物对话历史已变化或超出100回合，请读取完整原回合，不用漏项历史继续。',409);
 const history:CharacterAuthorPromptInput['history']=rounds.map(row=>({requestKey:row.input_payload.requestKey,kind:row.input_payload.kind,message:row.input_payload.message,output:characterAuthorOutputSchema.parse(row.output)}));
 const promptInput:CharacterAuthorPromptInput={contract:'character_author_v1',input,source,history},id=randomUUID(),stepId=randomUUID(),attemptId=randomUUID(),lease=randomUUID(),plan=await freezeCharacterAuthor(client,id,promptInput),space=(await client.query('SELECT space_id FROM new_design.books WHERE id=$1',[input.bookId])).rows[0].space_id;
 await client.query("INSERT INTO new_design.ai_tasks(id,space_id,book_id,task_key,task_contract_version_id,source_route,source_kind,source_id,request_idempotency_key,request_hash,status,current_step_key,created_by) VALUES($1,$2,$3,$4,$5,$6,'character_author',$1,$7,$8,'running','character_author','character_author')",[id,space,input.bookId,`character_author_${id}`,plan.contractVersionId,`/new-design/books/${input.bookId}/story-setting?tab=characters&selected=${input.cardId}&detail=intelligence`,input.requestKey,stableHash(input)]);
 await client.query("INSERT INTO new_design.ai_task_steps(id,task_id,step_key,sort_order,status,max_attempts,lease_owner,lease_token,lease_expires_at,heartbeat_at) VALUES($1,$2,'character_author',0,'running',1,'character_author',$3,now()+($4::int*interval '1 millisecond'),now())",[stepId,id,lease,plan.timeoutMs+60000]);
 await client.query("INSERT INTO new_design.ai_task_attempts(id,task_id,step_id,attempt_number,trigger_kind,status,task_contract_version_id,prompt_recipe_version_id,context_manifest_id,model_route_snapshot_id,input_hash,output_schema_version,lease_token_digest,started_at) VALUES($1,$2,$3,1,'initial','running',$4,$5,$6,$7,$8,$9,$10,now())",[attemptId,id,stepId,plan.contractVersionId,plan.recipeVersionId,plan.manifestId,plan.snapshotId,plan.inputHash,plan.outputSchemaVersion,stableHash(lease)]);
 await client.query('UPDATE new_design.ai_task_steps SET current_attempt_id=$2,revision=revision+1 WHERE id=$1',[stepId,attemptId]);
 for(const kind of ['task','step','attempt'])await client.query("INSERT INTO new_design.ai_task_events(id,task_id,step_id,attempt_id,entity_kind,from_status,to_status,reason_code,reason_detail,actor_kind,actor) VALUES($1,$2,$3,$4,$5,NULL,'running','character_author_claimed','单个人物谈话原来源已领取','worker','character_author')",[randomUUID(),id,kind==='task'?null:stepId,kind==='attempt'?attemptId:null,kind]);
 await insertCharacterRecords(client,'character_author_trial',`SELECT ($1)::uuid AS id,($2)::uuid AS book_id,($3)::uuid AS card_id,($4)::uuid AS request_key,($5)::char(64) AS request_hash,($6::jsonb)::jsonb AS input_payload,($7::jsonb)::jsonb AS source_snapshot,($8::jsonb)::jsonb AS frozen_plan,($9)::uuid AS step_id,($10)::uuid AS attempt_id`,[id,input.bookId,input.cardId,input.requestKey,stableHash(input),JSON.stringify(input),JSON.stringify(source),JSON.stringify(plan),stepId,attemptId]);
 return{claimed:true as const,result:await present(assertFound(await read(client,id),'原谈话请求未读取。')),plan,attemptId};
 },input.requestKey);}
async function finish(client:PoolClient,row:Row,status:Exclude<CharacterAuthorResult['status'],'running'>,output:CharacterAuthorResult['output'],execution:Record<string,unknown>|null,summary:string){
 const number=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null,terminal=status==='ended_unknown'?'cancelled':status==='stale'?'succeeded':status,attemptStatus=status==='ended_unknown'?'discarded':terminal;
 await client.query('INSERT INTO new_design.ai_attempt_usage(id,task_id,step_id,attempt_id,provider,model,input_tokens,output_tokens,duration_ms,fallback_count,budget_decision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10)',[randomUUID(),row.id,row.step_id,row.attempt_id,row.frozen_plan.route.primary.provider,row.frozen_plan.route.primary.model,number(execution?.inputTokens),number(execution?.outputTokens),number(execution?.durationMs),number(execution?.inputTokens)!==null&&number(execution?.outputTokens)!==null?'within_budget':'unknown']);
 for(const[table,id,state]of [['ai_task_attempts',row.attempt_id,attemptStatus],['ai_task_steps',row.step_id,terminal],['ai_tasks',row.id,terminal]]){const update=await client.query(`UPDATE new_design.${table} SET status=$2 ${table==='ai_task_attempts'?",ended_at=now(),error_summary=$3,error_category=CASE WHEN $2='failed' THEN 'unknown' ELSE NULL END,retry_eligibility=CASE WHEN $2='failed' THEN 'none' ELSE NULL END":',revision=revision+1,completed_at=now(),updated_at=now()'+(table==='ai_task_steps'?',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL':'')} WHERE id=$1 AND status='running'`,table==='ai_task_attempts'?[id,state,summary]:[id,state]);if(update.rowCount!==1)throw new NewDesignError('人物谈话原任务状态已变化，请核对原回执。',409);}
 for(const kind of ['task','step','attempt'])await client.query("INSERT INTO new_design.ai_task_events(id,task_id,step_id,attempt_id,entity_kind,from_status,to_status,reason_code,reason_detail,actor_kind,actor) VALUES($1,$2,$3,$4,$5,'running',$6,'character_author_result',$7,'worker','character_author')",[randomUUID(),row.id,kind==='task'?null:row.step_id,kind==='attempt'?row.attempt_id:null,kind,kind==='attempt'?attemptStatus:terminal,summary]);
 await updateCharacterRecords(client,'character_author_trial',`WITH ${characterRecordCtes.character_author_trials}
SELECT character_author_trials.*,($2)::text AS status,($3::jsonb)::jsonb AS output,($4)::text AS summary FROM character_author_trials WHERE id=$1`,[row.id,status,output===null?null:JSON.stringify(output),summary]);
}
export const completeCharacterAuthor=(id:string)=>authorTransaction(async client=>{
 const row=assertFound(await read(client,uuid.parse(id),false,true),'原人物谈话请求不存在。');if(row.status!=='running')return present(row);const saved=await savedReply(row);if(!saved)throw new NewDesignError('尚无已收到的原回复，不重新调用模型。',409);
 const output=characterAuthorOutputSchema.parse(preparePrompt('character_author',row.frozen_plan.promptInput).parseOutput(saved.output));if(output.bookId!==row.book_id||output.cardId!==row.card_id||output.sourceHash!==row.source_snapshot.hash||!output.sourceVersionIds.every(id=>row.source_snapshot.versionIds.includes(id)))throw new NewDesignError('原人物谈话回复不属于本人及冻结来源。',409);
 if(row.reply&&stableHash(row.reply)!==stableHash(saved))throw new NewDesignError('原人物回复不可替换。',409);if(!row.reply)await updateCharacterRecords(client,'character_author_trial',`WITH ${characterRecordCtes.character_author_trials}
SELECT character_author_trials.*,($2::jsonb)::jsonb AS reply FROM character_author_trials WHERE id=$1`,[id,JSON.stringify(saved)]);
 let stale=Boolean(row.expired);try{stale=stale||(await readCharacterAuthorSource(client,row.book_id,row.card_id,row.input_payload.cutoffBodyVersionId)).hash!==row.source_snapshot.hash;}catch(error){if(!(error instanceof NewDesignError))throw error;stale=true;}
 await finish(client,row,stale?'stale':'succeeded',output,saved.execution,stale?'原回复已保存；来源变化或原领取过期，仅保留为旧来源候选。':'人物回复与场景分析已保存；均为推断候选，不改写正式认知或正文。');return present(assertFound(await read(client,id),'原人物谈话结果未读取。'));
});
export const endExpiredCharacterAuthor=(id:string)=>authorTransaction(async client=>{const row=assertFound(await read(client,uuid.parse(id),false,true),'原人物谈话请求不存在。');if(row.status!=='running')return present(row);if(!row.expired||await savedReply(row))throw new NewDesignError('原领取尚未过期或已有回复，请先续存原回复。',409);await finish(client,row,'ended_unknown',null,null,'未知领取已明确结束；真实调用与用量仍未知。');return present(assertFound(await read(client,id),'原结果未读取。'));});
export const failCharacterAuthor=(id:string,execution:Record<string,unknown>|null,known:boolean)=>authorTransaction(async client=>{const row=assertFound(await read(client,id,false,true),'原人物谈话请求不存在。');if(row.status==='running'&&known)await finish(client,row,'failed',null,execution,'本次未形成可用谈话结果，原输入与执行记录保留。');return present(assertFound(await read(client,id),'原结果未读取。'));});
