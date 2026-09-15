import { randomUUID } from "node:crypto";
import type { BookAnalysisPlan, BookAnalysisResult, CardSummary, FieldDefinition } from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import { validateCardValues } from "../domain/validation";
import { getNewDesignPool } from "./runtime";
import { createResearchRun, getResearchRecord, setResearchRunState } from "./researchStore";
import { getCard } from "./store";

export async function beginBookAnalysisRun(input:{title:string;type:"book_analysis"|"diagnosis";sourceDocumentVersionId:string;sourceScope:Record<string,unknown>;plan:BookAnalysisPlan;focus:string;budgetTokens:number;recordId?:string;parentVersionId?:string|null}){
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{await client.query("BEGIN");const run=await createResearchRun(client,{type:input.type,title:input.title,sourceDocumentVersionId:input.sourceDocumentVersionId,sourceScope:input.sourceScope,templateKey:"new_design.research.book_analysis",templateVersion:1,budgetTokens:input.budgetTokens,inputSnapshot:{focus:input.focus,plan:input.plan},recordId:input.recordId,parentVersionId:input.parentVersionId});await setResearchRunState(client,run.versionId,{status:"running",progress:10});await client.query("COMMIT");return run;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function completeBookAnalysis(versionId:string,result:BookAnalysisResult,meta:{usedTokens:number;promptSnapshot:Record<string,unknown>;modelSnapshot:Record<string,unknown>}):Promise<void>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{
    await client.query("BEGIN");
    const run=assertFound((await client.query("SELECT record.source_document_version_id,version.cancel_requested FROM new_design.research_record_versions version JOIN new_design.research_records record ON record.id=version.record_id WHERE version.id=$1 FOR UPDATE OF version",[versionId])).rows[0],"拆书运行不存在。");
    if(run.cancel_requested){await setResearchRunState(client,versionId,{status:"cancelled",progress:100});await client.query("COMMIT");return;}
    const evidenceIds:string[]=[];
    for(const item of result.evidence){const id=randomUUID();evidenceIds.push(id);await client.query("INSERT INTO new_design.research_evidence(id,research_version_id,source_document_version_id,field_path,excerpt,start_offset,end_offset,certainty,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[id,versionId,run.source_document_version_id,item.fieldPath,item.excerpt,item.startOffset,item.endOffset,item.certainty,item.note]);}
    if(result.candidates.length){const batchId=randomUUID();await client.query("INSERT INTO new_design.research_candidate_batches(id,research_version_id,status) VALUES($1,$2,'ready')",[batchId,versionId]);for(const candidate of result.candidates){const refs=candidate.evidenceIndexes.flatMap((index)=>evidenceIds[index]?[evidenceIds[index]]:[]);await client.query("INSERT INTO new_design.research_candidates(id,batch_id,target_type_key,title,values,relation_candidates,evidence_ids,merge_key,confidence,status) VALUES($1,$2,$3,$4,$5::jsonb,'[]'::jsonb,$6::jsonb,$7,$8,'candidate')",[randomUUID(),batchId,candidate.targetTypeKey,candidate.title,JSON.stringify(candidate.values),JSON.stringify(refs),`${candidate.targetTypeKey}:${candidate.title}`,candidate.confidence]);}}
    const report=["# 拆书报告",result.overview,...result.dimensions.map((item)=>`## ${item.title}\n${item.summary}\n\n优势：${item.strengths.join("；")||"无明确证据"}\n\n风险：${item.risks.join("；")||"无明确证据"}\n\n机会：${item.opportunities.join("；")||"无明确证据"}`),`## 使用边界\n${result.copyrightBoundary}`].join("\n\n");
    await setResearchRunState(client,versionId,{status:"completed",progress:100,usedTokens:meta.usedTokens,structuredResult:{overview:result.overview,dimensions:result.dimensions,copyrightBoundary:result.copyrightBoundary},report,promptSnapshot:meta.promptSnapshot,modelSnapshot:meta.modelSnapshot});
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function failBookAnalysis(versionId:string,error:string):Promise<void>{const pool=await getNewDesignPool(),client=await pool.connect();try{await client.query("BEGIN");await setResearchRunState(client,versionId,{status:"failed",progress:100,lastError:error});await client.query("COMMIT");}catch(caught){await client.query("ROLLBACK");throw caught;}finally{client.release();}}

export interface CandidateDecision {candidateId:string;action:"create_card"|"merge_card"|"save_resource"|"reference_only"|"ignore";targetSpaceId?:string;targetCardId?:string;expectedRevision?:number;}
export async function applyCandidateDecisions(recordId:string,decisions:CandidateDecision[]):Promise<Array<{candidateId:string;action:string;cardId:string|null}>>{
  if(!decisions.length)throw new NewDesignError("请至少选择一条候选资料。",422);
  const pool=await getNewDesignPool(),client=await pool.connect(),outputs:Array<{candidateId:string;action:string;cardId:string|null}>=[];
  try{
    await client.query("BEGIN");
    const record=assertFound((await client.query("SELECT id FROM new_design.research_records WHERE id=$1 AND status='active' FOR UPDATE",[recordId])).rows[0],"拆书记录不存在或已归档。");
    for(const decision of decisions){
      const candidate=assertFound((await client.query("SELECT candidate.*,batch.research_version_id FROM new_design.research_candidates candidate JOIN new_design.research_candidate_batches batch ON batch.id=candidate.batch_id WHERE candidate.id=$1 AND batch.research_version_id IN (SELECT id FROM new_design.research_record_versions WHERE record_id=$2) FOR UPDATE OF candidate",[decision.candidateId,record.id])).rows[0],"候选资料不存在。");
      if(candidate.status!=="candidate")throw new NewDesignError(`候选“${candidate.title}”已处理，请刷新后重试。`,409);
      let cardId:string|null=null,appliedValues:Record<string,unknown>={},targetSpaceId=decision.targetSpaceId??null;
      if(decision.action==="ignore"||decision.action==="reference_only"){
        await client.query("UPDATE new_design.research_candidates SET status=$2,revision=revision+1,updated_at=now() WHERE id=$1",[candidate.id,decision.action==="ignore"?"ignored":"reference_only"]);
      }else if(decision.action==="merge_card"){
        if(!decision.targetCardId||!decision.expectedRevision)throw new NewDesignError("合并候选时必须选择目标资料并提供当前修订号。",422);
        const target=assertFound((await client.query("SELECT card.*,type.type_key,version.fields,type.current_version_id AS current_type_version_id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE card.id=$1 AND card.status='active' FOR UPDATE OF card",[decision.targetCardId])).rows[0],"目标资料不存在或已归档。");
        if(target.type_key!==candidate.target_type_key)throw new NewDesignError("候选规格与目标资料不一致，不能合并。",422);
        if(Number(target.revision)!==decision.expectedRevision)throw new NewDesignError("目标资料已更新，请刷新后重新确认合并。",409);
        appliedValues={...(target.values as Record<string,unknown>),...(candidate.values as Record<string,unknown>)};const validated=validateCardValues(target.fields as FieldDefinition[],appliedValues);if(Object.keys(validated.issues).length)throw new NewDesignError("候选字段与目标资料不兼容。",422,validated.issues);const nextRevision=Number(target.revision)+1,cardVersionId=randomUUID();await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,$3,$4,$5,$6::jsonb,'edit')",[cardVersionId,target.id,nextRevision,target.current_type_version_id,target.title,JSON.stringify(validated.values)]);await client.query("UPDATE new_design.cards SET values=$2::jsonb,revision=$3,type_version_id=$4,current_version_id=$5,updated_at=now() WHERE id=$1",[target.id,JSON.stringify(validated.values),nextRevision,target.current_type_version_id,cardVersionId]);for(const [key,value] of Object.entries(candidate.values as Record<string,unknown>))await client.query("INSERT INTO new_design.card_field_origins(id,card_id,field_key,source_kind,source_id,confirmation_status,original_value,current_value) VALUES($1,$2,$3,'research',$4,'confirmed',$5::jsonb,$5::jsonb) ON CONFLICT(card_id,field_key) DO UPDATE SET source_kind='research',source_id=EXCLUDED.source_id,confirmation_status='confirmed',original_value=EXCLUDED.original_value,current_value=EXCLUDED.current_value,updated_at=now()",[randomUUID(),target.id,key,candidate.research_version_id,JSON.stringify(value)]);cardId=String(target.id);targetSpaceId=String(target.space_id);
      }else{
        if(!decision.targetSpaceId)throw new NewDesignError("采用候选时必须选择保存位置。",422);
        if(decision.action==="create_card"&&!(await client.query("SELECT 1 FROM new_design.books WHERE space_id=$1 AND status='active'",[decision.targetSpaceId])).rows[0])throw new NewDesignError("正式资料只能采用到一本有效书籍中。",422);
        if(decision.action==="save_resource"&&!(await client.query("SELECT 1 FROM new_design.card_spaces WHERE id=$1 AND space_key='resource_strategy'",[decision.targetSpaceId])).rows[0])throw new NewDesignError("可复用方法只能保存到创作策略资源空间。",422);
        if(decision.action==="save_resource"&&!['genre_strategy','progression_mode','writing_config','quality_rule'].includes(String(candidate.target_type_key)))throw new NewDesignError("该候选不是可保存的创作策略类型。",422);
        const type=assertFound((await client.query("SELECT type.*,version.fields,version.id AS version_id FROM new_design.card_types type JOIN new_design.card_type_versions version ON version.id=type.current_version_id WHERE type.type_key=$1 AND type.status='published' AND (type.space_id=$2 OR (type.space_id='00000000-0000-4000-8000-000000000001' AND EXISTS(SELECT 1 FROM new_design.card_spaces WHERE id=$2 AND space_key LIKE 'resource_%'))) ORDER BY CASE WHEN type.space_id=$2 THEN 0 ELSE 1 END LIMIT 1",[candidate.target_type_key,decision.targetSpaceId])).rows[0],"目标位置没有安装这项资料规格。");const validated=validateCardValues(type.fields as FieldDefinition[],candidate.values as Record<string,unknown>);if(Object.keys(validated.issues).length)throw new NewDesignError("候选字段与当前发布规格不兼容。",422,validated.issues);cardId=randomUUID();const cardVersionId=randomUUID();appliedValues=validated.values;await client.query("INSERT INTO new_design.cards(id,space_id,card_type_id,title,status,revision,type_version_id,current_version_id,values) VALUES($1,$2,$3,$4,'active',1,$5,NULL,$6::jsonb)",[cardId,decision.targetSpaceId,type.id,candidate.title,type.version_id,JSON.stringify(validated.values)]);await client.query("INSERT INTO new_design.card_versions(id,card_id,revision,type_version_id,title,values,source) VALUES($1,$2,1,$3,$4,$5::jsonb,'create')",[cardVersionId,cardId,type.version_id,candidate.title,JSON.stringify(validated.values)]);await client.query("UPDATE new_design.cards SET current_version_id=$2 WHERE id=$1",[cardId,cardVersionId]);for(const [key,value]of [["$title",candidate.title],...Object.entries(validated.values)])await client.query("INSERT INTO new_design.card_field_origins(id,card_id,field_key,source_kind,source_id,confirmation_status,original_value,current_value) VALUES($1,$2,$3,'research',$4,'confirmed',$5::jsonb,$5::jsonb)",[randomUUID(),cardId,key,candidate.research_version_id,JSON.stringify(value)]);
      }
      await client.query("INSERT INTO new_design.research_candidate_adoptions(id,candidate_id,action,target_space_id,target_card_id,applied_values) VALUES($1,$2,$3,$4,$5,$6::jsonb)",[randomUUID(),candidate.id,decision.action,targetSpaceId,cardId,JSON.stringify(appliedValues)]);
      if(decision.action!=="ignore"&&decision.action!=="reference_only")await client.query("UPDATE new_design.research_candidates SET status='adopted',revision=revision+1,updated_at=now() WHERE id=$1",[candidate.id]);
      await client.query("UPDATE new_design.research_candidate_batches SET status=CASE WHEN EXISTS(SELECT 1 FROM new_design.research_candidates WHERE batch_id=$1 AND status='candidate') THEN 'partially_adopted' ELSE 'adopted' END WHERE id=$1",[candidate.batch_id]);
      outputs.push({candidateId:String(candidate.id),action:decision.action,cardId});
    }
    await client.query("COMMIT");return outputs;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function listCandidateTargetCards(spaceId:string,typeKey:string):Promise<CardSummary[]>{const result=await(await getNewDesignPool()).query("SELECT card.id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.space_id=$1 AND type.type_key=$2 AND card.status='active' ORDER BY card.updated_at DESC",[spaceId,typeKey]);return Promise.all(result.rows.map((row)=>getCard(String(row.id))));}
