import type {PoolClient} from 'pg';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {resourceSupplementCommitInputSchema,resourceSupplementCorrectionCommitReceiptSchema,type ResourceSupplementCommitInput,type ResourceSupplementCorrectionCommitReceipt} from '../../../../common/resourceSupplements/correctionCommit';
import {NewDesignError} from '../../../domain/errors';
import {stable,stableHash} from '../../aiContracts/integrity';
import {getNewDesignPool} from '../../runtime';
import {writeResourceSupplementMergedSettlementInTransaction} from '../../chapterSettlement';
import {rebuildStateProjectionInTransaction} from '../../stateStore';
import {ResourceSupplementError} from '../commands';
import {previewResourceSupplementSettlementInTransaction} from '../downstream';
import {recordResourceSupplementIntegrityInTransaction} from '../integrity';

const requestFrame=(bookId:string,sessionId:string,input:ResourceSupplementCommitInput)=>({contract:'resource_supplement_correction_commit_v1',bookId,sessionId,input});
async function storage(client:PoolClient,writing:boolean):Promise<void>{
  if(!(await client.query(`SELECT id FROM new_design.schema_migrations WHERE id IN ('092_resource_supplement_formal_commits','094_resource_supplement_correction_commits')
    AND to_regclass('new_design.resource_supplement_formal_commits') IS NOT NULL
    AND ($1::boolean=false OR (id='094_resource_supplement_correction_commits' AND position('resource_supplement_correction_commit_v1' IN coalesce(pg_get_functiondef(
      to_regprocedure('new_design.reject_unavailable_resource_integrity_resolution()')),''))>0
      AND position('assert_resource_supplement_formal_closure' IN coalesce(pg_get_functiondef(
        to_regprocedure('new_design.require_resource_supplement_closure()')),''))>0))`,[writing])).rowCount)
    throw new NewDesignError('资源补充的正式提交闭环尚不可用，请保留原清单和确认记录。',503);
}
async function original(client:PoolClient,bookId:string,sessionId:string,input:ResourceSupplementCommitInput):Promise<ResourceSupplementCorrectionCommitReceipt|null>{
  const row=(await client.query(`SELECT session_id,full_input,input_hash,canonical_input,original_receipt,receipt_hash,canonical_receipt
    FROM new_design.resource_supplement_formal_commits WHERE book_id=$1 AND request_key=$2`,[bookId,input.requestKey])).rows[0];
  if(!row)return null;
  const parsed=resourceSupplementCorrectionCommitReceiptSchema.safeParse(row.original_receipt);
  if(!parsed.success||row.session_id!==sessionId||row.input_hash!==stableHash(requestFrame(bookId,sessionId,input))
    ||row.canonical_input!==stable(requestFrame(bookId,sessionId,input))||stableHash(row.full_input)!==stableHash(input)
    ||row.canonical_receipt!==stable(row.original_receipt)||row.receipt_hash!==stableHash(row.original_receipt)
    ||parsed.data.inputHash!==row.input_hash||parsed.data.bookId!==bookId||parsed.data.sessionId!==sessionId
    ||stableHash(parsed.data.input)!==stableHash(input))
    throw new ResourceSupplementError('原正式回执与完整输入或来源不一致，请保留原键核对，不能重复写入。',409,'unknown');
  return {...parsed.data,repeated:true};
}
function parse(bookId:string,sessionId:string,raw:ResourceSupplementCommitInput):ResourceSupplementCommitInput{z.string().uuid().parse(bookId);z.string().uuid().parse(sessionId);return resourceSupplementCommitInputSchema.parse(raw);}
/** Complete original lookup only; no current source or write gate reinterpretation. */
export async function readResourceSupplementCorrectionCommitOriginal(bookId:string,sessionId:string,raw:ResourceSupplementCommitInput):Promise<ResourceSupplementCorrectionCommitReceipt|null>{
  const input=parse(bookId,sessionId,raw),client=await getNewDesignPool().then(pool=>pool.connect()).catch(()=>{throw new ResourceSupplementError('原正式结果未能读取，请保留完整原请求核对。',503,'unknown');});
  try{await client.query('BEGIN READ ONLY');await storage(client,false);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`resource-supplement-commit:${bookId}:${input.requestKey}`]);
    const saved=await original(client,bookId,sessionId,input);await client.query('COMMIT');return saved;
  }catch(error){try{await client.query('ROLLBACK');}catch{/* Keep unknown. */}
    if(error instanceof ResourceSupplementError)throw error;
    throw new ResourceSupplementError(error instanceof NewDesignError?error.message:'原正式结果未确认，请保留完整原请求核对。',error instanceof NewDesignError?error.status:503,'unknown');
  }finally{client.release();}
}
/** No HTTP/UI mounting or startup activation. Manual 094 requires complete actual
 * corrective source, full author review, every immutable resolution and final proof. */
export async function commitResourceSupplementCorrection(bookId:string,sessionId:string,raw:ResourceSupplementCommitInput):Promise<ResourceSupplementCorrectionCommitReceipt>{
  const input=parse(bookId,sessionId,raw),client=await getNewDesignPool().then(pool=>pool.connect()).catch(()=>{throw new ResourceSupplementError('原正式结果未能读取，请保留原键和完整输入核对。',503,'unknown');});
  const locks=[`resource-supplement-commit:${bookId}:${input.requestKey}`,`chapter_settlement_editing_book:${bookId}`];let readingOriginal=true,committing=false;
  try{
    for(const lock of locks)await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[lock]);
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await storage(client,false);
    const saved=await original(client,bookId,sessionId,input);readingOriginal=false;if(saved){await client.query('ROLLBACK');return saved;}await storage(client,true);
    await client.query('SELECT id FROM new_design.books WHERE id=$1 FOR SHARE',[bookId]);
    await client.query(`SELECT session.id FROM new_design.chapter_adoption_sessions session JOIN new_design.chapter_documents document ON document.id=session.chapter_document_id
      WHERE session.id=$1 AND session.book_id=$2 FOR UPDATE OF session,document`,[sessionId,bookId]);
    const impact=await previewResourceSupplementSettlementInTransaction(client,bookId,sessionId);
    if(impact.sessionRevision!==input.expectedSessionRevision||impact.impactHash!==input.expectedImpactHash)throw new NewDesignError('原清单或下游实际来源已变化，请重新核对并确认结算影响。',409);
    if((impact.inputSnapshot.source as Record<string,unknown>).contract!=='stable_resource_correction_preview_v1')throw new NewDesignError('请使用明确冲突来源的独立修正清单。',409);
    const merged=await writeResourceSupplementMergedSettlementInTransaction(client,bookId,sessionId,input);
    await recordResourceSupplementIntegrityInTransaction(client,bookId,merged,impact);
    await recordResolutions(client,bookId,merged.checkpointId,input);
    for(const change of impact.changes)await rebuildStateProjectionInTransaction(client,{bookId,subjectKind:change.subjectKind,subjectId:change.subjectId,stateKey:change.stateKey});
    const sources=(await client.query(`SELECT origin.original_receipt original_start,review.original_receipt original_review
      FROM new_design.chapter_resource_supplements origin JOIN new_design.resource_supplement_impact_reviews review ON review.session_id=origin.session_id AND review.book_id=origin.book_id
      WHERE origin.book_id=$1 AND origin.session_id=$2 AND review.review_id=$3`,[bookId,sessionId,input.reviewId])).rows[0];
    const issues=(await client.query('SELECT to_jsonb(issue) issue FROM new_design.resource_supplement_integrity_issues issue WHERE settlement_id=$1 AND book_id=$2 ORDER BY issue_id',[merged.settlementId,bookId])).rows.map(row=>row.issue);
    const resolutions=(await client.query('SELECT to_jsonb(proof) proof FROM new_design.resource_supplement_integrity_resolutions proof WHERE book_id=$1 AND correction_checkpoint_id=$2 ORDER BY issue_id',[bookId,merged.checkpointId])).rows.map(row=>row.proof);
    const chapterDocumentId=sources?.original_start?.chapterDocumentId,inputHash=stableHash(requestFrame(bookId,sessionId,input));
    const receipt=resourceSupplementCorrectionCommitReceiptSchema.parse({contract:'resource_supplement_correction_commit_v1',bookId,sessionId,chapterDocumentId,input,inputHash,merged,
      originalStart:sources?.original_start,originalReview:sources?.original_review,issues,resolutions,sourceRoute:`/new-design/books/${bookId}/writing?chapterDocument=${chapterDocumentId}&session=${sessionId}`,repeated:false});
    await client.query(`INSERT INTO new_design.resource_supplement_formal_commits(book_id,session_id,settlement_id,request_key,full_input,input_hash,canonical_input,original_receipt,receipt_hash,canonical_receipt)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$10)`,[bookId,sessionId,merged.settlementId,input.requestKey,JSON.stringify(input),inputHash,stable(requestFrame(bookId,sessionId,input)),JSON.stringify(receipt),stableHash(receipt),stable(receipt)]);
    committing=true;await client.query('COMMIT');return receipt;
  }catch(error){let rolledBack=false;try{await client.query('ROLLBACK');rolledBack=true;}catch{/* Keep unknown. */}
    if(error instanceof ResourceSupplementError)throw error;
    const reported=new ResourceSupplementError(error instanceof NewDesignError?error.message:'正式补充结果未确认，请保留原键和全部输入核对。',error instanceof NewDesignError?error.status:503,readingOriginal||committing||!rolledBack?'unknown':'not_written');
    Object.defineProperty(reported,'cause',{value:error});throw reported;
  }finally{let broken=false;for(const lock of [...locks].reverse())try{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]);}catch{broken=true;}client.release(broken);}
}


/** Own all related issue proofs in the same physical merge transaction. */
async function recordResolutions(client:PoolClient,bookId:string,checkpointId:string,input:ResourceSupplementCommitInput):Promise<void>{
  const rows=(await client.query(`SELECT to_jsonb(issue) issue,origin.original_receipt original_start,review.original_receipt original_review,journal.merged_write,
    origin.source_snapshot correction_source,to_jsonb(change) corrected_state,to_jsonb(proposal) proposal,to_jsonb(anchor) anchor,to_jsonb(body) body,
    to_jsonb(checkpoint) checkpoint,to_jsonb(settlement) settlement
    FROM new_design.chapter_stable_checkpoints checkpoint
    JOIN new_design.chapter_resource_supplements origin ON origin.session_id=checkpoint.session_id AND origin.book_id=checkpoint.book_id
    JOIN new_design.resource_supplement_integrity_journals journal ON journal.checkpoint_id=checkpoint.id AND journal.book_id=checkpoint.book_id
    JOIN new_design.resource_supplement_impact_reviews review ON review.review_id=journal.review_id AND review.session_id=checkpoint.session_id
    JOIN new_design.state_changes change ON change.settlement_id=checkpoint.settlement_id AND change.book_id=checkpoint.book_id AND change.status='active'
    JOIN new_design.state_change_proposals proposal ON proposal.id=change.proposal_id
    JOIN new_design.chapter_text_anchors anchor ON anchor.id=change.text_anchor_id
    JOIN new_design.chapter_body_versions body ON body.id=checkpoint.body_version_id
    JOIN new_design.chapter_settlements settlement ON settlement.id=checkpoint.settlement_id
    JOIN new_design.resource_supplement_integrity_issues issue ON issue.book_id=checkpoint.book_id AND (origin.original_receipt->'relatedIssueIds') ? issue.issue_id::text
    WHERE checkpoint.id=$1 AND checkpoint.book_id=$2 ORDER BY issue.issue_id`,[checkpointId,bookId])).rows;
  if(!rows.length||rows.length!==rows[0].original_start.relatedIssueIds.length||new Set(rows.map(row=>row.issue.issue_id)).size!==rows.length)
    throw new NewDesignError('实际修正缺少完整关联冲突或唯一正式状态，不能解除来源阻断。',409);
  for(const row of rows){
    const resolutionId=randomUUID(),requestKey=randomUUID(),proof={contract:'resource_supplement_correction_resolution_v1',resolutionId,requestKey,bookId,issue:row.issue,
      formalInput:input,originalStart:row.original_start,originalReview:row.original_review,merged:row.merged_write,correctionSource:row.correction_source,
      correctedState:row.corrected_state,proposal:row.proposal,anchor:row.anchor,body:row.body,checkpoint:row.checkpoint,settlement:row.settlement};
    const proofHash=stableHash(proof),receipt={contract:'resource_supplement_correction_resolution_v1',resolutionId,requestKey,bookId,issueId:row.issue.issue_id,
      correctionCheckpointId:checkpointId,proofHash,sourceRoute:`/new-design/books/${bookId}/writing?chapterDocument=${row.checkpoint.chapter_document_id}&session=${row.checkpoint.session_id}&resourceIssue=${row.issue.issue_id}`};
    await client.query(`INSERT INTO new_design.resource_supplement_integrity_resolutions(resolution_id,issue_id,book_id,correction_checkpoint_id,request_key,full_proof,proof_hash,canonical_proof,original_receipt)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb)`,[resolutionId,row.issue.issue_id,bookId,checkpointId,requestKey,JSON.stringify(proof),proofHash,stable(proof),JSON.stringify(receipt)]);
  }
}
