import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {AiRuntimeRecovery} from '../../../common/aiRuntime';
import {prepareCreativeSchema,creativeModelOutputSchema,CREATIVE_EXTRACTION_ROUTE,type CreativePreview,type CreativeOutput} from '../../../common/creativeExtraction';
import {preparePrompt} from '../../ai/prompts';
import {AiExecutionError} from '../../ai';
import {stableHash} from '../aiContracts';
import {assertFound,NewDesignError} from '../../domain/errors';
import {creativeTransaction,creativePool,creativeLock} from './repository';
import {readCreativeTaskInput} from './sources';
import {freezeCreativePlan,type CreativeFrozenPlan} from './freeze';
export type CreativeRow=Record<string,any>;
export function creativePreview(row:CreativeRow,repeated=false):CreativePreview{return{id:String(row.id),requestKey:String(row.request_key),bookId:String(row.book_id),mode:row.mode,revision:Number(row.revision),status:row.status,originalInput:row.original_input,runInput:row.run_input??null,input:row.input_payload,output:row.output_payload??null,taskId:row.task_id??null,attemptId:row.attempt_id??null,failure:row.failure??(row.status==='running'?{failedStep:'核对原创作提炼结果',summary:'原请求已领取；只读刷新核对，不重复调用模型。',savedResult:'冻结来源、完整输入及领取记录保留；原资源、书名和正文未由调用覆盖。',actionLabel:'返回创作提炼',sourceRoute:`${CREATIVE_EXTRACTION_ROUTE}?bookId=${row.book_id}&previewId=${row.id}`,mutationOutcome:'unknown'}:null),replySaved:row.output_payload!==null,ledgerPending:row.output_payload!==null&&row.status==='running',repeated};}
export async function readCreativeRow(client:PoolClient,id:string,lock=false){return assertFound((await client.query(`SELECT * FROM new_design.creative_extraction_previews WHERE id=$1${lock?' FOR UPDATE':''}`,[id])).rows[0],'原创作提炼预览不存在。');}
export async function readCreativeExtractionPreview(id:string):Promise<CreativePreview>{z.string().uuid().parse(id);const client=await(await creativePool()).connect();try{return creativePreview(await readCreativeRow(client,id));}finally{client.release();}}
export async function readCreativeExtractionByKey(key:string):Promise<CreativePreview|null>{z.string().trim().min(8).max(160).parse(key);return creativeTransaction('读取原创作提炼回执',undefined,async client=>{await creativeLock(client,`prepare:${key}`);const row=(await client.query('SELECT * FROM new_design.creative_extraction_previews WHERE request_key=$1',[key])).rows[0];return row?creativePreview(row,true):null;});}
export async function prepareCreativeExtraction(raw:unknown):Promise<CreativePreview>{const input=prepareCreativeSchema.parse(raw),hash=stableHash(input);return creativeTransaction('准备写法、正文清洗或标题候选',input.bookId,async(client,priorConflict)=>{
 await creativeLock(client,`prepare:${input.requestKey}`);await creativeLock(client,`book:${input.bookId}`);
 const prior=(await client.query('SELECT * FROM new_design.creative_extraction_previews WHERE request_key=$1',[input.requestKey])).rows[0];if(prior){if(prior.input_hash!==hash){priorConflict();throw new NewDesignError('原请求凭证用于不同提炼输入；保留原凭证，只读核对。',409);}return creativePreview(prior,true);}
 const taskInput=await readCreativeTaskInput(client,input),id=randomUUID();let plan:CreativeFrozenPlan|null=null,failure:AiRuntimeRecovery|null=null;const manualOnly=input.mode==='writing_resource'&&(!taskInput.fields.length||taskInput.fields.some(field=>field.required&&(field.hidden||field.aiSuggestible===false||field.type==='select'&&!field.options.length)));
 // Only known configuration/preflight errors can create a blocked preview. A SQL
 // error is not swallowed and cannot leave half a contract disguised as blocked.
 if(manualOnly)failure={failedStep:'核对写法正式字段的AI建议能力',summary:'当前正式规格含不允许AI建议的必填字段、缺少可选字典项或尚无字段；可以人工审阅填写，或点击内容类型核对规格，不冒充可生成。',savedResult:'参考精确版本、人工表单与预览已保存；未领取任务，未发送模型。',sourceRoute:`${CREATIVE_EXTRACTION_ROUTE}?bookId=${input.bookId}&previewId=${id}`,actionLabel:'返回创作提炼',mutationOutcome:'committed'};
 else try{plan=await freezeCreativePlan(client,id,taskInput,preparePrompt('creative_extraction',taskInput));}catch(error){if(!(error instanceof AiExecutionError)||error.status!==422)throw error;failure={...error.recovery,failedStep:'准备创作提炼模型',savedResult:'参考精确版本、人工表单与预览已保存；未领取任务，未发送模型。',mutationOutcome:'committed' as const};}
 const row=(await client.query("INSERT INTO new_design.creative_extraction_previews(id,request_key,book_id,mode,input_hash,original_input,input_payload,frozen_plan,status,failure) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb) RETURNING *",[id,input.requestKey,input.bookId,input.mode,hash,JSON.stringify(input),JSON.stringify(taskInput),plan?JSON.stringify(plan):null,plan?'ready':'blocked',failure?JSON.stringify(failure):null])).rows[0];return creativePreview(row);
 });}
export function parsedCreativeOutput(plan:CreativeFrozenPlan,value:unknown):CreativeOutput{const prompt=preparePrompt('creative_extraction',plan.input);const output=creativeModelOutputSchema.parse(prompt.parseOutput(value));return{...output,candidates:output.candidates.map(candidate=>({...candidate,id:randomUUID()}))};}
