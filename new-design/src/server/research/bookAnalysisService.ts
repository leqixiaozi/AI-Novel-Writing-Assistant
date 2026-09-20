import { createHash } from "node:crypto";
import type { BookAnalysisPlan, BookAnalysisPreset, BookAnalysisPurpose, BookAnalysisResult, CardTypeSummary } from "../../common/contracts";
import type { NewDesignAiGateway } from "../ai/gateway";
import { beginBookAnalysisRun, completeBookAnalysis, failBookAnalysis } from "../database/bookAnalysisStore";
import { listCardGroupForms } from "../database/compositionStore";
import { getBookAnalysisRequestByKey, getResearchDocumentVersion, getResearchRecord } from "../database/researchStore";
import { listCardTypes } from "../database/store";
import { NewDesignError } from "../domain/errors";
import { validateCardValues } from "../domain/validation";
import { ensureResearchRecovery } from "./marketService";

const dimensions=["story_structure","characters","world","conflict","pacing","hooks_payoffs","writing_technique","quality_risks"];
const reusableTypeKeys=new Set(["genre_strategy","progression_mode","writing_config","quality_rule","reference_material"]);
const excludedTypeKeys=new Set(["prompt_component","market_signal"]);
const limits:Record<BookAnalysisPreset,{characters:number;candidates:number}>={quick:{characters:12000,candidates:6},standard:{characters:40000,candidates:14},full:{characters:100000,candidates:24}};
type AnalysisInput={documentVersionId:string;purpose:BookAnalysisPurpose;preset:BookAnalysisPreset;rangeMode:"full"|"range";startOffset?:number;endOffset?:number;focus:string;budgetTokens:number;requestKey?:string;recordId?:string;parentVersionId?:string|null};
function requestHash(input:AnalysisInput):string{return createHash("sha256").update(JSON.stringify({documentVersionId:input.documentVersionId,purpose:input.purpose,preset:input.preset,rangeMode:input.rangeMode,startOffset:input.rangeMode==="range"?input.startOffset??null:null,endOffset:input.rangeMode==="range"?input.endOffset??null:null,focus:input.focus,budgetTokens:input.budgetTokens,recordId:input.recordId??null,parentVersionId:input.parentVersionId??null})).digest("hex");}

export async function getBookAnalysisByKey(requestKey:string){
 const receipt=await getBookAnalysisRequestByKey(requestKey);if(!receipt)return null;
 const record=await getResearchRecord(receipt.recordId),version=record.versions.find(item=>item.id===receipt.versionId);
 if(!version||!["book_analysis","diagnosis"].includes(record.type)||version.sourceScope.requestKey!==requestKey||version.sourceScope.inputHash!==receipt.inputHash)throw new NewDesignError("原拆书回执与研究来源不匹配，原请求保留。",409);
 return{...record,currentVersion:version};
}

export async function buildBookAnalysisPlan(purpose:BookAnalysisPurpose,preset:BookAnalysisPreset):Promise<{plan:BookAnalysisPlan;types:CardTypeSummary[]}>{
  const [allTypes,forms]=await Promise.all([listCardTypes(),listCardGroupForms()]);
  const types=purpose==="diagnosis"?[]:allTypes.filter((item)=>item.status==="published"&&!excludedTypeKeys.has(item.key)&&(purpose==="continuation"||reusableTypeKeys.has(item.key)));
  const candidateLimit=purpose==="diagnosis"?0:limits[preset].candidates;
  return{types,plan:{purpose,preset,dimensions,targetForms:forms.filter((item)=>item.status==="published").map((item)=>({key:item.key,name:item.name})),targets:types.map((item)=>({typeKey:item.key,typeName:item.name,allowedFields:item.draftFields.map((field)=>field.key),maxCandidates:Math.max(1,Math.ceil(candidateLimit/Math.max(types.length,1))),mergePolicy:item.key==="reference_material"?"reference_only":"new_or_merge"})),evidenceRequired:true,candidateLimit}};
}

function normalizeResult(result:BookAnalysisResult,text:string,types:CardTypeSummary[],plan:BookAnalysisPlan,baseOffset:number):BookAnalysisResult{
  const seen=new Set<string>();for(const item of result.dimensions){if(seen.has(item.key))throw new NewDesignError("AI 返回了重复的分析维度，请重试本次运行。",422);seen.add(item.key);}if(dimensions.some((key)=>!seen.has(key)))throw new NewDesignError("AI 未返回完整的八个分析维度，请重试本次运行。",422);
  const evidence=result.evidence.map((item)=>{const located=text.indexOf(item.excerpt);return located>=0?{...item,startOffset:baseOffset+located,endOffset:baseOffset+located+item.excerpt.length}:{...item,startOffset:null,endOffset:null,certainty:"low_confidence" as const,note:[item.note,"未能在所选文本范围内精确定位该摘录。"].filter(Boolean).join(" ")};});
  const typeMap=new Map(types.map((item)=>[item.key,item]));const candidates=plan.purpose==="diagnosis"?[]:result.candidates.slice(0,plan.candidateLimit).flatMap((candidate)=>{const type=typeMap.get(candidate.targetTypeKey);if(!type)return[];const allowed=new Set(type.draftFields.map((field)=>field.key));const values=Object.fromEntries(Object.entries(candidate.values).filter(([key])=>allowed.has(key)));const validated=validateCardValues(type.draftFields,values);return Object.keys(validated.issues).length?[]:[{...candidate,values:validated.values,evidenceIndexes:candidate.evidenceIndexes.filter((index)=>index>=0&&index<evidence.length)}];});
  return{...result,evidence,candidates};
}

async function execute(ai:NewDesignAiGateway,run:{versionId:string},source:Awaited<ReturnType<typeof getResearchDocumentVersion>>,text:string,focus:string,plan:BookAnalysisPlan,types:CardTypeSummary[],budgetTokens:number,baseOffset:number):Promise<void>{try{const result=await ai.analyzeBook({title:source.title,text,focus,plan,schemaTypes:types.map((item)=>({key:item.key,name:item.name,description:item.description,fields:item.draftFields})),budgetTokens});await completeBookAnalysis(run.versionId,normalizeResult(result.output,text,types,plan,baseOffset),result);}catch(error){await failBookAnalysis(run.versionId,error instanceof Error?error.message:"拆书分析失败。");}}

export async function startBookAnalysis(ai:NewDesignAiGateway,input:AnalysisInput){
  const inputHash=requestHash(input);
  if(input.requestKey){const previous=await getBookAnalysisRequestByKey(input.requestKey);if(previous){if(previous.inputHash!==inputHash)throw new NewDesignError("原拆书请求与冻结输入不一致，不能重复执行。",409);return{recordId:previous.recordId,versionId:previous.versionId,version:previous.version};}}
  await ensureResearchRecovery();const source=await getResearchDocumentVersion(input.documentVersionId);const start=input.rangeMode==="range"?input.startOffset??0:0,end=input.rangeMode==="range"?input.endOffset??source.version.content.length:source.version.content.length;
  if(start<0||end<=start||end>source.version.content.length)throw new NewDesignError("分析范围超出参考文本，请重新选择。",422);
  const text=source.version.content.slice(start,end),limit=limits[input.preset].characters;if(text.length>limit)throw new NewDesignError(`${input.preset==="quick"?"快速":input.preset==="standard"?"标准":"完整"}分析最多处理 ${limit.toLocaleString()} 字，请缩小范围或分段运行。`,422);
  const {plan,types}=await buildBookAnalysisPlan(input.purpose,input.preset);const run=await beginBookAnalysisRun({title:`${input.purpose==="diagnosis"?"稿件诊断":"作品拆书"} · ${source.title}`,type:input.purpose==="diagnosis"?"diagnosis":"book_analysis",sourceDocumentVersionId:source.version.id,sourceScope:{documentId:source.documentId,documentVersionId:source.version.id,rangeMode:input.rangeMode,startOffset:start,endOffset:end,sourceUrl:source.sourceUrl,...(input.requestKey?{requestKey:input.requestKey,inputHash}:{})},plan,focus:input.focus,budgetTokens:input.budgetTokens,recordId:input.recordId,parentVersionId:input.parentVersionId});if(run.created)void execute(ai,run,source,text,input.focus,plan,types,input.budgetTokens,start).catch(()=>undefined);return{recordId:run.recordId,versionId:run.versionId,version:run.version};
}

export async function retryBookAnalysis(ai:NewDesignAiGateway,recordId:string,options:{requestKey?:string;expectedVersionId?:string}={}){
 if(options.requestKey){const previous=await getBookAnalysisByKey(options.requestKey);if(previous){if(previous.id!==recordId||options.expectedVersionId&&previous.currentVersion.parentVersionId!==options.expectedVersionId)throw new NewDesignError("原重跑凭证不属于这份报告与版本，不重复执行。",409);return{recordId:previous.id,versionId:previous.currentVersion.id,version:previous.currentVersion.version};}}
 const record=await getResearchRecord(recordId);if(!["book_analysis","diagnosis"].includes(record.type))throw new NewDesignError("该记录不是拆书或稿件诊断。",422);
 if(options.expectedVersionId&&record.currentVersion.id!==options.expectedVersionId)throw new NewDesignError("原拆书版本已变化，请核对原运行，不创建新的重跑。",409);
 const scope=record.currentVersion.sourceScope,input=record.currentVersion.inputSnapshot,plan=input.plan as BookAnalysisPlan;return startBookAnalysis(ai,{documentVersionId:String(scope.documentVersionId),purpose:plan.purpose,preset:plan.preset,rangeMode:scope.rangeMode==="range"?"range":"full",startOffset:Number(scope.startOffset??0),endOffset:Number(scope.endOffset??0),focus:String(input.focus??""),budgetTokens:record.currentVersion.budgetTokens??5000,recordId,parentVersionId:record.currentVersion.id,requestKey:options.requestKey});}
