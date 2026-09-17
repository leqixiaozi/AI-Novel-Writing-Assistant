import type {PoolClient} from 'pg';
import type {ResourceSupplementFrozenSource} from '../../../../common/resourceSupplements/correction';
import type {SettlementEditingDraft} from '../../../../common/chapterSettlementEditing';
import {NewDesignError} from '../../../domain/errors';
import {stableHash} from '../../aiContracts';
import {readEditingCatalog} from '../editingCatalog';
import {frozenItemContract,readDomain} from '../editingRepository';
import {validateEditingDraft} from '../editingPolicy';
import {assertResourceSupplementCandidateContract} from './candidates';
import {readFrozenSupplementSource} from './index';

export interface ValidatedResourceSupplementChange extends SettlementEditingDraft {
  subjectKind:'card'|'relation';subjectId:string;stateKey:string;
  itemId:string;itemRevision:number;proposalId:string;domainHash:string;effectiveStoryOrder:number|null;
}
export async function readResourceSupplementSettlementChangesInTransaction(client:PoolClient,bookId:string,sessionId:string):Promise<{
  session:Record<string,unknown>;source:ResourceSupplementFrozenSource;changes:ValidatedResourceSupplementChange[];items:Record<string,unknown>[];
}>{
  const session=(await client.query(`SELECT session.*,body.content_hash AS body_hash FROM new_design.chapter_adoption_sessions session
    JOIN new_design.books book ON book.id=session.book_id AND book.status='active'
    JOIN new_design.chapter_documents document ON document.id=session.chapter_document_id AND document.book_id=book.id
      AND document.status='active' AND document.adopted_version_id=session.body_version_id
    JOIN new_design.chapter_body_versions body ON body.id=session.body_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
    WHERE session.id=$1 AND session.book_id=$2`,[sessionId,bookId])).rows[0];
  if(!session||session.adoption_kind!=='resource_supplement'||!['pending_review','partially_confirmed','adopted_pending_proposals','failed'].includes(session.status))throw new NewDesignError('请选择本书待核对的资源补充清单。',409);
  await assertResourceSupplementCandidateContract(client,session,'preview',false);
  const source=await readFrozenSupplementSource(client,session,String(session.body_hash));
  if(source.contract==='stable_resource_correction_preview_v1'&&!(await client.query(`SELECT id FROM new_design.schema_migrations
    WHERE id='094_resource_supplement_correction_commits' AND position('resource_supplement_correction_commit_v1' IN coalesce(
      pg_get_functiondef(to_regprocedure('new_design.reject_unavailable_resource_integrity_resolution()')),''))>0`)).rowCount)
    throw new NewDesignError('修正清单的正式来源证明解除尚不可用，请保留原确认和来源核对。',503);
  const catalog=await readEditingCatalog(client,session,false);
  const items=(await client.query('SELECT * FROM new_design.chapter_settlement_items WHERE session_id=$1 ORDER BY id',[sessionId])).rows;
  if(items.some(item=>item.decision!=='confirm'&&item.decision!=='reject'))throw new NewDesignError('请先处理所有补充候选，再核对结算影响。',422);
  const changes:ValidatedResourceSupplementChange[]=[],seen=new Set<string>();
  for(const item of items.filter(item=>item.decision==='confirm')){
    if(!item.state_proposal_id||item.canonical_fact_id||item.knowledge_proposal_id)throw new NewDesignError('补充清单只能纳入原范围内的资源状态提案。',409);
    const frozen=await frozenItemContract(client,sessionId,String(item.id)),domain=await readDomain(client,session,item,false);
    if(!frozen||domain.status!=='proposed'||domain.hash!==frozen.domainHash)throw new NewDesignError('原补充提案已变化或缺少完整领域来源，请核对原记录。',409);
    const validated=await validateEditingDraft(client,session,frozen.draft,catalog.subjects),state=domain.data.state as Record<string,unknown>;
    const identity=`${validated.subject.subjectKind}:${validated.subject.id}:${validated.field.key}`;
    if(seen.has(identity)||state.before_known!==true||stableHash(state.before_json)!==stableHash(validated.draft.beforeValue)||stableHash(state.after_json)!==stableHash(validated.draft.afterValue))throw new NewDesignError('补充字段存在重复变化或前后值来源不一致。',409);
    seen.add(identity);
    const effective=state.effective_story_order===null?null:Number(state.effective_story_order);
    if(effective!==null&&effective!==source.basis.chapterOrder)throw new NewDesignError('稳定章资源补充不能将变化移动到其他故事位置，请核对原提案。',409);
    changes.push({...validated.draft,subjectKind:validated.subject.subjectKind,subjectId:validated.subject.id,stateKey:validated.field.key,itemId:String(item.id),itemRevision:Number(item.revision),proposalId:String(item.state_proposal_id),domainHash:domain.hash,effectiveStoryOrder:effective});
  }
  if(source.contract==='stable_resource_correction_preview_v1'&&changes.length!==1)
    throw new NewDesignError('请明确确认该冲突字段的一项真实修正，再核对正式影响。',422);
  return {session,source,changes,items};
}
