import {z} from "zod";
import type {WorldConsistencyInput,WorldConsistencyWorkspace} from "../../../common/worldConsistency";
import {getWorldConsistencyPool as getNewDesignPool} from "../../database/worldConsistency";
import {getQualityIssueInTransaction} from "../../database/qualityAudits";
import * as domain from "../../database/worldConsistency";
import {preparePrompt} from "../../ai/prompts";
import {executeManagedPrompt,type ExecutionDependencies} from "../../ai/runtime/managedExecution";
import {AiExecutionError} from "../../ai/runtime/errors";
import {assertFound} from "../../domain/errors";
import {getManagedCredentialEnvironment} from '../../database/modelManagement';
import type {WorldConsistencyOutput} from "../../../common/worldConsistency";
export {worldConsistencyInputSchema,WorldConsistencyError,getWorldConsistencyRepairDraft,getWorldRepairSavedReceipt,getWorldRepairNormalSaveReceipt,recordWorldRepairSaved} from "../../database/worldConsistency";
export async function getWorldConsistencyWorkspace(bookId:string):Promise<WorldConsistencyWorkspace>{
 z.string().uuid().parse(bookId);const client=await(await getNewDesignPool()).connect();try{
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");const catalog=await domain.readWorldConsistencyCatalog(client,bookId),ids=(await client.query("SELECT id FROM new_design.world_consistency_requests WHERE book_id=$1 ORDER BY created_at DESC LIMIT 100",[bookId])).rows,requests=[];
  for(const row of ids)requests.push(domain.worldReceipt(assertFound(await domain.readWorldRequest(client,bookId,String(row.id)),"原检查回执不存在。")));
  const issueIds=(await client.query("SELECT issue.id FROM new_design.quality_issues issue JOIN new_design.quality_issue_versions version ON version.id=issue.current_version_id WHERE issue.book_id=$1 AND version.category_key='world_consistency' ORDER BY issue.created_at DESC LIMIT 100",[bookId])).rows,issues=[];
  for(const row of issueIds)issues.push(await getQualityIssueInTransaction(client,String(row.id)));await client.query("COMMIT");return{catalog,requests,issues};
 }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
}
export async function getWorldConsistencyByKey(bookId:string,key:string){z.string().uuid().parse(bookId);z.string().uuid().parse(key);return domain.worldTransaction(bookId,key,async client=>{const row=await domain.readWorldRequest(client,bookId,undefined,key);return row?domain.worldReceipt(row):null;});}
export async function getWorldConsistencyResult(bookId:string,id:string){z.string().uuid().parse(bookId);z.string().uuid().parse(id);return domain.worldTransaction(bookId,undefined,async client=>domain.worldReceipt(assertFound(await domain.readWorldRequest(client,bookId,id),"本书原检查不存在，不替换其他报告。")));}
export const importSavedWorldConsistency=(bookId:string,id:string)=>domain.importWorldConsistencyOutput(z.string().uuid().parse(bookId),z.string().uuid().parse(id));
export const endExpiredUnknownWorldConsistency=(bookId:string,id:string)=>domain.endExpiredWorldConsistency(z.string().uuid().parse(bookId),z.string().uuid().parse(id));
export const releaseSavedWorldConsistency=(bookId:string,id:string)=>domain.releaseSavedWorldConsistency(z.string().uuid().parse(bookId),z.string().uuid().parse(id));
export async function runWorldConsistency(bookId:string,value:WorldConsistencyInput,dependencies:ExecutionDependencies={}){
 z.string().uuid().parse(bookId);const input=domain.worldConsistencyInputSchema.parse(value),claim=await domain.claimWorldConsistency(bookId,input);if(!claim.claimed)return claim.receipt;
 const prompt=preparePrompt("world_consistency",{contract:"world_consistency_v1",catalog:claim.plan.catalog,recheck:claim.plan.recheck});await domain.markWorldConsistencySending(bookId,claim.receipt.id);let executed:Awaited<ReturnType<typeof executeManagedPrompt<WorldConsistencyOutput>>>;const started=Date.now();
 try{executed=await executeManagedPrompt<WorldConsistencyOutput>("world_consistency",prompt,{...dependencies,stopOnUnknownResponse:true,credentialResolver:dependencies.credentialResolver??((id,provider)=>domain.worldTransaction(bookId,undefined,client=>getManagedCredentialEnvironment(id,provider,{client}))),routeResolver:async()=>claim.plan.route,snapshotWriter:async()=>({id:claim.plan.snapshotId,snapshotHash:claim.plan.snapshotHash,taskType:"world_consistency",route:claim.plan.route})});}
 catch(error){const failure=error instanceof AiExecutionError?error:null,trace=failure?.executionSnapshot??null,attempts=trace&&Array.isArray(trace.attempts)?trace.attempts:[],sent=attempts.some(a=>a&&typeof a==="object"&&"requestSent" in a&&a.requestSent===true),received=attempts.some(a=>a&&typeof a==="object"&&"responseReceived" in a&&a.responseReceived===true),state=received?"completed":sent||!trace?"sent_unknown":"not_sent";return domain.failWorldConsistency(bookId,claim.receipt.id,state,trace?{...trace,durationMs:Date.now()-started}:null,failure?.message??"原模型执行回执尚未确认，请核对原请求，不重复调用。");}
 await domain.retainWorldConsistencyOutput(bookId,claim.receipt.id,executed.output,{...executed.modelSnapshot,durationMs:Date.now()-started});return domain.importWorldConsistencyOutput(bookId,claim.receipt.id);
}
