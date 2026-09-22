import {chapterQualityRequestRows,chapterWritingRequestRows,planningObjectRows,planningVersionRows,qualityAuditReportRows,qualityFixAdoptionRows,qualityFixCandidateRows,qualityFixCandidateVersionRows,qualityIssueRows} from '../chapterProduction/persistence';
import {assertFound,NewDesignError} from '../../domain/errors';
import {qualityTransaction} from './index';
import {recordQualityFixAdoptionInTransaction} from '../qualityAudits';
import {prepareSelectedChapterProduction} from '../chapterProduction';
import type {PoolClient} from 'pg';
import {readChapterQualitySources} from './sources';
import {stableHash} from '../aiContracts';
async function source(client:PoolClient,bookId:string,candidateId:string){return assertFound((await client.query(`SELECT candidate.*,version.target_chapter_document_id,version.target_body_version_id,version.patch,issue.current_status issue_status,issue.current_version_id issue_version_id,issue.report_id,report.stale_at
 FROM ${qualityFixCandidateRows} candidate JOIN ${qualityFixCandidateVersionRows} version ON version.id=candidate.current_version_id JOIN ${qualityIssueRows} issue ON issue.id=candidate.issue_id JOIN ${qualityAuditReportRows} report ON report.id=issue.report_id JOIN ${chapterQualityRequestRows} receipt ON receipt.report_id=report.id AND receipt.book_id=$1
 WHERE candidate.id=$2 AND candidate.book_id=$1 FOR UPDATE OF candidate,issue`,[bookId,candidateId])).rows[0],'本书章节诊断修复来源不存在。');}
export async function getChapterQualityRepairState(bookId:string,candidateId:string){return qualityTransaction(bookId,async client=>{
 const candidate=await source(client,bookId,candidateId),requests=(await client.query(`SELECT id,status,result_body_version_id,idempotency_key FROM ${chapterWritingRequestRows} chapter_writing_request_rows_record WHERE book_id=$1 AND chapter_document_id=$2 AND input_body_version_id=$3 AND instruction=$4 AND controlled_snapshot IS NOT NULL ORDER BY created_at DESC LIMIT 20`,[bookId,candidate.target_chapter_document_id,candidate.target_body_version_id,candidate.patch.instruction])).rows;
 const document=assertFound((await client.query('SELECT adopted_version_id,revision FROM new_design.chapter_documents WHERE id=$1 AND book_id=$2',[candidate.target_chapter_document_id,bookId])).rows[0],'原章节不存在。');
 return{candidateId,chapterDocumentId:String(candidate.target_chapter_document_id),candidateVersionId:String(candidate.current_version_id),candidateStatus:String(candidate.status),issueStatus:String(candidate.issue_status),documentRevision:Number(document.revision),adoptedBodyVersionId:document.adopted_version_id??null,requests:requests.map(request=>({id:String(request.id),status:String(request.status),bodyVersionId:request.result_body_version_id??null,requestKey:String(request.idempotency_key)}))};
 });}
export async function prepareChapterQualityRepair(bookId:string,candidateId:string,input:{candidateVersionId:string;expectedDocumentRevision:number;requestKey:string}){
 const prepared=await qualityTransaction(bookId,async client=>{
  const candidate=await source(client,bookId,candidateId);
  if(candidate.patch.sourceIssueVersionId!==candidate.issue_version_id)throw new NewDesignError('原问题描述或证据版本已修改，请重新核对修复要求。',409);
  if(candidate.current_version_id!==input.candidateVersionId||candidate.accepted_version_id!==input.candidateVersionId||candidate.status!=='accepted'||candidate.stale_at||candidate.issue_status!=='fix_proposed')throw new NewDesignError('请先接受确切修复方案，并核对原问题与报告仍有效。',409);
  const document=assertFound((await client.query('SELECT adopted_version_id,revision FROM new_design.chapter_documents WHERE id=$1 AND book_id=$2 FOR UPDATE',[candidate.target_chapter_document_id,bookId])).rows[0],'原章节不存在。');
  if(document.adopted_version_id!==candidate.target_body_version_id||Number(document.revision)!==input.expectedDocumentRevision)throw new NewDesignError('修复需要报告绑定的当前采用正文；原稿或修订变化，请重新诊断。',409);
  if(typeof candidate.patch.instruction!=='string'||candidate.patch.instruction.length>4000)throw new NewDesignError('原完整修复要求不可用，请查看问题证据。',422);
  return{documentId:String(candidate.target_chapter_document_id),bodyVersionId:String(candidate.target_body_version_id),instruction:candidate.patch.instruction};
 });
 return prepareSelectedChapterProduction(prepared.documentId,{operationKind:'fix',baseBodyVersionId:prepared.bodyVersionId,instruction:prepared.instruction,expectedRevision:input.expectedDocumentRevision,idempotencyKey:input.requestKey,createdBy:'user'});
}
export async function recordChapterQualityRepair(bookId:string,candidateId:string,input:{candidateVersionId:string;chapterWritingRequestId:string;requestKey:string}){return qualityTransaction(bookId,async client=>{
 const candidate=await source(client,bookId,candidateId);
 if(candidate.patch.sourceIssueVersionId!==candidate.issue_version_id)throw new NewDesignError('原问题版本已修改，不将旧候选登记为新问题修复。',409);
 if(candidate.current_version_id!==input.candidateVersionId)throw new NewDesignError('原修复版本已变化，不登记另一候选。',409);
 const request=assertFound((await client.query(`SELECT * FROM ${chapterWritingRequestRows} chapter_writing_request_rows_record WHERE id=$1 AND book_id=$2 AND status='succeeded' AND controlled_snapshot IS NOT NULL`,[input.chapterWritingRequestId,bookId])).rows[0],'原修复正文候选尚未成功保存。');
 if(request.chapter_document_id!==candidate.target_chapter_document_id||request.input_body_version_id!==candidate.target_body_version_id||request.instruction!==candidate.patch.instruction||!request.result_body_version_id)throw new NewDesignError('原请求不对应本问题的确切修复要求、正文与返回候选。',422);
 const adoption=assertFound((await client.query('SELECT adoption.id FROM new_design.chapter_body_adoptions adoption JOIN new_design.chapter_documents document ON document.id=adoption.chapter_document_id WHERE document.book_id=$1 AND adoption.chapter_document_id=$2 AND adoption.from_version_id=$3 AND adoption.to_version_id=$4 AND document.adopted_version_id=$4 ORDER BY adoption.created_at DESC LIMIT 1',[bookId,candidate.target_chapter_document_id,candidate.target_body_version_id,request.result_body_version_id])).rows[0],'原修复候选尚未从报告正文正式采用。');
 const existing=(await client.query(`SELECT * FROM ${qualityFixAdoptionRows} quality_fix_adoption_rows_record WHERE idempotency_key=$1 OR candidate_id=$2`,[input.requestKey,candidateId])).rows[0];
 if(existing){if(existing.candidate_id!==candidateId||existing.candidate_version_id!==input.candidateVersionId||existing.chapter_body_adoption_id!==adoption.id||existing.idempotency_key!==input.requestKey)throw new NewDesignError('原登记回执用于不同修复请求，请核对原键。',409);return{candidateId,bodyVersionId:String(request.result_body_version_id),recorded:true};}
 const originalReceipt=assertFound((await client.query(`SELECT frozen_snapshot,input_payload FROM ${chapterQualityRequestRows} chapter_quality_request_rows_record WHERE report_id=$1 AND book_id=$2`,[candidate.report_id,bookId])).rows[0],'原诊断快照不存在。'),original=originalReceipt.frozen_snapshot.input;
 const document=assertFound((await client.query('SELECT revision FROM new_design.chapter_documents WHERE id=$1 AND book_id=$2 FOR UPDATE',[candidate.target_chapter_document_id,bookId])).rows[0],'原章节不存在。');
 const current=await readChapterQualitySources(client,bookId,{...originalReceipt.input_payload,expectedDocumentRevision:Number(document.revision),recheckIssueId:null});
 if(stableHash(current.plans)!==stableHash(original.plans)||stableHash(current.materials)!==stableHash(original.materials)||stableHash(current.continuity)!==stableHash(original.continuity))throw new NewDesignError('原诊断计划、资料或连续性来源已变化，请对新范围重新诊断，不将旧问题标记解决。',409);
 for(const plan of original.plans){if(!(await client.query(`SELECT 1 FROM ${planningObjectRows} object JOIN ${planningVersionRows} version ON version.id=object.adopted_version_id WHERE object.id=$1 AND object.book_id=$2 AND object.adopted_version_id=$3 AND object.status='active' AND version.stale_at IS NULL`,[plan.objectId,bookId,plan.versionId])).rowCount)throw new NewDesignError('原诊断规划已变化，请对新正式范围重新诊断，不将旧修复标记解决。',409);}
 if(candidate.issue_status!=='fix_proposed'&&candidate.issue_status!=='stale')throw new NewDesignError('原问题处理状态已变化，不覆盖作者决定。',409);
 await recordQualityFixAdoptionInTransaction(client,candidateId,{candidateVersionId:input.candidateVersionId,chapterBodyAdoptionId:String(adoption.id),idempotencyKey:input.requestKey,actor:'user'});
 return{candidateId,bodyVersionId:String(request.result_body_version_id),recorded:true};
 });}
export async function getChapterQualityRepairRecord(bookId:string,candidateId:string,key:string){return qualityTransaction(bookId,async client=>{const row=(await client.query(`SELECT adoption.candidate_version_id,adoption.adopted_body_version_id,adoption.idempotency_key FROM ${qualityFixAdoptionRows} adoption JOIN ${qualityFixCandidateRows} candidate ON candidate.id=adoption.candidate_id WHERE candidate.book_id=$1 AND candidate.id=$2 AND adoption.idempotency_key=$3`,[bookId,candidateId,key])).rows[0];return row?{candidateId,candidateVersionId:String(row.candidate_version_id),bodyVersionId:String(row.adopted_body_version_id),requestKey:String(row.idempotency_key)}:null;});}
