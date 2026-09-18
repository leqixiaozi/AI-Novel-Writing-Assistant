import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {PUBLIC_CHARACTER_ROUTE,type PublicCharacterSource,type PublicCharacterTrial,type PublicCharacterTrialInput} from '../../../common/publicCharacters';
import type {FieldDefinition} from '../../../common/contracts';
import {getNewDesignPool} from '../runtime';
import {stableHash} from '../aiContracts';
import {assertFound,NewDesignError} from '../../domain/errors';
export class PublicCharacterError extends NewDesignError {
 readonly recovery;
 constructor(message:string,status=503,outcome:'unknown'|'not_written'='unknown'){super(message,status);this.recovery={failedStep:'核对公共角色试用',summary:message,savedResult:'角色版本、当前填写、原请求和已有试用结果保留；未知结果只读核对，不重新调用模型。',sourceRoute:PUBLIC_CHARACTER_ROUTE,actionLabel:'返回公共角色试用',mutationOutcome:outcome};}
}
export async function transaction<T>(key:string|undefined,work:(client:PoolClient,markAbsent:()=>void)=>Promise<T>):Promise<T>{
 let client:PoolClient;try{client=await(await getNewDesignPool()).connect();}catch{throw new PublicCharacterError('公共角色结果连接未建立，原请求保留。');}
 let absent=false,committing=false;try{await client.query('BEGIN');if(key)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`public-character:${key}`]);const result=await work(client,()=>{absent=true;});committing=true;await client.query('COMMIT');return result;}catch(error){let ack=false;try{await client.query('ROLLBACK');ack=true;}catch{}throw new PublicCharacterError(error instanceof NewDesignError?error.message:'公共角色原操作回执未确认，保留原请求只读核对。',error instanceof NewDesignError?error.status:503,absent&&!committing&&ack?'not_written':'unknown');}finally{client.release();}
}
export async function capability(client:PoolClient){
 const exists=(await client.query("SELECT to_regclass('new_design.public_character_workshop_capability') IS NOT NULL present")).rows[0].present===true;
 if(!exists)return{installed:false,operational:false};
 const row=(await client.query(`SELECT operational,
 (SELECT count(*) FROM pg_trigger WHERE (tgrelid='new_design.public_character_trials'::regclass AND tgname='public_character_trial_guard' AND tgfoid=to_regprocedure('new_design.guard_public_character_trial()') OR tgrelid='new_design.public_character_portrait_events'::regclass AND tgname='public_character_portrait_event_guard' AND tgfoid=to_regprocedure('new_design.guard_public_character_portrait_event()') OR tgrelid='new_design.context_manifests'::regclass AND tgname='public_character_manifest_guard' AND tgfoid=to_regprocedure('new_design.guard_public_character_manifest()')) AND tgenabled IN ('O','A'))=3 protected
 FROM new_design.public_character_workshop_capability WHERE contract='public_character_trial_v1'`)).rows[0];
 return{installed:row?.protected===true,operational:row?.protected===true&&row.operational===true};
}
export async function requireOperational(client:PoolClient){if(!(await capability(client)).operational)throw new NewDesignError('公共角色试用未启用；原版本和已有结果可只读核对。',503);}
export async function readSource(client:PoolClient,id:string,versionId:string,active=true):Promise<PublicCharacterSource>{
 const row=assertFound((await client.query(`SELECT card.id,version.id version_id,version.revision,version.title,version.values,version.type_version_id,spec.fields FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.card_versions version ON version.card_id=card.id JOIN new_design.card_type_versions spec ON spec.id=version.type_version_id AND spec.card_type_id=type.id
 WHERE card.id=$1 AND version.id=$2 AND card.space_id='60000000-0000-4000-8000-000000000001' AND type.type_key='character' ${active?"AND card.status='active' AND type.status='published'":""} FOR SHARE OF card,type,version,spec`,[id,versionId])).rows[0],'请选择有效公共角色的确切版本；书内人物不会自动公开。');
 const local=(await client.query(`SELECT definition.id,definition.field_key,version.id version_id,version.field_schema,value.value FROM new_design.card_version_local_values value JOIN new_design.field_definitions definition ON definition.id=value.field_definition_id JOIN new_design.field_definition_versions version ON version.id=value.field_definition_version_id AND version.field_definition_id=definition.id WHERE value.card_version_id=$1 ORDER BY definition.field_key`,[versionId])).rows;
 if(local.some(item=>Object.hasOwn(row.values,item.field_key)))throw new NewDesignError('公共角色原字段与补充键重复，保留原来源核对。',422);
 const source={id:String(row.id),versionId:String(row.version_id),revision:Number(row.revision),typeVersionId:String(row.type_version_id),title:String(row.title),values:{...row.values,...Object.fromEntries(local.map(item=>[item.field_key,item.value]))},fields:[...row.fields as FieldDefinition[],...local.map(item=>item.field_schema as FieldDefinition)],localFields:local.map(item=>({definitionId:String(item.id),versionId:String(item.version_id),field:item.field_schema as FieldDefinition,value:item.value}))};
 return{...source,hash:stableHash(source)};
}
export type TrialRow=Record<string,unknown>&{id:string;request_key:string;request_hash:string;resource_id:string;resource_version_id:string;input_payload:PublicCharacterTrialInput;source_snapshot:PublicCharacterSource;frozen_plan:Record<string,unknown>;status:PublicCharacterTrial['status'];request_state:PublicCharacterTrial['requestState'];reply:unknown;execution:Record<string,unknown>|null;output:PublicCharacterTrial['output'];step_id:string;attempt_id:string;expired:boolean;summary:string;created_at:Date;};
export async function readTrial(client:PoolClient,value:string,byKey=false,lock=false):Promise<TrialRow|null>{
 if((await client.query("SELECT to_regclass('new_design.public_character_trials') IS NOT NULL present")).rows[0].present!==true)return null;
 const query=`SELECT trial.*,step.lease_expires_at<=now() expired FROM new_design.public_character_trials trial JOIN new_design.ai_task_steps step ON step.id=trial.step_id WHERE ${byKey?'trial.request_key':'trial.id'}=$1`;
 let row=(await client.query<TrialRow>(query,[value])).rows[0]??null;
 if(row&&lock){await client.query('SELECT id FROM new_design.ai_tasks WHERE id=$1 FOR UPDATE',[row.id]);await client.query('SELECT id FROM new_design.ai_task_steps WHERE id=$1 FOR UPDATE',[row.step_id]);await client.query('SELECT id FROM new_design.ai_task_attempts WHERE id=$1 FOR UPDATE',[row.attempt_id]);await client.query('SELECT id FROM new_design.public_character_trials WHERE id=$1 FOR UPDATE',[row.id]);row=(await client.query<TrialRow>(query,[value])).rows[0]??null;}return row;
}
export function receipt(row:TrialRow):PublicCharacterTrial{return{id:row.id,requestKey:row.request_key,input:row.input_payload,source:row.source_snapshot,status:row.status,requestState:row.request_state,output:row.output,execution:row.execution,canCompleteSaved:row.status==='running'&&row.reply!==null,canEndExpired:row.status==='running'&&row.reply===null&&row.expired===true,summary:row.summary,createdAt:row.created_at instanceof Date?row.created_at.toISOString():String(row.created_at)};}
export async function finish(client:PoolClient,row:TrialRow,status:'succeeded'|'failed'|'ended_unknown',output:PublicCharacterTrial['output'],summary:string){
 const execution=row.execution??{},plan=row.frozen_plan,connection=plan.connection as Record<string,unknown>|undefined,route=plan.route as {primary?:Record<string,unknown>}|undefined;
 const number=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
 await client.query(`INSERT INTO new_design.ai_attempt_usage(id,task_id,step_id,attempt_id,provider,model,input_tokens,output_tokens,duration_ms,fallback_count,budget_decision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10)`,[randomUUID(),row.id,row.step_id,row.attempt_id,execution.provider??connection?.provider??route?.primary?.provider??'unknown',execution.model??connection?.model??route?.primary?.model??'unknown',number(execution.inputTokens),number(execution.outputTokens),number(execution.durationMs),number(execution.inputTokens)!==null&&number(execution.outputTokens)!==null?'within_budget':'unknown']);
 const terminal=status==='ended_unknown'?'cancelled':status;
 const attemptChange=await client.query('UPDATE new_design.ai_task_attempts SET status=$2,ended_at=now(),error_summary=$3 WHERE id=$1 AND status=\'running\'',[row.attempt_id,status==='ended_unknown'?'discarded':status,summary]);if(attemptChange.rowCount!==1)throw new NewDesignError('原试用尝试状态已变化，保留原结果核对。',409);
 for(const table of ['ai_task_steps','ai_tasks'] as const){const id=table==='ai_tasks'?row.id:row.step_id;const change=await client.query(`UPDATE new_design.${table} SET status=$2,revision=revision+1,completed_at=now(),updated_at=now() ${table==='ai_task_steps'?',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL':''} WHERE id=$1 AND status='running'`,[id,terminal]);if(change.rowCount!==1)throw new NewDesignError('原试用任务状态已变化，保留原结果核对。',409);}
 for(const kind of ['task','step','attempt']as const)await client.query(`INSERT INTO new_design.ai_task_state_events(id,task_id,step_id,attempt_id,entity_kind,from_status,to_status,reason_code,reason_detail,actor_kind,actor) VALUES($1,$2,$3,$4,$5,'running',$6,'public_character_result',$7,'worker','public_characters')`,[randomUUID(),row.id,kind==='task'?null:row.step_id,kind==='attempt'?row.attempt_id:null,kind,kind==='attempt'&&status==='ended_unknown'?'discarded':terminal,summary]);
 await client.query('UPDATE new_design.public_character_trials SET status=$2,output=$3::jsonb,summary=$4 WHERE id=$1',[row.id,status,JSON.stringify(output),summary]);
}
