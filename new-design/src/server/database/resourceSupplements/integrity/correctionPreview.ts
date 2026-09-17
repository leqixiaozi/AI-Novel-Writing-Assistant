import type {PoolClient} from 'pg';
import {resourceSupplementCorrectionPreviewInputSchema,type ResourceSupplementCorrectionPreviewInput,type ResourceSupplementCorrectionPreview} from '../../../../common/resourceSupplements/correction';
import {NewDesignError} from '../../../domain/errors';
import {stableHash} from '../../aiContracts';
import {getChapterSettlementEditingCatalogInTransaction,displaySettlementValue} from '../../chapterSettlement';
import {freezeResourceBackfillScope} from '../../characterResources';
import {readHistoricalStateForValidatedBasis} from '../history';
import {readResourceSupplementCorrectionBasisInTransaction} from './correctionBasis';

/** Read-only issue-owned comparison. No session, model, proposal, resolution or
 * change of source status; ordinary v1 stays fenced while this preview is open. */
export async function previewResourceSupplementCorrectionInTransaction(client:PoolClient,bookId:string,raw:ResourceSupplementCorrectionPreviewInput):Promise<ResourceSupplementCorrectionPreview>{
  const input=resourceSupplementCorrectionPreviewInputSchema.parse(raw),correction=await readResourceSupplementCorrectionBasisInTransaction(client,bookId,input.issueId),basis=correction.chapterEndBasis;
  const subjects=[...input.resourceScope.resourceIds.map(id=>({subject_kind:'card',subject_id:id})),...input.resourceScope.relationIds.map(id=>({subject_kind:'relation',subject_id:id}))];
  if(!subjects.some(subject=>subject.subject_kind===correction.subjectKind&&subject.subject_id===correction.subjectId))throw new NewDesignError('所选资源范围不包含本次真实冲突字段，请保留原选择核对。',422);
  const issues=(await client.query(`SELECT to_jsonb(issue) issue FROM new_design.resource_supplement_integrity_issues issue
    JOIN new_design.chapter_documents document ON document.id=issue.chapter_document_id AND document.book_id=issue.book_id
    JOIN jsonb_to_recordset($2::jsonb) scope(subject_kind text,subject_id uuid) ON scope.subject_kind=issue.subject_kind AND scope.subject_id=issue.subject_id
    WHERE issue.book_id=$1 AND document.logical_order<=$3 AND NOT EXISTS(
      SELECT 1 FROM new_design.resource_supplement_integrity_resolutions resolution WHERE resolution.issue_id=issue.issue_id)
    ORDER BY document.logical_order,issue.issue_id LIMIT 5001`,[bookId,JSON.stringify(subjects),basis.chapterOrder])).rows.map(row=>row.issue);
  if(issues.length>5000)throw new NewDesignError('当前修正的关联来源超出单次核对范围，请保留全部原记录分范围核对。',409);
  if(!issues.some(issue=>issue.issue_id===input.issueId)||issues.some(issue=>issue.subject_kind!==correction.subjectKind||issue.subject_id!==correction.subjectId||issue.state_key!==correction.stateKey
    ||issue.chapter_document_id!==correction.chapterDocumentId||issue.body_version_id!==correction.bodyVersionId))throw new NewDesignError('所选范围还有其他实际来源冲突，请先核对对应字段；本次修正不能忽略它们。',409);
  const catalog=await getChapterSettlementEditingCatalogInTransaction(client,basis.original.session as Record<string,unknown>,false),selected=new Set(subjects.map(subject=>`${subject.subject_kind}:${subject.subject_id}`));
  let bound=false;
  for(const subject of catalog.subjects.filter(subject=>selected.has(`${subject.subjectKind}:${subject.id}`)))for(const field of subject.fields){
    if(subject.subjectKind===correction.subjectKind&&subject.id===correction.subjectId&&field.key===correction.stateKey){
      const source=correction.prefixSource.change as Record<string,unknown>;
      field.baseline={known:true,value:correction.beforeValue,display:displaySettlementValue(field.field,correction.beforeValue,field.dictionaryNodes),
        revision:Number(source.sequence),sourceKind:'state_change',sourceId:String(source.id),stale:false,
        hash:stableHash({contract:'resource_supplement_correction_baseline_v1',correctionSourceHash:correction.sourceHash,subjectKind:subject.subjectKind,subjectId:subject.id,stateKey:field.key})};bound=true;
    }else{
      const history=await readHistoricalStateForValidatedBasis(client,basis,{bookId,checkpointId:basis.checkpointId,subjectKind:subject.subjectKind,subjectId:subject.id,stateKey:field.key});
      field.baseline={known:history.known,value:history.value,display:history.known?displaySettlementValue(field.field,history.value,field.dictionaryNodes):'尚未建立前值',
        revision:history.source?Number(history.source.sequence??history.source.version):null,sourceKind:history.sourceKind,sourceId:history.sourceId,stale:false,hash:history.hash};
    }
  }
  if(!bound)throw new NewDesignError('真实冲突字段没有当前正式编辑规格，请保留原来源核对。',409);
  const frozen=await freezeResourceBackfillScope(client,{session:{bookId,bodyVersionId:basis.bodyVersionId},candidate:{content:basis.bodyContent},catalog},input.resourceScope);
  frozen.catalog.specificationHash=stableHash({basisHash:basis.sourceHash,correctionHash:correction.sourceHash,relatedIssues:issues,subjects:frozen.catalog.subjects,objectChoices:frozen.catalog.objectChoices,holderChoices:frozen.catalog.holderChoices});
  const frame:Omit<ResourceSupplementCorrectionPreview,'sourceHash'>={contract:'stable_resource_correction_preview_v1',bookId,input,basis,...frozen,correction,relatedIssues:issues};
  const normalized=JSON.parse(JSON.stringify(frame)) as typeof frame;
  return {...normalized,sourceHash:stableHash(normalized)};
}
