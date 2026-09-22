import {findRecordCard,listRecordCards,requireRecordCard} from './recordCards';
import {researchCandidate,patchResearchRecord,insertResearchRecord,insertResearchCandidate,saveResearchOrigin,refreshResearchBatch} from './researchRecords';
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CardSummary, FieldDefinition, MarketAnalysisResult, MarketRankingItem, MarketSavedSignal, MarketScanDetail, MarketSignalDraft, MarketSourceDefinition, MarketSourceSnapshot } from "../../common/contracts";
import { RESEARCH_RESOURCE_SPACE_ID } from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import { isPrimaryMarketList, type CollectedRankingItem } from "../research/marketSources";
import { getNewDesignPool } from "./runtime";
import { createResearchRun, getResearchRecord, setResearchRunState } from "./researchStore";
import { getCard } from "./store";
import { validateCardValues } from "../domain/validation";

function asDate(value:unknown):string{return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
function mapItem(row:Record<string,unknown>):MarketRankingItem{const listKey=String(row.list_key??"");return{id:String(row.id),snapshotId:String(row.snapshot_id),platform:row.platform as MarketRankingItem["platform"],listKey,listLabel:String(row.list_label??listKey),evidenceTier:isPrimaryMarketList(listKey)?"primary":"supporting",rank:Number(row.rank),title:String(row.title),author:String(row.author??""),category:String(row.category??""),tags:Array.isArray(row.tags)?row.tags.map(String):[],synopsis:String(row.synopsis??""),heatLabel:String(row.heat_label??""),serialStatus:String(row.serial_status??""),sourceUrl:String(row.source_url)};}

export async function beginMarketScan(input:{sources:MarketSourceDefinition[];recordId?:string;parentVersionId?:string|null}):Promise<{recordId:string;versionId:string;version:number}>{const pool=await getNewDesignPool(),client=await pool.connect();try{await client.query("BEGIN");const result=await createResearchRun(client,{type:"market_scan",title:`公开榜单扫描 · ${new Date().toLocaleDateString("zh-CN")}`,recordId:input.recordId,parentVersionId:input.parentVersionId,sourceScope:{sources:input.sources.map(({platform,listKey,sourceUrl})=>({platform,listKey,sourceUrl}))},templateKey:"market_scan.public_metadata",templateVersion:1,inputSnapshot:{sourceKeys:input.sources.map((source)=>`${source.platform}:${source.listKey}`)}});await client.query("COMMIT");return result;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function persistMarketSource(versionId:string,source:MarketSourceDefinition,result:{items?:CollectedRankingItem[];error?:string},progress:number):Promise<void>{
 const client=await(await getNewDesignPool()).connect();
 try{await client.query('BEGIN');const run=await requireRecordCard(client,versionId,'research_record_version','榜单扫描运行不存在。',{lock:true});
 if(run.cancel_requested||run.run_status==='cancelled')throw new NewDesignError('扫描已取消。',409);
 const snapshotId=randomUUID(),status=result.error?'failed':'succeeded';
 await insertResearchRecord(client,'market_source_snapshot',{id:snapshotId,research_version_id:versionId,platform:source.platform,list_key:source.listKey,list_label:source.listLabel,source_url:source.sourceUrl,status,error:result.error??'',captured_at:new Date().toISOString()});
 for(const item of result.items??[])await insertResearchRecord(client,'market_ranking_item',{snapshot_id:snapshotId,rank:item.rank,title:item.title,author:item.author??'',category:item.category??'',tags:item.tags,synopsis:item.synopsis??'',heat_label:item.heatLabel??'',serial_status:item.serialStatus??'',source_url:item.sourceUrl});
 await setResearchRunState(client,versionId,{status:'running',progress});await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function finishMarketScan(versionId:string):Promise<void>{
 const client=await(await getNewDesignPool()).connect();
 try{await client.query('BEGIN');const row=await requireRecordCard(client,versionId,'research_record_version','榜单扫描运行不存在。',{lock:true}),snapshots=await listRecordCards(client,'market_source_snapshot',{where:{research_version_id:versionId}});
 const counts={succeeded:snapshots.filter(row=>row.status==='succeeded').length,failed:snapshots.filter(row=>row.status==='failed').length,items:0};
 for(const snapshot of snapshots)counts.items+=(await listRecordCards(client,'market_ranking_item',{where:{snapshot_id:snapshot.id}})).length;
 const status=row.cancel_requested?'cancelled':counts.succeeded===0?'failed':counts.failed>0?'partial':'completed';
 const report=`已采集 ${counts.succeeded} 个榜单，共 ${counts.items} 条公开作品元数据；${counts.failed} 个来源失败。扫描过程没有调用 AI。`;
 await setResearchRunState(client,versionId,{status,progress:100,structuredResult:{successfulSources:counts.succeeded,failedSources:counts.failed,itemCount:counts.items},report,lastError:counts.succeeded===0?'所有榜单来源均采集失败。':''});await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function requestMarketScanCancellation(versionId:string):Promise<void>{
 const client=await(await getNewDesignPool()).connect();
 try{await client.query('BEGIN');const row=await findRecordCard(client,versionId,'research_record_version',{lock:true});if(!row||!['queued','running'].includes(row.run_status))throw new NewDesignError('扫描已结束或不存在，不能取消。',409);
 await patchResearchRecord(client,versionId,'research_record_version',{cancel_requested:true});await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function isResearchCancellationRequested(versionId:string):Promise<boolean>{return Boolean((await findRecordCard(await getNewDesignPool(),versionId,'research_record_version'))?.cancel_requested);}
export async function recoverInterruptedResearchRuns():Promise<void>{
 const client=await(await getNewDesignPool()).connect();
 try{await client.query('BEGIN');const rows=(await listRecordCards(client,'research_record_version',{lock:true})).filter(row=>['queued','running'].includes(row.run_status));
 for(const row of rows)await patchResearchRecord(client,row.id,'research_record_version',{run_status:'partial',last_error:'应用上次关闭时任务尚未完成，可重试并生成新版本。',completed_at:new Date().toISOString()});await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function getMarketScan(id:string,versionId?:string):Promise<MarketScanDetail>{
 const record=await getResearchRecord(id);if(record.type!=='market_scan')throw new NewDesignError('该记录不是榜单扫描。',422);
 const version=versionId?assertFound(record.versions.find(item=>item.id===versionId),'该扫描版本不存在。'):record.currentVersion,db=await getNewDesignPool(),snapshots:MarketSourceSnapshot[]=[];
 const rows=(await listRecordCards(db,'market_source_snapshot',{where:{research_version_id:version.id}})).sort((a,b)=>String(a.captured_at).localeCompare(String(b.captured_at))||String(a.platform).localeCompare(String(b.platform))||String(a.list_key).localeCompare(String(b.list_key)));
 for(const row of rows){const items=(await listRecordCards(db,'market_ranking_item',{where:{snapshot_id:row.id}})).sort((a,b)=>Number(a.rank)-Number(b.rank)).map(item=>mapItem({...item,platform:row.platform,list_key:row.list_key,list_label:row.list_label}));
 snapshots.push({id:row.id,researchVersionId:row.research_version_id,platform:row.platform,listKey:row.list_key,listLabel:row.list_label,sourceUrl:row.source_url,status:row.status as MarketSourceSnapshot['status'],error:row.error??'',capturedAt:asDate(row.captured_at),items});}
 return{record,version,isCurrent:version.id===record.currentVersion.id,snapshots};
}
export async function getMarketItems(versionId:string,itemIds:string[]):Promise<MarketRankingItem[]>{
 const selected=new Set(itemIds);if(!selected.size)throw new NewDesignError('请至少选择一条榜单作品后再分析。',422);
 const db=await getNewDesignPool(),items:MarketRankingItem[]=[];
 for(const snapshot of await listRecordCards(db,'market_source_snapshot',{where:{research_version_id:versionId}}))for(const item of await listRecordCards(db,'market_ranking_item',{where:{snapshot_id:snapshot.id}}))if(selected.has(item.id))items.push(mapItem({...item,platform:snapshot.platform,list_key:snapshot.list_key,list_label:snapshot.list_label}));
 if(items.length!==selected.size)throw new NewDesignError('部分榜单作品不属于当前扫描版本，请刷新后重选。',409);
 return items.sort((a,b)=>Number(!['new_book','new_author'].includes(a.listKey))-Number(!['new_book','new_author'].includes(b.listKey))||a.platform.localeCompare(b.platform)||a.listKey.localeCompare(b.listKey)||a.rank-b.rank);
}

export interface MarketAnalysisPreparationInput {scanRecordId:string;scanVersionId:string;itemIds:string[];focus:string;budgetTokens:number;recordId?:string;parentVersionId?:string|null;requestKey?:string;}
const requestUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function assertMarketRequestKey(key:string){if(!requestUuid.test(key))throw new NewDesignError("市场分析原请求凭证格式无效。",422);}
export function marketAnalysisInputHash(input:MarketAnalysisPreparationInput):string{return createHash("sha256").update(JSON.stringify({operation:"market_analysis",scanRecordId:input.scanRecordId,scanVersionId:input.scanVersionId,itemIds:input.itemIds,focus:input.focus,budgetTokens:input.budgetTokens,recordId:input.recordId??null,parentVersionId:input.parentVersionId??null})).digest("hex");}
async function findMarketAnalysisRequest(client:PoolClient,key:string){
 const rows=[];for(const version of await listRecordCards(client,'research_record_version',{where:{source_scope:{requestKey:key}}})){const record=await requireRecordCard(client,version.record_id,'research_record','研究记录不存在。',{includeArchived:true});if(record.record_type==='market_analysis')rows.push(version);}
 if(rows.length>1)throw new NewDesignError('原市场分析凭证对应多个记录，不能选择另一条代替；请核对原记录。',409);return rows[0]??null;
}
export async function getMarketAnalysisRequestByKey(scanRecordId:string,key:string):Promise<{recordId:string;versionId:string;version:number}|null>{assertMarketRequestKey(key);if(!requestUuid.test(scanRecordId))throw new NewDesignError("原扫描来源格式无效。",422);const client=await(await getNewDesignPool()).connect();try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`market_analysis_request:${key}`]);const row=await findMarketAnalysisRequest(client,key);if(row&&row.source_scope.scanRecordId!==scanRecordId)throw new NewDesignError("原市场分析凭证不属于这份扫描，不能选择其他来源。",409);await client.query("COMMIT");return row?{recordId:String(row.record_id),versionId:String(row.id),version:Number(row.version)}:null;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
export async function beginMarketAnalysis(input:MarketAnalysisPreparationInput):Promise<{recordId:string;versionId:string;version:number;created:boolean}>{
  if(input.requestKey)assertMarketRequestKey(input.requestKey);
  const pool=await getNewDesignPool(),client=await pool.connect(),inputHash=marketAnalysisInputHash(input);
  try{
    await client.query("BEGIN");
    if(input.requestKey){
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`market_analysis_request:${input.requestKey}`]);
      const previous=await findMarketAnalysisRequest(client,input.requestKey);
      if(previous){if(previous.source_scope.inputHash!==inputHash)throw new NewDesignError("原市场分析凭证与本次输入不一致，原记录保留；不能使用旧凭证发起不同分析。",409);await client.query("COMMIT");return{recordId:String(previous.record_id),versionId:String(previous.id),version:Number(previous.version),created:false};}
    }
    if(input.recordId&&input.parentVersionId){const original=await requireRecordCard(client,input.recordId,'research_record','原分析记录不存在或已归档。',{lock:true});if(original.record_type!=='market_analysis'||original.status!=='active'||original.current_version_id!==input.parentVersionId)throw new NewDesignError("原报告的运行版本已变化，旧报告保留；请核对后明确准备。",409);}
    const result=await createResearchRun(client,{type:"market_analysis",title:`市场分析 · ${new Date().toLocaleDateString("zh-CN")}`,recordId:input.recordId,parentVersionId:input.parentVersionId,sourceScope:{scanRecordId:input.scanRecordId,scanVersionId:input.scanVersionId,itemIds:input.itemIds,...(input.requestKey?{requestKey:input.requestKey,inputHash}:{})},templateKey:"new_design.research.market_analysis",templateVersion:1,budgetTokens:input.budgetTokens,inputSnapshot:{focus:input.focus}});
    await setResearchRunState(client,result.versionId,{status:"running",progress:10});
    await client.query("COMMIT");return{...result,created:true};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

function signalValues(signal:MarketSignalDraft):Record<string,unknown>{return{signal_type:signal.signalType,summary:signal.summary,heat:signal.heat,crowding:signal.crowding,trend:signal.trend,platforms:signal.platforms,audience:signal.audience,differentiation:signal.differentiation,source_refs:signal.sourceRefs,observed_at:signal.observedAt,effective_until:signal.effectiveUntil||null};}
export async function completeMarketAnalysis(versionId:string,result:MarketAnalysisResult,runMeta:{usedTokens:number;promptSnapshot:Record<string,unknown>;modelSnapshot:Record<string,unknown>}):Promise<void>{const pool=await getNewDesignPool(),client=await pool.connect();try{await client.query("BEGIN");const run=await requireRecordCard(client,versionId,'research_record_version','市场分析运行不存在。',{lock:true});if(run.cancel_requested){await setResearchRunState(client,versionId,{status:"cancelled",progress:100});await client.query("COMMIT");return;}const batchId=randomUUID();await insertResearchRecord(client,'research_candidate_batch',{id:batchId,research_version_id:versionId,status:'ready'});for(const signal of result.signals)await insertResearchCandidate(client,{batch_id:batchId,target_type_key:'market_signal',title:signal.title,values:signalValues(signal),merge_key:`${signal.signalType}:${signal.title}`});const report=["# 市场分析",`题材：${result.genre.join("、")||"未形成稳定结论"}`,`主角身份：${result.protagonistIdentities.join("、")||"未形成稳定结论"}`,`核心优势：${result.coreAdvantages.join("、")||"未形成稳定结论"}`,`开局方式：${result.openingPatterns.join("、")||"未形成稳定结论"}`,`关系钩子：${result.relationshipHooks.join("、")||"未形成稳定结论"}`,`标题模式：${result.titlePatterns.join("、")||"未形成稳定结论"}`,`读者满足：${result.readerPayoffs.join("、")||"未形成稳定结论"}`,`拥挤套路：${result.crowdedTropes.join("、")||"未形成稳定结论"}`,`差异化机会：${result.differentiationOpportunities.join("、")||"未形成稳定结论"}`,`证据边界：${result.evidenceBoundary}`].join("\n\n");await setResearchRunState(client,versionId,{status:"completed",progress:100,usedTokens:runMeta.usedTokens,structuredResult:{...result},report,promptSnapshot:runMeta.promptSnapshot,modelSnapshot:runMeta.modelSnapshot});await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
export async function failMarketAnalysis(versionId:string,error:string):Promise<void>{const pool=await getNewDesignPool(),client=await pool.connect();try{await client.query("BEGIN");await setResearchRunState(client,versionId,{status:"failed",progress:100,lastError:error});await client.query("COMMIT");}catch(caught){await client.query("ROLLBACK");throw caught;}finally{client.release();}}

export async function adoptMarketSignal(candidateId:string):Promise<CardSummary>{const pool=await getNewDesignPool(),client=await pool.connect();const cardId=randomUUID(),versionId=randomUUID(),adoptionId=randomUUID();try{await client.query("BEGIN");const candidate=await researchCandidate(client,candidateId,undefined,true);if(candidate.target_type_key!=="market_signal"||candidate.status!=="candidate")throw new NewDesignError("该市场信号已处理或不可采用。",409);const type=assertFound((await client.query("SELECT type.id,type.current_version_id,version.fields FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.space_id='00000000-0000-4000-8000-000000000001' AND type.type_key='market_signal' AND type.status='published'")).rows[0],"市场信号规格尚未发布。");const validated=validateCardValues(type.fields as FieldDefinition[],candidate.values as Record<string,unknown>);if(Object.keys(validated.issues).length)throw new NewDesignError("市场信号候选与当前规格不兼容。",422,validated.issues);await client.query("INSERT INTO new_design.cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values) VALUES($1,$2,$3,$4,'active',1,$5,NULL,$6::jsonb)",[cardId,RESEARCH_RESOURCE_SPACE_ID,type.id,candidate.title,type.current_version_id,JSON.stringify(validated.values)]);await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,1,$3,$4,$5::jsonb,'create')",[versionId,cardId,type.current_version_id,candidate.title,JSON.stringify(validated.values)]);await client.query("UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1",[cardId,versionId]);for(const [key,value]of [["$title",candidate.title],...Object.entries(validated.values)])await saveResearchOrigin(client,RESEARCH_RESOURCE_SPACE_ID,cardId,String(key),candidate.research_version_id,value);await insertResearchRecord(client,'research_candidate_adoption',{id:adoptionId,candidate_id:candidateId,action:'save_resource',target_space_id:RESEARCH_RESOURCE_SPACE_ID,target_card_id:cardId,applied_values:validated.values});await patchResearchRecord(client,candidateId,'research_candidate',{status:'adopted',revision:candidate.revision+1,updated_at:new Date().toISOString()});await refreshResearchBatch(client,candidate.batch_id);await client.query("COMMIT");return await getCard(cardId);}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function listSavedMarketSignals():Promise<MarketSavedSignal[]>{
 const db=await getNewDesignPool(),rows=(await listRecordCards(db,'research_candidate_adoption',{where:{action:'save_resource',target_space_id:RESEARCH_RESOURCE_SPACE_ID}})).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))),result:MarketSavedSignal[]=[];
 for(const adoption of rows){const candidate=await researchCandidate(db,adoption.candidate_id);if(candidate.target_type_key!=='market_signal')continue;
 const card=(await db.query('SELECT id,title,values,status,revision FROM new_design.cards WHERE id=$1',[adoption.target_card_id])).rows[0];if(!card)continue;
 result.push({candidateId:candidate.id,researchRecordId:candidate.record_id,researchVersionId:candidate.research_version_id,cardId:String(card.id),cardRevision:Number(card.revision),cardStatus:card.status,title:String(card.title),values:card.values,savedAt:asDate(adoption.created_at)});}
 return result;
}
