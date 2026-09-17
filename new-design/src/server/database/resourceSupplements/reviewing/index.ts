import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {resourceSupplementImpactReviewInputSchema,resourceSupplementImpactReviewReceiptSchema,
  type ResourceSupplementImpactReviewInput,type ResourceSupplementImpactReviewReceipt} from '../../../../common/resourceSupplements/review';
import {NewDesignError} from '../../../domain/errors';
import {stable,stableHash} from '../../aiContracts/integrity';
import {getNewDesignPool} from '../../runtime';
import {ResourceSupplementError} from '../commands';
import {previewResourceSupplementSettlementInTransaction} from '../downstream';
import type {ResourceSupplementSettlementImpact} from '../../../../common/resourceSupplements';

const requestFrame=(bookId:string,sessionId:string,input:ResourceSupplementImpactReviewInput)=>({contract:'resource_supplement_impact_review_v1',bookId,sessionId,input});
async function original(client:PoolClient,bookId:string,sessionId:string,input:ResourceSupplementImpactReviewInput):Promise<ResourceSupplementImpactReviewReceipt|null>{
  const row=(await client.query(`SELECT review_id,book_id,session_id,input_hash,full_input,impact_snapshot,original_receipt
    FROM new_design.resource_supplement_impact_reviews WHERE book_id=$1 AND request_key=$2`,[bookId,input.requestKey])).rows[0];
  if(!row)return null;
  const parsed=resourceSupplementImpactReviewReceiptSchema.safeParse(row.original_receipt),expected=stableHash(requestFrame(bookId,sessionId,input));
  if(!parsed.success)throw new ResourceSupplementError('原影响确认回执不完整，请保留原请求核对。',409,'unknown');
  const saved=parsed.data,{impactHash,...frame}=saved.impact;
  if(row.book_id!==bookId||row.session_id!==sessionId||row.review_id!==saved.reviewId||saved.bookId!==bookId||saved.sessionId!==sessionId
    ||row.input_hash!==expected||saved.inputHash!==expected||stableHash(row.full_input)!==stableHash(input)||stableHash(saved.input)!==stableHash(input)
    ||stableHash(row.impact_snapshot)!==stableHash(saved.impact)||stableHash(frame)!==impactHash)
    throw new ResourceSupplementError('原确认与完整输入或实际来源不一致，不能覆盖，请保留原键核对。',409,'unknown');
  return {...saved,impact:saved.impact as ResourceSupplementImpactReviewReceipt['impact'],repeated:true};
}
async function storage(client:PoolClient,writing:boolean):Promise<void>{
  const result=await client.query(`SELECT id FROM new_design.schema_migrations WHERE id='089_resource_supplement_impact_reviews'
    AND to_regclass('new_design.resource_supplement_impact_reviews') IS NOT NULL
    AND ($1::boolean=false OR position('resource_supplement_impact_review_v1' IN coalesce(pg_get_functiondef(to_regprocedure('new_design.validate_resource_supplement_impact_review()')),''))>0)`,[writing]);
  if(!result.rowCount)throw new NewDesignError('结算影响确认尚不可用，请保留原候选与来源。',503);
}
function validateIdentity(bookId:string,sessionId:string):void{z.string().uuid().parse(bookId);z.string().uuid().parse(sessionId);}
/** Commit owner must supply its freshly validated impact in the same transaction. */
export async function readResourceSupplementImpactReviewForSettlementInTransaction(client:PoolClient,bookId:string,sessionId:string,reviewId:string,impact:ResourceSupplementSettlementImpact):Promise<ResourceSupplementImpactReviewReceipt>{
  validateIdentity(bookId,sessionId);z.string().uuid().parse(reviewId);
  await storage(client,true);
  const row=(await client.query('SELECT full_input FROM new_design.resource_supplement_impact_reviews WHERE review_id=$1 AND book_id=$2 AND session_id=$3 FOR SHARE',[reviewId,bookId,sessionId])).rows[0];
  if(!row)throw new NewDesignError('请先核对并明确确认本次完整结算影响。',409);
  const input=resourceSupplementImpactReviewInputSchema.parse(row.full_input),saved=await original(client,bookId,sessionId,input);
  if(!saved||saved.reviewId!==reviewId||impact.bookId!==bookId||impact.sessionId!==sessionId||saved.impact.impactHash!==impact.impactHash||stableHash(saved.impact)!==stableHash(impact))
    throw new NewDesignError('原影响确认对应的候选或下游来源已变化，请重新核对，不能沿用旧确认结算。',409);
  return saved;
}
/** Saved results remain readable after archive, source changes or deactivation. */
export async function readResourceSupplementImpactReviewOriginal(bookId:string,sessionId:string,raw:ResourceSupplementImpactReviewInput):Promise<ResourceSupplementImpactReviewReceipt|null>{
  validateIdentity(bookId,sessionId);const input=resourceSupplementImpactReviewInputSchema.parse(raw);
  const client=await(await getNewDesignPool()).connect().catch(()=>{throw new ResourceSupplementError('原确认结果未能读取，请保留完整原请求核对。',503,'unknown');});
  try{await client.query('BEGIN READ ONLY');await storage(client,false);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`resource-supplement-review:${bookId}:${input.requestKey}`]);
    const saved=await original(client,bookId,sessionId,input);await client.query('COMMIT');return saved;}
  catch(error){try{await client.query('ROLLBACK');}catch{/* No writes. */}if(error instanceof ResourceSupplementError)throw error;
    throw new ResourceSupplementError(error instanceof NewDesignError?error.message:'原确认结果未能读取，请保留原请求，勿按无记录重新提交。',error instanceof NewDesignError?error.status:503,'unknown');}
  finally{client.release();}
}
/** Internal, unmounted command. Does not commit states, clear flags or change a body. */
export async function confirmResourceSupplementSettlementImpact(bookId:string,sessionId:string,raw:ResourceSupplementImpactReviewInput):Promise<ResourceSupplementImpactReviewReceipt>{
  validateIdentity(bookId,sessionId);const input=resourceSupplementImpactReviewInputSchema.parse(raw),pool=await getNewDesignPool();
  const client=await pool.connect().catch(()=>{throw new ResourceSupplementError('原确认结果未能读取，请保留完整原请求核对。',503,'unknown');});
  const locks=[`resource-supplement-review:${bookId}:${input.requestKey}`,`chapter_settlement_editing_book:${bookId}`];
  let readingOriginal=true,committing=false;
  try{
    for(const lock of locks)await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[lock]);
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await storage(client,false);
    const prior=await original(client,bookId,sessionId,input);readingOriginal=false;
    if(prior){await client.query('ROLLBACK');return prior;}
    await storage(client,true);
    await client.query('SELECT id FROM new_design.chapter_adoption_sessions WHERE book_id=$1 AND id=$2 FOR UPDATE',[bookId,sessionId]);
    const impact=await previewResourceSupplementSettlementInTransaction(client,bookId,sessionId);
    if(impact.sessionRevision!==input.expectedSessionRevision||impact.impactHash!==input.expectedImpactHash)
      throw new NewDesignError('候选或下游正文、计划、确认来源已变化，请保留原说明并重新核对结算影响。',409);
    const conflicts=impact.stateChain.filter(row=>row.reason!=='compatible').map(row=>row.stateChangeId);
    if(stableHash([...conflicts].sort())!==stableHash([...input.acknowledgedConflictStateChangeIds].sort()))
      throw new NewDesignError('请逐项核对当前实际前值冲突；确认影响不会解除这些冲突。',422);
    const chapterDocumentId=String((impact.inputSnapshot.session as Record<string,unknown>).chapter_document_id);
    const receipt:ResourceSupplementImpactReviewReceipt={contract:'resource_supplement_impact_review_v1',reviewId:randomUUID(),bookId,sessionId,
      chapterDocumentId,bodyVersionId:impact.bodyVersionId,baseCheckpointId:impact.baseCheckpointId,sessionRevision:impact.sessionRevision,input,
      inputHash:stableHash(requestFrame(bookId,sessionId,input)),impact,
      sourceRoute:`/new-design/books/${bookId}/writing?chapterDocument=${chapterDocumentId}&session=${sessionId}`,repeated:false};
    resourceSupplementImpactReviewReceiptSchema.parse(receipt);
    const {impactHash,...impactFrame}=impact;
    await client.query(`INSERT INTO new_design.resource_supplement_impact_reviews(review_id,book_id,session_id,request_key,session_revision,
      full_input,input_hash,canonical_input,impact_snapshot,impact_hash,canonical_impact,original_receipt)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11,$12::jsonb)`,[receipt.reviewId,bookId,sessionId,input.requestKey,impact.sessionRevision,
      JSON.stringify(input),receipt.inputHash,stable(requestFrame(bookId,sessionId,input)),JSON.stringify(impact),impactHash,stable(impactFrame),JSON.stringify(receipt)]);
    committing=true;await client.query('COMMIT');return receipt;
  }catch(error){let rolledBack=false;try{await client.query('ROLLBACK');rolledBack=true;}catch{/* Preserve unknown. */}
    if(error instanceof ResourceSupplementError)throw error;
    const reported=new ResourceSupplementError(error instanceof NewDesignError?error.message:'确认请求未完成，请保留完整原请求核对。',error instanceof NewDesignError?error.status:503,
      readingOriginal||committing||!rolledBack?'unknown':'not_written');
    throw Object.assign(reported,{cause:error});
  }finally{let broken=false;for(const lock of [...locks].reverse())try{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]);}catch{broken=true;}client.release(broken);}
}
