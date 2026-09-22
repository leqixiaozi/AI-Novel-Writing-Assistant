import {chapterAdoptionSessionRows,chapterResourceSupplementRows,chapterStableCheckpointRows,resourceSupplementIntegrityIssueRows,resourceSupplementIntegrityJournalRows,resourceSupplementIntegrityResolutionRows} from '../persistence';
import {z} from 'zod';
import {requireCardWorkflowTypes} from '../persistence';
import type {ResourceSupplementIssue,ResourceSupplementIssueSource} from '../../../../common/resourceSupplements/api';
import {NewDesignError} from '../../../domain/errors';
import {getNewDesignPool} from '../../runtime';
import {readFrozenSupplementSource} from '../../chapterSettlement';
import {readStableResourceSupplementBasisInTransaction} from '../basis';
import {previewResourceSupplementCorrectionInTransaction} from '../integrity/correctionPreview';
import type {ResourceSupplementCorrectionPreviewInput} from '../../../../common/resourceSupplements/correction';
const uuid=z.string().uuid();
export function previewResourceSupplementCorrection(book:string,input:ResourceSupplementCorrectionPreviewInput){uuid.parse(book);return read(client=>previewResourceSupplementCorrectionInTransaction(client,book,input));}
async function read<T>(run:(client:import('pg').PoolClient)=>Promise<T>):Promise<T>{
 const client=await(await getNewDesignPool()).connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await run(client);await client.query('COMMIT');return result;}catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
}
export function getResourceSupplementSource(book:string,session:string){
 uuid.parse(book);uuid.parse(session);return read(async client=>{
  const row=(await client.query(`SELECT session.*,body.content_hash body_hash FROM ${chapterAdoptionSessionRows} session
   JOIN new_design.chapter_documents document ON document.id=session.chapter_document_id AND document.book_id=session.book_id
   JOIN new_design.chapter_body_versions body ON body.id=session.body_version_id AND body.chapter_document_id=document.id
   WHERE session.book_id=$1 AND session.id=$2 AND session.adoption_kind='resource_supplement'`,[book,session])).rows[0];
  if(!row)throw new NewDesignError('原补充清单不属于当前书籍，不能代用其他会话。',404);
  return readFrozenSupplementSource(client,row,String(row.body_hash));
 });
}
export function getResourceSupplementChapterBasis(book:string,document:string){
 uuid.parse(book);uuid.parse(document);return read(async client=>{
  const rows=(await client.query(`SELECT checkpoint.id FROM ${chapterStableCheckpointRows} checkpoint
   JOIN new_design.chapter_documents document ON document.id=checkpoint.chapter_document_id AND document.book_id=checkpoint.book_id
    AND document.status='active' AND document.adopted_version_id=checkpoint.body_version_id
   WHERE checkpoint.book_id=$1 AND document.id=$2 AND checkpoint.status='stable' LIMIT 2`,[book,document])).rows;
  if(rows.length!==1)throw new NewDesignError('本章没有唯一有效稳定结果，请先核对原结算。',409);
  return readStableResourceSupplementBasisInTransaction(client,book,String(rows[0].id));
 });
}
export function listResourceSupplementIssues(book:string,character:string):Promise<ResourceSupplementIssue[]>{
 uuid.parse(book);uuid.parse(character);return read(async client=>{
  if(!(await client.query(`SELECT card.id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND NOT type.is_internal JOIN new_design.books book ON book.space_id=card.space_id
    WHERE book.id=$1 AND card.id=$2 AND card.status='active'`,[book,character])).rowCount)throw new NewDesignError('请选择本书的真实人物来源。',404);
  await requireCardWorkflowTypes(client,['resource_supplement_integrity_issue','resource_supplement_integrity_resolution','resource_supplement_integrity_journal']);
  const rows=(await client.query(`SELECT issue.issue_id,issue.chapter_document_id,issue.body_version_id,document.title,issue.state_key,issue.source_route
   FROM ${resourceSupplementIntegrityIssueRows} issue
   JOIN ${resourceSupplementIntegrityJournalRows} journal ON journal.settlement_id=issue.settlement_id AND journal.book_id=issue.book_id
   JOIN ${chapterResourceSupplementRows} origin ON origin.session_id=(journal.merged_write->>'sessionId')::uuid AND origin.book_id=issue.book_id
   JOIN new_design.chapter_documents document ON document.id=issue.chapter_document_id AND document.book_id=issue.book_id
   WHERE issue.book_id=$1 AND origin.full_input#>>'{resourceScope,characterId}'=$2
    AND NOT EXISTS(SELECT 1 FROM ${resourceSupplementIntegrityResolutionRows} resource_supplement_integrity_resolution_record WHERE issue_id=issue.issue_id)
   ORDER BY document.logical_order,issue.issue_id LIMIT 501`,[book,character])).rows;
  if(rows.length>500)throw new NewDesignError('人物资源冲突超过完整读取范围，请先明确章节范围，不会截断来源。',422);
  return rows.map(row=>({issueId:row.issue_id,chapterDocumentId:row.chapter_document_id,bodyVersionId:row.body_version_id,title:row.title,stateKey:row.state_key,sourceRoute:row.source_route}));
 });
}
export function getResourceSupplementIssueSource(book:string,issue:string):Promise<ResourceSupplementIssueSource>{
 uuid.parse(book);uuid.parse(issue);return read(async client=>{
  await requireCardWorkflowTypes(client,['resource_supplement_integrity_issue','resource_supplement_integrity_journal']);
  const row=(await client.query(`SELECT to_jsonb(issue) issue,origin.full_input->'resourceScope' resource_scope FROM ${resourceSupplementIntegrityIssueRows} issue
   JOIN ${resourceSupplementIntegrityJournalRows} journal ON journal.settlement_id=issue.settlement_id AND journal.book_id=issue.book_id
   JOIN ${chapterResourceSupplementRows} origin ON origin.session_id=(journal.merged_write->>'sessionId')::uuid AND origin.book_id=issue.book_id
   WHERE issue.book_id=$1 AND issue.issue_id=$2`,[book,issue])).rows[0];
  if(!row)throw new NewDesignError('原冲突不属于当前书籍，请从本书人物资源返回原章节。',404);
  return {issue:row.issue,resourceScope:row.resource_scope,sourceRoute:row.issue.source_route};
 });
}
