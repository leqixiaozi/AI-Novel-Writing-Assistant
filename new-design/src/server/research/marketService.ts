import type { MarketSourceDefinition, ResearchRecordDetail } from "../../common/contracts";
import type { NewDesignAiGateway } from "../ai/gateway";
import { NewDesignError } from "../domain/errors";
import { getResearchRecord } from "../database/researchStore";
import { beginMarketAnalysis, beginMarketScan, completeMarketAnalysis, failMarketAnalysis, finishMarketScan, getMarketItems, getMarketScan, getMarketAnalysisRequestByKey, marketAnalysisInputHash, isResearchCancellationRequested, persistMarketSource, recoverInterruptedResearchRuns } from "../database/marketStore";
import { collectMarketSource, MARKET_SOURCES } from "./marketSources";

let recovery:Promise<void>|null=null;
const running=new Map<string,Promise<void>>();
export function ensureResearchRecovery():Promise<void>{recovery??=recoverInterruptedResearchRuns();return recovery;}
export function listMarketSources():MarketSourceDefinition[]{return MARKET_SOURCES;}
function resolveSources(keys:string[]):MarketSourceDefinition[]{const unique=[...new Set(keys)];const sources=unique.map((key)=>MARKET_SOURCES.find((source)=>`${source.platform}:${source.listKey}`===key));if(sources.some((source)=>!source))throw new NewDesignError("选择的榜单来源不存在。",422);return sources as MarketSourceDefinition[];}

async function execute(versionId:string,sources:MarketSourceDefinition[]):Promise<void>{for(let index=0;index<sources.length;index+=1){if(await isResearchCancellationRequested(versionId))break;const source=sources[index];try{await persistMarketSource(versionId,source,{items:await collectMarketSource(source)},Math.round(((index+1)/sources.length)*95));}catch(error){if(error instanceof NewDesignError&&error.status===409)break;await persistMarketSource(versionId,source,{error:error instanceof Error?error.message:"榜单采集失败。"},Math.round(((index+1)/sources.length)*95));}}await finishMarketScan(versionId);}

export async function startMarketScan(input:{sourceKeys:string[];recordId?:string;parentVersionId?:string|null}):Promise<{recordId:string;versionId:string;version:number}>{await ensureResearchRecovery();const sources=resolveSources(input.sourceKeys);if(!sources.length)throw new NewDesignError("请至少选择一个公开榜单。",422);const run=await beginMarketScan({sources,recordId:input.recordId,parentVersionId:input.parentVersionId});const task=execute(run.versionId,sources).finally(()=>running.delete(run.versionId));running.set(run.versionId,task);return run;}
export async function retryMarketScan(recordId:string):Promise<{recordId:string;versionId:string;version:number}>{const scan=await getMarketScan(recordId);const raw=Array.isArray(scan.record.currentVersion.sourceScope.sources)?scan.record.currentVersion.sourceScope.sources:[];const keys=raw.flatMap((item)=>item&&typeof item==="object"&&"platform" in item&&"listKey" in item?[`${String(item.platform)}:${String(item.listKey)}`]:[]);return startMarketScan({sourceKeys:keys,recordId,parentVersionId:scan.record.currentVersion.id});}

function addDays(date:string,days:number):string{const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
async function executeAnalysis(ai:NewDesignAiGateway,versionId:string,items:Awaited<ReturnType<typeof getMarketItems>>,focus:string,budgetTokens:number,observedAt:string):Promise<void>{try{const result=await ai.analyzeMarket({items,focus,budgetTokens});const refs=items.map((item)=>`${item.title}（${item.sourceUrl}）`).join("；").slice(0,1700);result.output.signals=result.output.signals.map((signal)=>({...signal,sourceRefs:`${signal.sourceRefs}；选中样本：${refs}`.slice(0,2000),observedAt,effectiveUntil:addDays(observedAt,30)}));await completeMarketAnalysis(versionId,result.output,result);}catch(error){await failMarketAnalysis(versionId,error instanceof Error?error.message:"市场分析失败。");}}
export async function getMarketAnalysisByKey(scanRecordId:string,requestKey:string):Promise<ResearchRecordDetail|null>{
  const receipt=await getMarketAnalysisRequestByKey(scanRecordId,requestKey);if(!receipt)return null;
  const record=await getResearchRecord(receipt.recordId),version=record.versions.find(item=>item.id===receipt.versionId&&item.recordId===receipt.recordId);
  if(record.type!=="market_analysis"||!version||version.sourceScope.scanRecordId!==scanRecordId||version.sourceScope.requestKey!==requestKey)throw new NewDesignError("原市场分析回执与来源不匹配，不能按最新版本代替。",409);
  const scope=version.sourceScope,ids=scope.itemIds,focus=version.inputSnapshot.focus;
  if(typeof scope.scanVersionId!=="string"||!Array.isArray(ids)||!ids.every(id=>typeof id==="string")||typeof focus!=="string"||version.budgetTokens===null)throw new NewDesignError("原市场分析冻结输入不完整，原记录保留，不重新生成。",409);
  const inputHash=marketAnalysisInputHash({scanRecordId,scanVersionId:scope.scanVersionId,itemIds:ids.filter((id):id is string=>typeof id==="string"),focus,budgetTokens:version.budgetTokens,...(version.parentVersionId?{recordId:record.id,parentVersionId:version.parentVersionId}:{})});
  if(scope.inputHash!==inputHash)throw new NewDesignError("原市场分析输入哈希不一致，原记录保留，不重新生成。",409);
  return{...record,currentVersion:version};
}
export async function startMarketAnalysis(ai:NewDesignAiGateway,input:{scanRecordId:string;scanVersionId?:string;itemIds:string[];focus:string;budgetTokens:number;requestKey?:string}):Promise<{recordId:string;versionId:string;version:number}>{await ensureResearchRecovery();const scan=await getMarketScan(input.scanRecordId,input.scanVersionId);if(!["completed","partial"].includes(scan.version.runStatus))throw new NewDesignError("榜单扫描尚未完成，暂时不能分析。",409);const items=await getMarketItems(scan.version.id,input.itemIds);const run=await beginMarketAnalysis({scanRecordId:scan.record.id,scanVersionId:scan.version.id,itemIds:input.itemIds,focus:input.focus,budgetTokens:input.budgetTokens,requestKey:input.requestKey});if(run.created){const observedAt=(scan.snapshots.map((item)=>item.capturedAt).sort().at(-1)??new Date().toISOString()).slice(0,10);const task=executeAnalysis(ai,run.versionId,items,input.focus,input.budgetTokens,observedAt).finally(()=>running.delete(run.versionId));running.set(run.versionId,task);}return{recordId:run.recordId,versionId:run.versionId,version:run.version};}
export async function retryMarketAnalysis(ai:NewDesignAiGateway,recordId:string,options:{requestKey?:string;expectedVersionId?:string}={}):Promise<{recordId:string;versionId:string;version:number}>{
  await ensureResearchRecovery();
  const record=await getResearchRecord(recordId);
  if(record.type!=="market_analysis")throw new NewDesignError("该记录不是市场分析。",422);
  const original=options.expectedVersionId?record.versions.find(version=>version.id===options.expectedVersionId):record.currentVersion;
  if(!original)throw new NewDesignError("原分析版本不存在，原报告保留，不按其他版本代替。",404);
  if(options.requestKey){
    const previous=await getMarketAnalysisByKey(String(original.sourceScope.scanRecordId??""),options.requestKey);
    if(previous){if(previous.id!==recordId||previous.currentVersion.parentVersionId!==original.id)throw new NewDesignError("原重跑凭证不属于本次报告与版本，不重复执行。",409);return{recordId:previous.id,versionId:previous.currentVersion.id,version:previous.currentVersion.version};}
  }
  if(options.expectedVersionId&&record.currentVersion.id!==options.expectedVersionId)throw new NewDesignError("原分析版本已变化，旧报告保留；请核对原版本后明确准备。",409);
  const scope=original.sourceScope,input=original.inputSnapshot;
  const scanRecordId=String(scope.scanRecordId??""),scanVersionId=String(scope.scanVersionId??""),itemIds=Array.isArray(scope.itemIds)?scope.itemIds.map(String):[],focus=String(input.focus??""),budgetTokens=original.budgetTokens??5000;
  const items=await getMarketItems(scanVersionId,itemIds),scan=await getMarketScan(scanRecordId,scanVersionId);
  const observedAt=(scan.snapshots.map(item=>item.capturedAt).sort().at(-1)??new Date().toISOString()).slice(0,10);
  const run=await beginMarketAnalysis({scanRecordId,scanVersionId,itemIds,focus,budgetTokens,recordId,parentVersionId:original.id,requestKey:options.requestKey});
  if(run.created){const task=executeAnalysis(ai,run.versionId,items,focus,budgetTokens,observedAt).finally(()=>running.delete(run.versionId));running.set(run.versionId,task);}
  return{recordId:run.recordId,versionId:run.versionId,version:run.version};
}
