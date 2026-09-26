import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../../domain/errors';
import {findRecordCard,listRecordCards} from '../../recordCards';
import {stableHash} from '../../aiContracts/integrity';
type Row=Record<string,any>;
const fail=()=>{throw new NewDesignError('资源候选提取必须使用保留的完整来源和原修正范围。',409);};
const same=(a:unknown,b:unknown)=>stableHash(a??null)===stableHash(b??null);

/** INSERT-only live fences; saved requests retain their immutable provenance after later edits. */
export async function validateSupplementClaim(db:PoolClient,row:Row){
 const session=assertFound(await findRecordCard(db,String(row.session_id),'chapter_adoption_session'),'结算会话不存在。');
 const origin=(await listRecordCards(db,'chapter_resource_supplement',{where:{session_id:row.session_id,book_id:row.book_id}}))[0];
 if(session.adoption_kind!=='resource_supplement'&&!origin)return;
 if(!origin)fail();
 const source=origin.source_snapshot,plan=row.frozen_plan,input=plan?.input,correction=source?.contract==='stable_resource_correction_preview_v1';
 if(!input||plan.assetVersion!=='v1'||!same(input.resourceScope,source.resourceScope)||!same(input.bodyContent,source.basis?.bodyContent)||!same(input.expectedChanges,[])||session.revision!==row.expected_session_revision||session.book_id!==row.book_id||session.body_version_id!==row.body_version_id)fail();
 let catalog={...source.catalog,sessionId:row.session_id,sessionRevision:row.expected_session_revision};
 if(correction){
  await db.query('SELECT new_design.assert_resource_correction_candidate_source($1::uuid)',[row.session_id]);
  const scope=source.correction;
  catalog={...catalog,subjects:(source.catalog?.subjects??[]).filter((subject:Row)=>subject.subjectKind===scope.subjectKind&&subject.id===scope.subjectId).map((subject:Row)=>({...subject,fields:(subject.fields??[]).filter((field:Row)=>field.key===scope.stateKey)}))};
  if(plan.assetId!=='new_design.character.stable_resource_correction'||!same(input.stableCorrection?.source,source)||input.stableCorrection?.sessionRevision!==row.expected_session_revision||Object.hasOwn(input,'stableSupplement'))fail();
 }else{
  const base=assertFound(await findRecordCard(db,String(session.supplement_base_checkpoint_id),'chapter_stable_checkpoint'),'补录依据不存在。');
  if(plan.assetId!=='new_design.character.stable_resource_supplement'||!same(input.stableSupplement?.source,source)||input.stableSupplement?.sessionRevision!==row.expected_session_revision||base.id!==origin.base_checkpoint_id||base.status!=='stable'||base.book_id!==row.book_id||base.body_version_id!==row.body_version_id)fail();
  const issues=await listRecordCards(db,'resource_supplement_integrity_issue',{where:{book_id:row.book_id}}),resolved=await listRecordCards(db,'resource_supplement_integrity_resolution');
  const unresolved=issues.filter(issue=>!resolved.some(resolution=>resolution.issue_id===issue.issue_id)&&(source.catalog?.subjects??[]).some((subject:Row)=>subject.subjectKind===issue.subject_kind&&subject.id===issue.subject_id));
  if(unresolved.length&&(await db.query('SELECT 1 FROM new_design.chapter_documents WHERE book_id=$1 AND id=ANY($2::uuid[]) AND logical_order<=$3 LIMIT 1',[row.book_id,unresolved.map(issue=>issue.chapter_document_id),source.basis?.chapterOrder])).rowCount)fail();
 }
 if(!same(input.catalog,catalog))fail();
}
