import {chapterAdoptionPreparationRows,chapterAdoptionSessionRows,chapterResourceSupplementRows,chapterStableCheckpointRows,insertRevisionRecords,insertSupplementSettlementEvents,resourceSupplementCorrectionOriginRows,updateRevisionRecords} from '../persistence';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {requireCardWorkflowTypes} from '../persistence';
import {z} from 'zod';
import {resourceSupplementCorrectionStartInputSchema,resourceSupplementCorrectionStartReceiptSchema,
  type ResourceSupplementCorrectionStartInput,type ResourceSupplementCorrectionStartReceipt,type ResourceSupplementCorrectionPreview} from '../../../../common/resourceSupplements/correction';
import {NewDesignError} from '../../../domain/errors';
import {stable,stableHash} from '../../aiContracts/integrity';
import {getNewDesignPool} from '../../runtime';
import {ResourceSupplementError} from '../commands';
import {previewResourceSupplementCorrectionInTransaction} from '../integrity/correctionPreview';

const requestFrame=(bookId:string,input:ResourceSupplementCorrectionStartInput)=>({contract:'stable_resource_correction_start_v1',bookId,input});
async function storage(client:PoolClient,writing:boolean):Promise<void>{
  await requireCardWorkflowTypes(client,['resource_supplement_correction_origin','chapter_resource_supplement','chapter_adoption_preparation','chapter_adoption_session'],writing);
  if(!(await client.query(`SELECT id FROM new_design.schema_migrations WHERE id='132_card_kernel_tables_only'
    AND ($1::boolean=false OR position('stable_resource_correction_start_v1' IN coalesce(pg_get_functiondef(
      to_regprocedure('new_design.validate_resource_supplement_correction_origin()')),''))>0)`,[writing])).rowCount)
    throw new NewDesignError('修正请求的完整来源保存尚不可用，请保留原冲突与填写。',503);
}
async function original(client:PoolClient,bookId:string,input:ResourceSupplementCorrectionStartInput):Promise<ResourceSupplementCorrectionStartReceipt|null>{
  const row=(await client.query(`SELECT origin.*,correction.issue_id,correction.canonical_input,correction.canonical_source
    FROM ${chapterResourceSupplementRows} origin LEFT JOIN ${resourceSupplementCorrectionOriginRows} correction ON correction.session_id=origin.session_id
    WHERE origin.book_id=$1 AND origin.request_key=$2`,[bookId,input.requestKey]).catch(()=>{
      throw new ResourceSupplementError('原修正结果未能完整读取，请保留原键和全部输入核对，不能以未写入处理。',503,'unknown');
    })).rows[0];
  if(!row)return null;
  const saved=resourceSupplementCorrectionStartReceiptSchema.safeParse(row.original_receipt),preview=row.source_snapshot as ResourceSupplementCorrectionPreview|null;
  if(!saved.success||!preview||preview.contract!=='stable_resource_correction_preview_v1'||!preview.correction||!preview.basis)
    throw new ResourceSupplementError('原修正回执或来源不完整，请保留原键核对，不能创建替代请求。',409,'unknown');
  const receipt=saved.data,{sourceHash,...source}=preview;
  const {sourceHash:correctionHash,...correction}=preview.correction,{sourceHash:basisHash,...basis}=preview.basis;
  if(row.input_hash!==stableHash(requestFrame(bookId,input))||row.canonical_input!==stable(requestFrame(bookId,input))
    ||stableHash(row.full_input)!==stableHash(input)||stableHash(receipt.input)!==stableHash(input)||receipt.inputHash!==row.input_hash
    ||row.canonical_source!==stable(source)||sourceHash!==row.source_hash||stableHash(source)!==sourceHash||receipt.sourceHash!==sourceHash
    ||receipt.bookId!==bookId||receipt.sessionId!==row.session_id||receipt.baseCheckpointId!==row.base_checkpoint_id||receipt.issueId!==row.issue_id
    ||preview.bookId!==bookId||preview.basis.bookId!==bookId||preview.basis.checkpointId!==receipt.baseCheckpointId
    ||preview.basis.chapterDocumentId!==receipt.chapterDocumentId||preview.basis.bodyVersionId!==receipt.bodyVersionId
    ||preview.correction.issueId!==receipt.issueId||preview.correction.baseCheckpointId!==receipt.baseCheckpointId
    ||stableHash(correction)!==correctionHash||stableHash(basis)!==basisHash
    ||stableHash(preview.input)!==stableHash({issueId:input.issueId,resourceScope:input.resourceScope})
    ||stableHash(receipt.relatedIssueIds)!==stableHash(preview.relatedIssues.map(issue=>issue.issue_id)))
    throw new ResourceSupplementError('原修正请求与完整输入、关联冲突或冻结来源不一致，请保留原键核对。',409,'unknown');
  return {...receipt,repeated:true};
}
/** Caller owns the physical transaction. No body adoption, model, candidate,
 * settlement, projection or resolution is written here. */
export async function startResourceSupplementCorrectionInTransaction(client:PoolClient,bookId:string,raw:ResourceSupplementCorrectionStartInput):Promise<ResourceSupplementCorrectionStartReceipt>{
  z.string().uuid().parse(bookId);const input=resourceSupplementCorrectionStartInputSchema.parse(raw);
  if((await client.query('SHOW transaction_isolation')).rows[0]?.transaction_isolation!=='serializable')throw new NewDesignError('修正请求必须在完整隔离事务中保存。',503);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`resource-supplement:${bookId}:${input.requestKey}`]);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`chapter_settlement_editing_book:${bookId}`]);
  await storage(client,false);const saved=await original(client,bookId,input);if(saved)return saved;await storage(client,true);
  await client.query('SELECT id FROM new_design.books WHERE id=$1 FOR SHARE',[bookId]);
  await client.query(`SELECT id FROM new_design.chapter_documents WHERE book_id=$1 AND id=(
    SELECT chapter_document_id FROM ${chapterStableCheckpointRows} chapter_stable_checkpoint_record WHERE id=$2) FOR UPDATE`,[bookId,input.checkpointId]);
  const preview=await previewResourceSupplementCorrectionInTransaction(client,bookId,{issueId:input.issueId,resourceScope:input.resourceScope}),basis=preview.basis;
  if(basis.checkpointId!==input.checkpointId||preview.sourceHash!==input.expectedSourceHash)throw new NewDesignError('实际冲突、正文、章前来源或资源规格已变化，请保留填写重新核对；本次未创建修正。',409);
  if((await client.query(`SELECT id FROM ${chapterAdoptionSessionRows} chapter_adoption_session_record WHERE chapter_document_id=$1
    AND status IN ('reviewing','adopted_pending_proposals','pending_review','partially_confirmed','settling','failed')`,[basis.chapterDocumentId])).rowCount)
    throw new NewDesignError('本章有待处理清单，请返回本章核对原请求；不能覆盖或替换它。',409);
  const sessionId=randomUUID(),preparationId=randomUUID(),inputHash=stableHash(requestFrame(bookId,input));
  const preparation=basis.original.preparation as Record<string,unknown>,dependency={...(preparation.dependency_snapshot as Record<string,unknown>),
    documentRevision:basis.documentRevision,supplementBaseCheckpointId:basis.checkpointId,supplementSourceHash:preview.sourceHash,
    correctionIssueId:input.issueId,correctionIssueIds:preview.relatedIssues.map(issue=>issue.issue_id),correctionSourceHash:preview.correction.sourceHash};
  const dependencyHash=stableHash(dependency);
  await insertRevisionRecords(client, 'chapter_adoption_preparation', `SELECT ($1)::uuid AS id,($2)::uuid AS book_id,($3)::uuid AS chapter_document_id,($4)::uuid AS body_version_id,($5)::integer AS expected_document_revision,($6)::uuid AS planning_object_id,($7)::uuid AS planning_version_id,($8)::char(64) AS planning_content_hash,($9)::uuid AS context_manifest_id,($10::jsonb)::jsonb AS dependency_snapshot,($11)::char(64) AS dependency_hash,('prepared')::text AS status,($12)::text AS idempotency_key,('')::text AS created_by,(now())::timestamptz AS created_at,($13)::uuid AS supplement_base_checkpoint_id`, [preparationId,bookId,basis.chapterDocumentId,basis.bodyVersionId,basis.documentRevision,
    basis.planningObjectId,basis.planningVersionId,(basis.original.planning_version as Record<string,unknown>).content_hash,basis.contextManifestId,JSON.stringify(dependency),dependencyHash,`resource-correction-preparation:${input.requestKey}`,basis.checkpointId], [["id"],["book_id","idempotency_key"]]);
  await updateRevisionRecords(client, 'chapter_adoption_preparation', `SELECT to_jsonb(record) AS record_values,jsonb_build_object('status',('consumed')::text) AS record_patch FROM ${chapterAdoptionPreparationRows} record WHERE id=$1 FOR UPDATE OF record`, [preparationId], ["id"]);
  await insertRevisionRecords(client, 'chapter_adoption_session', `SELECT ($1)::uuid AS id,($2)::uuid AS book_id,($3)::uuid AS chapter_document_id,($4)::uuid AS body_version_id,($5)::uuid AS preparation_id,(NULL)::uuid AS prior_body_version_id,($6)::uuid AS adoption_id,(NULL)::uuid AS settlement_id,($7)::uuid AS policy_version_id,($8)::uuid AS planning_object_id,($9)::uuid AS planning_version_id,($10)::uuid AS context_manifest_id,($11)::char(64) AS dependency_hash,('resource_supplement')::text AS adoption_kind,('adopted_pending_proposals')::text AS status,(1)::integer AS revision,($12)::text AS idempotency_key,('')::text AS created_by,('')::text AS error_summary,(now())::timestamptz AS created_at,(now())::timestamptz AS updated_at,($13)::uuid AS supplement_base_checkpoint_id`, [sessionId,bookId,basis.chapterDocumentId,basis.bodyVersionId,
    preparationId,basis.adoptionId,basis.policyVersionId,basis.planningObjectId,basis.planningVersionId,basis.contextManifestId,dependencyHash,`resource-correction-session:${input.requestKey}`,basis.checkpointId], [["id"],["preparation_id"],["adoption_id"],["settlement_id"],["book_id","idempotency_key"]]);
  const receipt=resourceSupplementCorrectionStartReceiptSchema.parse({contract:'stable_resource_correction_start_v1',bookId,chapterDocumentId:basis.chapterDocumentId,sessionId,preparationId,
    baseCheckpointId:basis.checkpointId,bodyVersionId:basis.bodyVersionId,issueId:input.issueId,relatedIssueIds:preview.relatedIssues.map(issue=>issue.issue_id),requestKey:input.requestKey,
    input,inputHash,sourceHash:preview.sourceHash,sourceRoute:`/new-design/books/${bookId}/writing?chapterDocument=${basis.chapterDocumentId}&session=${sessionId}&resourceIssue=${input.issueId}`,repeated:false});
  await insertRevisionRecords(client, 'chapter_resource_supplement', `SELECT ($1)::uuid AS session_id,($2)::uuid AS book_id,($3)::uuid AS base_checkpoint_id,($4)::text AS request_key,($5::jsonb)::jsonb AS full_input,($6)::char(64) AS input_hash,($7::jsonb)::jsonb AS source_snapshot,($8)::char(64) AS source_hash,($9::jsonb)::jsonb AS original_receipt,('user')::text AS actor,(now())::timestamptz AS created_at`, [sessionId,bookId,basis.checkpointId,input.requestKey,JSON.stringify(input),inputHash,JSON.stringify(preview),preview.sourceHash,JSON.stringify(receipt)], [["session_id"],["book_id","request_key"]]);
  const {sourceHash,...source}=preview;
  await insertRevisionRecords(client, 'resource_supplement_correction_origin', `SELECT ($1)::uuid AS session_id,($2)::uuid AS book_id,($3)::uuid AS issue_id,($4)::text AS canonical_input,($5)::text AS canonical_source,(now())::timestamptz AS created_at`, [sessionId,bookId,input.issueId,stable(requestFrame(bookId,input)),stable(source)], [["session_id"]]);
  await insertSupplementSettlementEvents(client, `SELECT ($1)::uuid AS id,($2)::uuid AS session_id,('session_started')::text AS event_kind,(NULL)::text AS from_status,('adopted_pending_proposals')::text AS to_status,(NULL)::uuid AS item_id,(NULL)::text AS idempotency_key,('user')::text AS actor,($3::jsonb)::jsonb AS detail,(now())::timestamptz AS created_at,(NULL)::text AS editing_request_key,(NULL)::char(64) AS editing_input_hash,(NULL)::jsonb AS editing_receipt`, [randomUUID(),sessionId,JSON.stringify({kind:'resource_correction',baseCheckpointId:basis.checkpointId,
    bodyVersionId:basis.bodyVersionId,issueId:input.issueId,relatedIssueIds:receipt.relatedIssueIds,sourceHash})]);
  return receipt;
}
/** Original result lookup remains read-only after archive or deactivation. */
export async function readResourceSupplementCorrectionStartOriginalInTransaction(client:PoolClient,bookId:string,raw:ResourceSupplementCorrectionStartInput):Promise<ResourceSupplementCorrectionStartReceipt|null>{
  z.string().uuid().parse(bookId);const input=resourceSupplementCorrectionStartInputSchema.parse(raw);await storage(client,false);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`resource-supplement:${bookId}:${input.requestKey}`]);
  return original(client,bookId,input);
}
/** Saved complete frame, never reconstructed from current publication or state. */
export async function readFrozenResourceSupplementCorrectionInTransaction(client:PoolClient,session:Record<string,unknown>,bodyHash:string):Promise<ResourceSupplementCorrectionPreview>{
  await storage(client,false);
  const row=(await client.query(`SELECT full_input,source_snapshot FROM ${chapterResourceSupplementRows} chapter_resource_supplement_record WHERE session_id=$1 AND book_id=$2`,[session.id,session.book_id])).rows[0];
  const input=resourceSupplementCorrectionStartInputSchema.safeParse(row?.full_input);
  if(!input.success)throw new ResourceSupplementError('原修正的完整输入缺失，请保留原请求核对。',409,'unknown');
  const receipt=await original(client,String(session.book_id),input.data),source=row.source_snapshot as ResourceSupplementCorrectionPreview;
  if(!receipt||receipt.sessionId!==session.id||receipt.preparationId!==session.preparation_id||receipt.chapterDocumentId!==session.chapter_document_id
    ||receipt.bodyVersionId!==session.body_version_id||receipt.baseCheckpointId!==session.supplement_base_checkpoint_id
    ||source.basis.bodyContentHash!==bodyHash||source.basis.planningVersionId!==session.planning_version_id
    ||source.catalog.bodyVersionId!==session.body_version_id||source.catalog.bodyContentHash!==bodyHash)
    throw new ResourceSupplementError('原修正正文、会话或冻结来源不一致，请保留原请求核对。',409,'unknown');
  return source;
}
export async function readResourceSupplementCorrectionStartOriginal(bookId:string,raw:ResourceSupplementCorrectionStartInput):Promise<ResourceSupplementCorrectionStartReceipt|null>{
  z.string().uuid().parse(bookId);const input=resourceSupplementCorrectionStartInputSchema.parse(raw);
  const client=await getNewDesignPool().then(pool=>pool.connect()).catch(()=>{throw new ResourceSupplementError('原修正结果未能读取，请保留完整原请求核对。',503,'unknown');});
  try{await client.query('BEGIN READ ONLY');
    const saved=await readResourceSupplementCorrectionStartOriginalInTransaction(client,bookId,input);await client.query('COMMIT');return saved;
  }catch(error){try{await client.query('ROLLBACK');}catch{/* Keep unknown. */}
    if(error instanceof ResourceSupplementError)throw error;
    throw new ResourceSupplementError(error instanceof NewDesignError?error.message:'原修正结果未确认，请保留原键和完整输入核对。',error instanceof NewDesignError?error.status:503,'unknown');
  }finally{client.release();}
}
/** Independent command over a committed actual conflict. No model, candidate,
 * formal correction or resolution; full original is read before the write gate. */
export async function startResourceSupplementCorrection(bookId:string,raw:ResourceSupplementCorrectionStartInput):Promise<ResourceSupplementCorrectionStartReceipt>{
  z.string().uuid().parse(bookId);const input=resourceSupplementCorrectionStartInputSchema.parse(raw);
  const client=await getNewDesignPool().then(pool=>pool.connect()).catch(()=>{throw new ResourceSupplementError('原修正结果未能读取，请保留原键和完整输入核对。',503,'unknown');});
  const locks=[`resource-supplement:${bookId}:${input.requestKey}`,`chapter_settlement_editing_book:${bookId}`];let readingOriginal=true,committing=false;
  try{
    for(const lock of locks)await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[lock]);
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await storage(client,false);
    const saved=await original(client,bookId,input);readingOriginal=false;if(saved){await client.query('ROLLBACK');return saved;}
    const receipt=await startResourceSupplementCorrectionInTransaction(client,bookId,input);committing=true;await client.query('COMMIT');return receipt;
  }catch(error){let rolledBack=false;try{await client.query('ROLLBACK');rolledBack=true;}catch{/* Keep unknown. */}
    if(error instanceof ResourceSupplementError)throw error;
    const reported=new ResourceSupplementError(error instanceof NewDesignError?error.message:'修正创建结果未确认，请保留原键和完整输入核对。',error instanceof NewDesignError?error.status:503,readingOriginal||committing||!rolledBack?'unknown':'not_written');
    Object.defineProperty(reported,'cause',{value:error});throw reported;
  }finally{let broken=false;for(const lock of [...locks].reverse())try{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]);}catch{broken=true;}client.release(broken);}
}
