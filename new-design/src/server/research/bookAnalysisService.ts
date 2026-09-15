import type { BookAnalysisPlan, BookAnalysisPreset, BookAnalysisPurpose, BookAnalysisResult, CardTypeSummary } from "../../common/contracts";
import type { NewDesignAiGateway } from "../ai/gateway";
import { beginBookAnalysisRun, completeBookAnalysis, failBookAnalysis } from "../database/bookAnalysisStore";
import { listCardGroupForms } from "../database/compositionStore";
import { getResearchDocumentVersion, getResearchRecord } from "../database/researchStore";
import { listCardTypes } from "../database/store";
import { NewDesignError } from "../domain/errors";
import { validateCardValues } from "../domain/validation";
import { ensureResearchRecovery } from "./marketService";

const dimensions=["story_structure","characters","world","conflict","pacing","hooks_payoffs","writing_technique","quality_risks"];
const reusableTypeKeys=new Set(["genre_strategy","progression_mode","writing_config","quality_rule","reference_material"]);
const excludedTypeKeys=new Set(["prompt_component","market_signal"]);
const limits:Record<BookAnalysisPreset,{characters:number;candidates:number}>={quick:{characters:12000,candidates:6},standard:{characters:40000,candidates:14},full:{characters:100000,candidates:24}};

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

export async function startBookAnalysis(ai:NewDesignAiGateway,input:{documentVersionId:string;purpose:BookAnalysisPurpose;preset:BookAnalysisPreset;rangeMode:"full"|"range";startOffset?:number;endOffset?:number;focus:string;budgetTokens:number;recordId?:string;parentVersionId?:string|null}){
  await ensureResearchRecovery();const source=await getResearchDocumentVersion(input.documentVersionId);const start=input.rangeMode==="range"?input.startOffset??0:0,end=input.rangeMode==="range"?input.endOffset??source.version.content.length:source.version.content.length;
  if(start<0||end<=start||end>source.version.content.length)throw new NewDesignError("分析范围超出参考文本，请重新选择。",422);
  const text=source.version.content.slice(start,end),limit=limits[input.preset].characters;if(text.length>limit)throw new NewDesignError(`${input.preset==="quick"?"快速":input.preset==="standard"?"标准":"完整"}分析最多处理 ${limit.toLocaleString()} 字，请缩小范围或分段运行。`,422);
  const {plan,types}=await buildBookAnalysisPlan(input.purpose,input.preset);const run=await beginBookAnalysisRun({title:`${input.purpose==="diagnosis"?"稿件诊断":"作品拆书"} · ${source.title}`,type:input.purpose==="diagnosis"?"diagnosis":"book_analysis",sourceDocumentVersionId:source.version.id,sourceScope:{documentId:source.documentId,documentVersionId:source.version.id,rangeMode:input.rangeMode,startOffset:start,endOffset:end,sourceUrl:source.sourceUrl},plan,focus:input.focus,budgetTokens:input.budgetTokens,recordId:input.recordId,parentVersionId:input.parentVersionId});void execute(ai,run,source,text,input.focus,plan,types,input.budgetTokens,start).catch(()=>undefined);return run;
}

export async function retryBookAnalysis(ai:NewDesignAiGateway,recordId:string){const record=await getResearchRecord(recordId);if(!["book_analysis","diagnosis"].includes(record.type))throw new NewDesignError("该记录不是拆书或稿件诊断。",422);const scope=record.currentVersion.sourceScope,input=record.currentVersion.inputSnapshot,plan=input.plan as BookAnalysisPlan;return startBookAnalysis(ai,{documentVersionId:String(scope.documentVersionId),purpose:plan.purpose,preset:plan.preset,rangeMode:scope.rangeMode==="range"?"range":"full",startOffset:Number(scope.startOffset??0),endOffset:Number(scope.endOffset??0),focus:String(input.focus??""),budgetTokens:record.currentVersion.budgetTokens??5000,recordId,parentVersionId:record.currentVersion.id});}
