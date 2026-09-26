import {insertSettlementRecords,settlementRecordCtes,updateSettlementRecords,lockedSettlementQuery} from '../recordStorage';
import {captureBookHistoryInTransaction} from '../../bookHistory';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {NewDesignError} from '../../../domain/errors';
import {stableHash} from '../../aiContracts';
import {registerResourceSupplementStateSourcesInTransaction} from '../store';
import {inSettlementTransaction} from '../transaction';
import {readResourceSupplementSettlementChangesInTransaction} from '../supplementRead/settlementPreview';

const inputSchema=z.object({requestKey:z.string().uuid(),reviewId:z.string().uuid(),expectedSessionRevision:z.number().int().positive(),expectedImpactHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
type Input=z.infer<typeof inputSchema>;
export interface ResourceSupplementMergedWrite {
  sessionId:string;settlementId:string;checkpointId:string;baseCheckpointId:string;bodyVersionId:string;
  newStateChangeIds:string[];confirmed:{facts:string[];knowledge:string[];states:string[]};reviewId:string;impactHash:string;
}
/** Transaction-owned writer only. It cannot publish a partial merge. Plain 087
 * rejects COMMIT; explicit manual 092 requires the actual downstream journal,
 * projection/source fences, semantic sources and complete original commit receipt.
 * The resource supplement commit owner must close that same physical transaction. */
export async function writeResourceSupplementMergedSettlementInTransaction(client:PoolClient,bookId:string,sessionId:string,raw:Input):Promise<ResourceSupplementMergedWrite>{
  z.string().uuid().parse(bookId);z.string().uuid().parse(sessionId);const input=inputSchema.parse(raw);
  if((await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation!=='serializable')throw new NewDesignError('资源补充合并需要同一完整来源事务。',409);
  return inSettlementTransaction(client,async()=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`chapter_settlement_editing_book:${bookId}`]);
    await lockedSettlementQuery(client,`WITH ${settlementRecordCtes.chapter_adoption_sessions}
SELECT session.id FROM chapter_adoption_sessions session JOIN new_design.chapter_documents document ON document.id=session.chapter_document_id
      WHERE session.id=$1 AND session.book_id=$2`,[sessionId,bookId]);
    const resources=await import('../../resourceSupplements');
    const impact=await resources.previewResourceSupplementSettlementInTransaction(client,bookId,sessionId);
    if(impact.sessionRevision!==input.expectedSessionRevision||impact.impactHash!==input.expectedImpactHash)throw new NewDesignError('原确认候选或下游来源已变化，请重新核对结算影响。',409);
    const review=await resources.readResourceSupplementImpactReviewForSettlementInTransaction(client,bookId,sessionId,input.reviewId,impact);
    const actual=await readResourceSupplementSettlementChangesInTransaction(client,bookId,sessionId),basis=actual.source.basis;
    await lockedSettlementQuery(client,`WITH ${settlementRecordCtes.chapter_stable_checkpoints}
SELECT id FROM chapter_stable_checkpoints WHERE id=$1`,[basis.checkpointId]);
    await client.query('SELECT id FROM new_design.chapter_settlement_items WHERE session_id=$1 ORDER BY id FOR UPDATE',[sessionId]);
    const settlementId=randomUUID(),checkpointId=randomUUID(),newStateChangeIds:string[]=[];
    await updateSettlementRecords(client,"chapter_adoption_session",`WITH ${settlementRecordCtes.chapter_adoption_sessions}
SELECT chapter_adoption_sessions.*,('settling')::text AS status,(revision+1)::integer AS revision,(now())::timestamptz AS updated_at FROM chapter_adoption_sessions WHERE id=$1`,[sessionId]);
    await insertSettlementRecords(client,"chapter_settlement_event",`SELECT ($1)::uuid AS id,($2)::uuid AS session_id,('settlement_started')::text AS event_kind,($3)::text AS from_status,('settling')::text AS to_status,('user')::text AS actor,($4::jsonb)::jsonb AS detail`,[randomUUID(),sessionId,actual.session.status,JSON.stringify({reviewId:review.reviewId,impactHash:impact.impactHash})]);
    await client.query(`INSERT INTO new_design.chapter_settlements(id,book_id,chapter_document_id,body_version_id,status,idempotency_key,actor,note,supplement_base_checkpoint_id)
      VALUES($1,$2,$3,$4,'committed',$5,'user',$6,$7)`,[settlementId,bookId,basis.chapterDocumentId,basis.bodyVersionId,`resource-supplement:${input.requestKey}`,review.input.note,basis.checkpointId]);
    for(const change of actual.changes){
      const proposal=(await lockedSettlementQuery(client,`WITH ${settlementRecordCtes.state_change_proposals}
SELECT * FROM state_change_proposals WHERE id=$1 AND book_id=$2 AND status='proposed'`,[change.proposalId,bookId])).rows[0];
      if(!proposal||proposal.before_known!==true||stableHash(proposal.before_json)!==stableHash(change.beforeValue)||stableHash(proposal.after_json)!==stableHash(change.afterValue))throw new NewDesignError('原资源提案前后值已变化，请保留原确认核对。',409);
      const id=randomUUID();
      await insertSettlementRecords(client,"state_change",`SELECT ($1)::uuid AS id,($2)::uuid AS book_id,($3)::uuid AS settlement_id,($4)::uuid AS proposal_id,($5)::uuid AS chapter_document_id,($6)::uuid AS body_version_id,($7)::uuid AS text_anchor_id,($8)::uuid AS cause_event_card_id,($9)::text AS subject_kind,($10)::uuid AS subject_id,($11)::text AS state_key,($12::jsonb)::jsonb AS before_json,($13::jsonb)::jsonb AS after_json,($14::jsonb)::jsonb AS delta_json,($15)::text AS reason,($16)::numeric AS effective_story_order`,[id,bookId,settlementId,proposal.id,basis.chapterDocumentId,basis.bodyVersionId,
        proposal.text_anchor_id,proposal.cause_event_card_id,proposal.subject_kind,proposal.subject_id,proposal.state_key,JSON.stringify(proposal.before_json),JSON.stringify(proposal.after_json),
        proposal.delta_json===null?null:JSON.stringify(proposal.delta_json),proposal.reason,proposal.effective_story_order]);
      await updateSettlementRecords(client,"state_change_proposal",`WITH ${settlementRecordCtes.state_change_proposals}
SELECT state_change_proposals.*,('confirmed')::text AS status,($2)::uuid AS confirmed_state_change_id,(revision+1)::integer AS revision,(now())::timestamptz AS updated_at FROM state_change_proposals WHERE id=$1`,[proposal.id,id]);
      newStateChangeIds.push(id);
    }
    await updateSettlementRecords(client,"state_change_proposal",`WITH ${settlementRecordCtes.state_change_proposals}
SELECT proposal.*,('rejected')::text AS status,(proposal.revision+1)::integer AS revision,(now())::timestamptz AS updated_at FROM state_change_proposals proposal, new_design.chapter_settlement_items item WHERE item.session_id=$1 AND item.state_proposal_id=proposal.id AND item.decision='reject' AND proposal.status='proposed'`,[sessionId]);
    const confirmed={facts:[...basis.confirmed.facts],knowledge:[...basis.confirmed.knowledge],states:[...basis.confirmed.states,...newStateChangeIds]};
    const summary={...basis.original.checkpoint as Record<string,unknown>};
    const mergedSummary={...summary.summary as Record<string,unknown>,confirmed,
      rejected:[...((summary.summary as Record<string,unknown>).rejected as string[]??[]),...actual.items.filter(item=>item.decision==='reject').map(item=>String(item.id))],
      supplementBaseCheckpointId:basis.checkpointId,supplementReviewId:review.reviewId,supplementImpactHash:impact.impactHash};
    await updateSettlementRecords(client,"chapter_stable_checkpoint",`WITH ${settlementRecordCtes.chapter_stable_checkpoints}
SELECT chapter_stable_checkpoints.*,('superseded')::text AS status FROM chapter_stable_checkpoints WHERE id=$1 AND status='stable'`,[basis.checkpointId]);
    await insertSettlementRecords(client,"chapter_stable_checkpoint",`SELECT ($1)::uuid AS id,($2)::uuid AS book_id,($3)::uuid AS chapter_document_id,($4)::uuid AS body_version_id,($5)::uuid AS session_id,($6)::uuid AS settlement_id,($7)::uuid AS previous_checkpoint_id,($8)::integer AS chapter_order,($9::jsonb)::jsonb AS summary,($10)::char(64) AS dependency_hash`,[checkpointId,bookId,basis.chapterDocumentId,basis.bodyVersionId,sessionId,settlementId,basis.checkpointId,basis.chapterOrder,
      JSON.stringify(mergedSummary),stableHash({sessionId,settlementId,bodyVersionId:basis.bodyVersionId,summary:mergedSummary})]);
    await registerResourceSupplementStateSourcesInTransaction(client,bookId,basis.chapterDocumentId,settlementId,newStateChangeIds);
    // Projections, downstream journals/fences and the full formal original belong
    // to the resource supplement commit command in this same transaction.
    await updateSettlementRecords(client,"chapter_adoption_session",`WITH ${settlementRecordCtes.chapter_adoption_sessions}
SELECT chapter_adoption_sessions.*,($2)::uuid AS settlement_id,('stable')::text AS status,(revision+1)::integer AS revision,('')::text AS error_summary,(now())::timestamptz AS updated_at FROM chapter_adoption_sessions WHERE id=$1`,[sessionId,settlementId]);
    const result:ResourceSupplementMergedWrite={sessionId,settlementId,checkpointId,baseCheckpointId:basis.checkpointId,bodyVersionId:basis.bodyVersionId,newStateChangeIds,confirmed,reviewId:review.reviewId,impactHash:impact.impactHash};
    await insertSettlementRecords(client,"chapter_settlement_event",`SELECT ($1)::uuid AS id,($2)::uuid AS session_id,('settlement_committed')::text AS event_kind,('settling')::text AS from_status,('stable')::text AS to_status,($3)::text AS idempotency_key,('user')::text AS actor,($4::jsonb)::jsonb AS detail`,[randomUUID(),sessionId,`resource-supplement:${input.requestKey}`,JSON.stringify(result)]);
    await captureBookHistoryInTransaction(client,{bookId,requestKey:checkpointId,kind:"auto_milestone",label:`第 ${basis.chapterOrder} 章正式补录后的规划与正文`,sourceId:checkpointId});
    return result;
  });
}
