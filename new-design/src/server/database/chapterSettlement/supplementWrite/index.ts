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
    await client.query(`SELECT session.id FROM new_design.chapter_adoption_sessions session JOIN new_design.chapter_documents document ON document.id=session.chapter_document_id
      WHERE session.id=$1 AND session.book_id=$2 FOR UPDATE OF session,document`,[sessionId,bookId]);
    const resources=await import('../../resourceSupplements');
    const impact=await resources.previewResourceSupplementSettlementInTransaction(client,bookId,sessionId);
    if(impact.sessionRevision!==input.expectedSessionRevision||impact.impactHash!==input.expectedImpactHash)throw new NewDesignError('原确认候选或下游来源已变化，请重新核对结算影响。',409);
    const review=await resources.readResourceSupplementImpactReviewForSettlementInTransaction(client,bookId,sessionId,input.reviewId,impact);
    const actual=await readResourceSupplementSettlementChangesInTransaction(client,bookId,sessionId),basis=actual.source.basis;
    await client.query('SELECT id FROM new_design.chapter_stable_checkpoints WHERE id=$1 FOR UPDATE',[basis.checkpointId]);
    await client.query('SELECT id FROM new_design.chapter_settlement_items WHERE session_id=$1 ORDER BY id FOR UPDATE',[sessionId]);
    const settlementId=randomUUID(),checkpointId=randomUUID(),newStateChangeIds:string[]=[];
    await client.query("UPDATE new_design.chapter_adoption_sessions SET status='settling',revision=revision+1,updated_at=now() WHERE id=$1",[sessionId]);
    await client.query(`INSERT INTO new_design.chapter_settlement_events(id,session_id,event_kind,from_status,to_status,actor,detail)
      VALUES($1,$2,'settlement_started',$3,'settling','user',$4::jsonb)`,[randomUUID(),sessionId,actual.session.status,JSON.stringify({reviewId:review.reviewId,impactHash:impact.impactHash})]);
    await client.query(`INSERT INTO new_design.chapter_settlements(id,book_id,chapter_document_id,body_version_id,status,idempotency_key,actor,note,supplement_base_checkpoint_id)
      VALUES($1,$2,$3,$4,'committed',$5,'user',$6,$7)`,[settlementId,bookId,basis.chapterDocumentId,basis.bodyVersionId,`resource-supplement:${input.requestKey}`,review.input.note,basis.checkpointId]);
    for(const change of actual.changes){
      const proposal=(await client.query("SELECT * FROM new_design.state_change_proposals WHERE id=$1 AND book_id=$2 AND status='proposed' FOR UPDATE",[change.proposalId,bookId])).rows[0];
      if(!proposal||proposal.before_known!==true||stableHash(proposal.before_json)!==stableHash(change.beforeValue)||stableHash(proposal.after_json)!==stableHash(change.afterValue))throw new NewDesignError('原资源提案前后值已变化，请保留原确认核对。',409);
      const id=randomUUID();
      await client.query(`INSERT INTO new_design.state_changes(id,book_id,settlement_id,proposal_id,chapter_document_id,body_version_id,text_anchor_id,cause_event_card_id,
        subject_kind,subject_id,state_key,before_json,after_json,delta_json,reason,effective_story_order)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16)`,[id,bookId,settlementId,proposal.id,basis.chapterDocumentId,basis.bodyVersionId,
        proposal.text_anchor_id,proposal.cause_event_card_id,proposal.subject_kind,proposal.subject_id,proposal.state_key,JSON.stringify(proposal.before_json),JSON.stringify(proposal.after_json),
        proposal.delta_json===null?null:JSON.stringify(proposal.delta_json),proposal.reason,proposal.effective_story_order]);
      await client.query("UPDATE new_design.state_change_proposals SET status='confirmed',confirmed_state_change_id=$2,revision=revision+1,updated_at=now() WHERE id=$1",[proposal.id,id]);
      newStateChangeIds.push(id);
    }
    await client.query(`UPDATE new_design.state_change_proposals proposal SET status='rejected',revision=proposal.revision+1,updated_at=now()
      FROM new_design.chapter_settlement_items item WHERE item.session_id=$1 AND item.state_proposal_id=proposal.id AND item.decision='reject' AND proposal.status='proposed'`,[sessionId]);
    const confirmed={facts:[...basis.confirmed.facts],knowledge:[...basis.confirmed.knowledge],states:[...basis.confirmed.states,...newStateChangeIds]};
    const summary={...basis.original.checkpoint as Record<string,unknown>};
    const mergedSummary={...summary.summary as Record<string,unknown>,confirmed,
      rejected:[...((summary.summary as Record<string,unknown>).rejected as string[]??[]),...actual.items.filter(item=>item.decision==='reject').map(item=>String(item.id))],
      supplementBaseCheckpointId:basis.checkpointId,supplementReviewId:review.reviewId,supplementImpactHash:impact.impactHash};
    await client.query("UPDATE new_design.chapter_stable_checkpoints SET status='superseded' WHERE id=$1 AND status='stable'",[basis.checkpointId]);
    await client.query(`INSERT INTO new_design.chapter_stable_checkpoints(id,book_id,chapter_document_id,body_version_id,session_id,settlement_id,previous_checkpoint_id,chapter_order,summary,dependency_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,[checkpointId,bookId,basis.chapterDocumentId,basis.bodyVersionId,sessionId,settlementId,basis.checkpointId,basis.chapterOrder,
      JSON.stringify(mergedSummary),stableHash({sessionId,settlementId,bodyVersionId:basis.bodyVersionId,summary:mergedSummary})]);
    await registerResourceSupplementStateSourcesInTransaction(client,bookId,basis.chapterDocumentId,settlementId,newStateChangeIds);
    // Projections, downstream journals/fences and the full formal original belong
    // to the resource supplement commit command in this same transaction.
    await client.query("UPDATE new_design.chapter_adoption_sessions SET settlement_id=$2,status='stable',revision=revision+1,error_summary='',updated_at=now() WHERE id=$1",[sessionId,settlementId]);
    const result:ResourceSupplementMergedWrite={sessionId,settlementId,checkpointId,baseCheckpointId:basis.checkpointId,bodyVersionId:basis.bodyVersionId,newStateChangeIds,confirmed,reviewId:review.reviewId,impactHash:impact.impactHash};
    await client.query(`INSERT INTO new_design.chapter_settlement_events(id,session_id,event_kind,from_status,to_status,idempotency_key,actor,detail)
      VALUES($1,$2,'settlement_committed','settling','stable',$3,'user',$4::jsonb)`,[randomUUID(),sessionId,`resource-supplement:${input.requestKey}`,JSON.stringify(result)]);
    return result;
  });
}
