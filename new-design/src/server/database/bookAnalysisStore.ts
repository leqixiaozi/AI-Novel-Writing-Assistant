import {findRecordCard,requireRecordCard} from './recordCards';
import {researchCandidate,patchResearchRecord,insertResearchRecord,insertResearchCandidate,saveResearchOrigin,refreshResearchBatch} from './researchRecords';
import { randomUUID } from "node:crypto";
import type { BookAnalysisPlan, BookAnalysisResult, CardSummary, FieldDefinition, ResearchCandidate } from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import { validateCardValues } from "../domain/validation";
import { getNewDesignPool } from "./runtime";
import { createResearchRun, getBookAnalysisRequestByKey, getResearchRecord, setResearchRunState } from "./researchStore";
import { getCard } from "./store";

export async function beginBookAnalysisRun(input:{title:string;type:"book_analysis"|"diagnosis";sourceDocumentVersionId:string;sourceScope:Record<string,unknown>;plan:BookAnalysisPlan;focus:string;budgetTokens:number;recordId?:string;parentVersionId?:string|null}){
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{await client.query("BEGIN");const requestKey=input.sourceScope.requestKey,inputHash=input.sourceScope.inputHash;
    if(typeof requestKey==="string"){
      if(typeof inputHash!=="string"||!inputHash)throw new NewDesignError("原拆书冻结输入不完整，未创建运行。",422);
      await client.query("SELECT pg_advisory_xact_lock(471982,hashtext($1))",[requestKey]);
      const previous=await getBookAnalysisRequestByKey(requestKey,client);
      if(previous){if(previous.inputHash!==inputHash)throw new NewDesignError("原拆书请求与冻结输入不一致，不能重复执行。",409);await client.query("COMMIT");return{recordId:previous.recordId,versionId:previous.versionId,version:previous.version,created:false};}
    }
    if(input.recordId&&input.parentVersionId){const current=await findRecordCard(client,input.recordId,'research_record',{lock:true});if(!current||current.status!=='active'||String(current.current_version_id)!==input.parentVersionId)throw new NewDesignError("原拆书版本已变化，不能从旧版本重复创建重跑。",409);}
    const run=await createResearchRun(client,{type:input.type,title:input.title,sourceDocumentVersionId:input.sourceDocumentVersionId,sourceScope:input.sourceScope,templateKey:"new_design.research.book_analysis",templateVersion:1,budgetTokens:input.budgetTokens,inputSnapshot:{focus:input.focus,plan:input.plan},recordId:input.recordId,parentVersionId:input.parentVersionId});await setResearchRunState(client,run.versionId,{status:"running",progress:10});await client.query("COMMIT");return{...run,created:true};}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function completeBookAnalysis(versionId:string,result:BookAnalysisResult,meta:{usedTokens:number;promptSnapshot:Record<string,unknown>;modelSnapshot:Record<string,unknown>}):Promise<void>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{
    await client.query("BEGIN");
    const version=await requireRecordCard(client,versionId,'research_record_version','拆书运行不存在。',{lock:true}),record=await requireRecordCard(client,version.record_id,'research_record','研究记录不存在。'),run={...version,source_document_version_id:record.source_document_version_id};
    if(run.cancel_requested){await setResearchRunState(client,versionId,{status:"cancelled",progress:100});await client.query("COMMIT");return;}
    const evidenceIds:string[]=[];
    for(const item of result.evidence){const id=randomUUID();evidenceIds.push(id);await insertResearchRecord(client,'research_evidence',{id,research_version_id:versionId,source_document_version_id:run.source_document_version_id,field_path:item.fieldPath,excerpt:item.excerpt,start_offset:item.startOffset,end_offset:item.endOffset,certainty:item.certainty,note:item.note});}
    if(result.candidates.length){const batchId=randomUUID();await insertResearchRecord(client,'research_candidate_batch',{id:batchId,research_version_id:versionId,status:'ready'});for(const candidate of result.candidates){const refs=candidate.evidenceIndexes.flatMap(index=>evidenceIds[index]?[evidenceIds[index]]:[]),candidateId=randomUUID();await insertResearchCandidate(client,{id:candidateId,batch_id:batchId,target_type_key:candidate.targetTypeKey,title:candidate.title,values:candidate.values,evidence_ids:refs,merge_key:`${candidate.targetTypeKey}:${candidate.title}`,confidence:candidate.confidence});await insertResearchRecord(client,'research_candidate_version',{candidate_id:candidateId,revision:1,title:candidate.title,values:candidate.values,editor:'ai',note:'AI 提案自动入库。'});}}
    const report=["# 拆书报告",result.overview,...result.dimensions.map((item)=>`## ${item.title}\n${item.summary}\n\n优势：${item.strengths.join("；")||"无明确证据"}\n\n风险：${item.risks.join("；")||"无明确证据"}\n\n机会：${item.opportunities.join("；")||"无明确证据"}`),`## 使用边界\n${result.copyrightBoundary}`].join("\n\n");
    await setResearchRunState(client,versionId,{status:"completed",progress:100,usedTokens:meta.usedTokens,structuredResult:{overview:result.overview,dimensions:result.dimensions,copyrightBoundary:result.copyrightBoundary},report,promptSnapshot:meta.promptSnapshot,modelSnapshot:meta.modelSnapshot});
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function failBookAnalysis(versionId:string,error:string):Promise<void>{const pool=await getNewDesignPool(),client=await pool.connect();try{await client.query("BEGIN");await setResearchRunState(client,versionId,{status:"failed",progress:100,lastError:error});await client.query("COMMIT");}catch(caught){await client.query("ROLLBACK");throw caught;}finally{client.release();}}

export async function updateResearchCandidate(recordId:string,candidateId:string,input:{title:string;values:Record<string,unknown>;expectedRevision:number;actor?:string;note?:string}):Promise<ResearchCandidate>{const pool=await getNewDesignPool(),client=await pool.connect();try{await client.query("BEGIN");const candidate=await researchCandidate(client,candidateId,recordId,true);if(candidate.status!=="candidate")throw new NewDesignError("只有待处理的 AI 提案可以直接修改。",409);if(Number(candidate.revision)!==input.expectedRevision)throw new NewDesignError("AI 提案已更新，请刷新后重试。",409);const type=assertFound((await client.query("SELECT version.fields FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.type_key=$1 AND type.status='published' ORDER BY CASE WHEN type.space_id='00000000-0000-4000-8000-000000000001' THEN 0 ELSE 1 END LIMIT 1",[candidate.target_type_key])).rows[0],"AI 提案对应的资料规格不存在。");const validated=validateCardValues(type.fields as FieldDefinition[],input.values);if(Object.keys(validated.issues).length)throw new NewDesignError("AI 提案字段与当前资料规格不兼容。",422,validated.issues);const revision=Number(candidate.revision)+1;await insertResearchRecord(client,'research_candidate_version',{candidate_id:candidateId,revision,title:input.title,values:validated.values,editor:input.actor??'user',note:input.note??''});await patchResearchRecord(client,candidateId,'research_candidate',{title:input.title,values:validated.values,merge_key:`${candidate.target_type_key}:${input.title}`,revision,updated_at:new Date().toISOString()});await client.query("COMMIT");const record=await getResearchRecord(recordId);return assertFound(record.candidates.find((item)=>item.id===candidateId),"AI 提案不存在。");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export interface CandidateDecision {candidateId:string;action:"create_card"|"merge_card"|"save_resource"|"reference_only"|"ignore";targetSpaceId?:string;targetCardId?:string;expectedRevision?:number;}
export async function applyCandidateDecisions(recordId:string,decisions:CandidateDecision[]):Promise<Array<{candidateId:string;action:string;cardId:string|null}>>{
  if(!decisions.length)throw new NewDesignError("请至少选择一条候选资料。",422);
  const pool=await getNewDesignPool(),client=await pool.connect(),outputs:Array<{candidateId:string;action:string;cardId:string|null}>=[];
  try{
    await client.query("BEGIN");
    const record=await requireRecordCard(client,recordId,'research_record','拆书记录不存在或已归档。',{lock:true});
    if(record.status!=='active')throw new NewDesignError('拆书记录不存在或已归档。',404);
    for(const decision of decisions){
      const candidate=await researchCandidate(client,decision.candidateId,record.id,true);
      if(candidate.status!=="candidate")throw new NewDesignError(`候选“${candidate.title}”已处理，请刷新后重试。`,409);
      let cardId:string|null=null,appliedValues:Record<string,unknown>={},targetSpaceId=decision.targetSpaceId??null;
      if(decision.action==="create_card")throw new NewDesignError("请先生成本书采用预览，逐条确认后再写入正式资料。",409);
      if(decision.action==="ignore"||decision.action==="reference_only"){
        await patchResearchRecord(client,candidate.id,'research_candidate',{status:decision.action==='ignore'?'ignored':'reference_only',revision:candidate.revision+1,updated_at:new Date().toISOString()});
      }else if(decision.action==="merge_card"){
        if(!decision.targetCardId||!decision.expectedRevision)throw new NewDesignError("合并候选时必须选择目标资料并提供当前修订号。",422);
        const target=assertFound((await client.query("SELECT card.*,type.type_key,version.fields,type.current_version_id AS current_type_version_id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE card.id=$1 AND card.status='active' FOR UPDATE OF card",[decision.targetCardId])).rows[0],"目标资料不存在或已归档。");
        if((await client.query("SELECT 1 FROM new_design.books WHERE space_id=$1 AND status='active'",[target.space_id])).rowCount)throw new NewDesignError("本书正式资料需通过采用预览确认，不能从研究候选直接合并。",409);
        if(target.type_key!==candidate.target_type_key)throw new NewDesignError("候选规格与目标资料不一致，不能合并。",422);
        if(Number(target.revision)!==decision.expectedRevision)throw new NewDesignError("目标资料已更新，请刷新后重新确认合并。",409);
        appliedValues={...(target.values as Record<string,unknown>),...(candidate.values as Record<string,unknown>)};const validated=validateCardValues(target.fields as FieldDefinition[],appliedValues);if(Object.keys(validated.issues).length)throw new NewDesignError("候选字段与目标资料不兼容。",422,validated.issues);const nextRevision=Number(target.revision)+1,cardVersionId=randomUUID();await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,$3,$4,$5,$6::jsonb,'edit')",[cardVersionId,target.id,nextRevision,target.current_type_version_id,target.title,JSON.stringify(validated.values)]);await client.query("UPDATE new_design.cards SET values=$2::jsonb,revision=$3,type_version_id=$4,current_version_id=$5,updated_at=now() WHERE id=$1",[target.id,JSON.stringify(validated.values),nextRevision,target.current_type_version_id,cardVersionId]);for(const [key,value] of Object.entries(candidate.values as Record<string,unknown>))await saveResearchOrigin(client,String(target.space_id),String(target.id),key,candidate.research_version_id,value);cardId=String(target.id);targetSpaceId=String(target.space_id);
      }else{
        if(!decision.targetSpaceId)throw new NewDesignError("采用候选时必须选择保存位置。",422);
        if(!(await client.query("SELECT 1 FROM new_design.card_spaces WHERE id=$1 AND space_key='resource_strategy'",[decision.targetSpaceId])).rows[0])throw new NewDesignError("可复用方法只能保存到创作策略资源空间。",422);
        if(!['genre_strategy','progression_mode','writing_config','quality_rule'].includes(String(candidate.target_type_key)))throw new NewDesignError("该候选不是可保存的创作策略类型。",422);
        const type=assertFound((await client.query("SELECT type.*,version.fields,version.id AS version_id FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.type_key=$1 AND type.status='published' AND (type.space_id=$2 OR (type.space_id='00000000-0000-4000-8000-000000000001' AND EXISTS(SELECT 1 FROM new_design.card_spaces WHERE id=$2 AND space_key LIKE 'resource_%'))) ORDER BY CASE WHEN type.space_id=$2 THEN 0 ELSE 1 END LIMIT 1",[candidate.target_type_key,decision.targetSpaceId])).rows[0],"目标位置没有安装这项资料规格。");const validated=validateCardValues(type.fields as FieldDefinition[],candidate.values as Record<string,unknown>);if(Object.keys(validated.issues).length)throw new NewDesignError("候选字段与当前发布规格不兼容。",422,validated.issues);cardId=randomUUID();const cardVersionId=randomUUID();appliedValues=validated.values;await client.query("INSERT INTO new_design.cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values) VALUES($1,$2,$3,$4,'active',1,$5,NULL,$6::jsonb)",[cardId,decision.targetSpaceId,type.id,candidate.title,type.version_id,JSON.stringify(validated.values)]);await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,1,$3,$4,$5::jsonb,'create')",[cardVersionId,cardId,type.version_id,candidate.title,JSON.stringify(validated.values)]);await client.query("UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1",[cardId,cardVersionId]);for(const [key,value]of [["$title",candidate.title],...Object.entries(validated.values)])await saveResearchOrigin(client,decision.targetSpaceId,cardId,String(key),candidate.research_version_id,value);
      }
      await insertResearchRecord(client,'research_candidate_adoption',{candidate_id:candidate.id,action:decision.action,target_space_id:targetSpaceId,target_card_id:cardId,applied_values:appliedValues});
      if(decision.action!=="ignore"&&decision.action!=="reference_only")await patchResearchRecord(client,candidate.id,'research_candidate',{status:'adopted',revision:candidate.revision+1,updated_at:new Date().toISOString()});
      await refreshResearchBatch(client,candidate.batch_id);
      outputs.push({candidateId:String(candidate.id),action:decision.action,cardId});
    }
    await client.query("COMMIT");return outputs;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function listCandidateTargetCards(spaceId:string,typeKey:string):Promise<CardSummary[]>{const result=await(await getNewDesignPool()).query("SELECT card.id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.space_id=$1 AND type.type_key=$2 AND card.status='active' ORDER BY card.updated_at DESC",[spaceId,typeKey]);return Promise.all(result.rows.map((row)=>getCard(String(row.id))));}
