import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {ResourceSupplementSettlementImpact,ResourceSupplementStateChainImpact} from '../../../../common/resourceSupplements';
import {NewDesignError} from '../../../domain/errors';
import {stableHash} from '../../aiContracts';
import {getNewDesignPool} from '../../runtime';
import {readResourceSupplementSettlementChangesInTransaction} from '../../chapterSettlement';

type Row=Record<string,any>;
const identity=(kind:string,id:string,key:string)=>JSON.stringify([kind,id,key]);
/** Actual source chain preview. No checkpoint, projection, flag or AI mutation. */
export async function previewResourceSupplementSettlementInTransaction(client:PoolClient,bookId:string,sessionId:string):Promise<ResourceSupplementSettlementImpact>{
  z.string().uuid().parse(bookId);z.string().uuid().parse(sessionId);
  const input=await readResourceSupplementSettlementChangesInTransaction(client,bookId,sessionId),basis=input.source.basis;
  const chapters=(await client.query(`SELECT to_jsonb(document) document,to_jsonb(body) body,
    to_jsonb(object) planning_object,to_jsonb(plan) adopted_plan,to_jsonb(body_plan) body_plan,to_jsonb(checkpoint) checkpoint
    FROM new_design.chapter_documents document
    LEFT JOIN new_design.chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
    LEFT JOIN new_design.planning_objects object ON object.book_id=document.book_id AND object.card_id=document.chapter_card_id AND object.level='chapter' AND object.status='active'
    LEFT JOIN new_design.planning_versions plan ON plan.id=object.adopted_version_id AND plan.object_id=object.id
    LEFT JOIN new_design.planning_versions body_plan ON body_plan.id=body.planning_version_id AND body_plan.book_id=document.book_id
    LEFT JOIN new_design.chapter_stable_checkpoints checkpoint ON checkpoint.chapter_document_id=document.id AND checkpoint.book_id=document.book_id AND checkpoint.body_version_id=body.id AND checkpoint.status='stable'
    WHERE document.book_id=$1 AND document.status='active' AND document.logical_order>$2
    ORDER BY document.logical_order,document.id LIMIT 1001`,[bookId,basis.chapterOrder])).rows as Row[];
  if(chapters.length>1000||new Set(chapters.map(row=>row.document.id)).size!==chapters.length)throw new NewDesignError('下游章节范围超过单次核对范围或存在重复来源，请保留当前补充清单。',409);
  if(chapters.some(row=>row.document.adopted_version_id&&!row.body||row.body?.planning_version_id&&!row.body_plan||row.planning_object?.adopted_version_id&&!row.adopted_plan))throw new NewDesignError('后续采用正文或计划缺少实际来源，不能按空影响继续。',409);
  const keys=input.changes.map(change=>({subject_kind:change.subjectKind,subject_id:change.subjectId,state_key:change.stateKey}));
  const states=(await client.query(`SELECT to_jsonb(change) change,to_jsonb(proposal) proposal,to_jsonb(settlement) settlement,
    to_jsonb(anchor) anchor,to_jsonb(checkpoint) checkpoint,to_jsonb(checkpoint_commit) checkpoint_commit,to_jsonb(checkpoint_session) checkpoint_session,document.logical_order chapter_order
    FROM new_design.state_changes change
    JOIN new_design.chapter_documents document ON document.id=change.chapter_document_id AND document.book_id=change.book_id AND document.status='active' AND document.adopted_version_id=change.body_version_id
    JOIN jsonb_to_recordset($3::jsonb) scope(subject_kind text,subject_id uuid,state_key text)
      ON scope.subject_kind=change.subject_kind AND scope.subject_id=change.subject_id AND scope.state_key=change.state_key
    LEFT JOIN new_design.chapter_settlements settlement ON settlement.id=change.settlement_id
    LEFT JOIN new_design.state_change_proposals proposal ON proposal.id=change.proposal_id
    LEFT JOIN new_design.chapter_text_anchors anchor ON anchor.id=change.text_anchor_id
    LEFT JOIN new_design.chapter_stable_checkpoints checkpoint ON checkpoint.chapter_document_id=document.id AND checkpoint.book_id=change.book_id AND checkpoint.body_version_id=change.body_version_id AND checkpoint.status='stable'
    LEFT JOIN new_design.chapter_settlements checkpoint_commit ON checkpoint_commit.id=checkpoint.settlement_id AND checkpoint_commit.book_id=change.book_id AND checkpoint_commit.chapter_document_id=document.id AND checkpoint_commit.body_version_id=change.body_version_id
    LEFT JOIN new_design.chapter_adoption_sessions checkpoint_session ON checkpoint_session.id=checkpoint.session_id AND checkpoint_session.book_id=change.book_id AND checkpoint_session.chapter_document_id=document.id AND checkpoint_session.body_version_id=change.body_version_id AND checkpoint_session.settlement_id=checkpoint.settlement_id
    WHERE change.book_id=$1 AND change.status='active' AND document.logical_order>$2
    ORDER BY document.logical_order,change.sequence LIMIT 5001`,[bookId,basis.chapterOrder,JSON.stringify(keys)])).rows as Row[];
  if(states.length>5000)throw new NewDesignError('下游状态来源超过单次核对范围，请保留原记录分段核对。',409);
  for(const row of states){
    const change=row.change,proposal=row.proposal,settlement=row.settlement,checkpoint=row.checkpoint,anchor=row.anchor;
    if(!proposal||proposal.status!=='confirmed'||proposal.confirmed_state_change_id!==change.id||proposal.before_known!==true
      ||proposal.book_id!==bookId||proposal.chapter_document_id!==change.chapter_document_id||proposal.body_version_id!==change.body_version_id
      ||proposal.subject_kind!==change.subject_kind||proposal.subject_id!==change.subject_id||proposal.state_key!==change.state_key
      ||stableHash(proposal.before_json)!==stableHash(change.before_json)||stableHash(proposal.after_json)!==stableHash(change.after_json)
      ||!settlement||settlement.status!=='committed'||settlement.book_id!==bookId||settlement.chapter_document_id!==change.chapter_document_id||settlement.body_version_id!==change.body_version_id
      ||!checkpoint||!Array.isArray(checkpoint.summary?.confirmed?.states)||!checkpoint.summary.confirmed.states.includes(change.id)
      ||row.checkpoint_commit?.status!=='committed'||row.checkpoint_session?.status!=='stable'
      ||change.text_anchor_id!==null&&(!anchor||anchor.status!=='active'||anchor.book_id!==bookId||anchor.chapter_document_id!==change.chapter_document_id||anchor.body_version_id!==change.body_version_id))
      throw new NewDesignError('后续章节资源状态缺少实际稳定确认来源，不能用空影响清单继续结算。',409);
  }
  // Retain every original row. The last confirmed record for a field within a
  // chapter is authoritative when a later corrective supplement keeps history.
  const authoritative=new Map<string,Row>();
  for(const row of states)authoritative.set(identity(row.change.subject_kind,row.change.subject_id,`${row.change.state_key}:${row.change.chapter_document_id}`),row);
  const values=new Map(input.changes.map(change=>[identity(change.subjectKind,change.subjectId,change.stateKey),change.afterValue]));
  const stateChain:ResourceSupplementStateChainImpact[]=[];
  for(const row of authoritative.values()){
    const change=row.change,key=identity(change.subject_kind,change.subject_id,change.state_key),before=values.get(key);
    const effective=change.effective_story_order===null?null:Number(change.effective_story_order);
    stateChain.push({chapterDocumentId:change.chapter_document_id,bodyVersionId:change.body_version_id,chapterOrder:Number(row.chapter_order),stateChangeId:change.id,
      subjectKind:change.subject_kind,subjectId:change.subject_id,stateKey:change.state_key,expectedBefore:before,recordedBefore:change.before_json,recordedAfter:change.after_json,
      effectiveStoryOrder:effective,reason:effective!==null&&effective<=basis.chapterOrder?'backdated_source':stableHash(before)===stableHash(change.before_json)?'compatible':'before_conflict'});
    values.set(key,change.after_json);
  }
  const planIds=[...new Set(chapters.flatMap(row=>[row.adopted_plan?.id,row.body?.planning_version_id]).filter(Boolean))];
  const planningReferences=(await client.query('SELECT reference.*,to_jsonb(version) source_version FROM new_design.planning_version_references reference LEFT JOIN new_design.card_versions version ON version.id=reference.card_version_id AND version.card_id=reference.card_id WHERE reference.book_id=$1 AND reference.planning_version_id=ANY($2::uuid[]) ORDER BY reference.id',[bookId,planIds])).rows;
  if(planningReferences.some(row=>!row.source_version))throw new NewDesignError('后续计划引用缺少确切资料版本，请核对原来源。',409);
  const frame:Omit<ResourceSupplementSettlementImpact,'impactHash'>={contract:'resource_supplement_settlement_impact_v1',bookId,sessionId,sessionRevision:Number(input.session.revision),baseCheckpointId:basis.checkpointId,bodyVersionId:basis.bodyVersionId,sourceHash:input.source.sourceHash,
    changes:input.changes.map(change=>({itemId:change.itemId,proposalId:change.proposalId,subjectKind:change.subjectKind,subjectId:change.subjectId,stateKey:change.stateKey,before:change.beforeValue,after:change.afterValue})),stateChain,
    downstreamSource:{chapters,states,planningReferences},inputSnapshot:JSON.parse(JSON.stringify(input))};
  const normalized=JSON.parse(JSON.stringify(frame)) as Omit<ResourceSupplementSettlementImpact,'impactHash'>;
  return {...normalized,impactHash:stableHash(normalized)};
}
export async function previewResourceSupplementSettlement(bookId:string,sessionId:string):Promise<ResourceSupplementSettlementImpact>{
  const client=await(await getNewDesignPool()).connect();
  try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await previewResourceSupplementSettlementInTransaction(client,bookId,sessionId);await client.query('COMMIT');return result;}
  catch(error){try{await client.query('ROLLBACK');}catch{/* Read-only. */}throw error;}finally{client.release();}
}
