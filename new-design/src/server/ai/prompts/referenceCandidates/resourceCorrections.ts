import {createHash} from 'node:crypto';
import {z} from 'zod';
import {resourceCorrectionCandidateCatalog,type ResourceSupplementCorrectionPreview} from '../../../../common/resourceSupplements/correction';
import {stableHash} from '../../../database/aiContracts';
import {characterResourceBackfillAsset} from './index';
import type {PromptAsset} from '../contracts';
import type {ChapterSettlementPromptInput} from '../chapterSettlement';

export function buildResourceSupplementCorrectionPromptInput(value:{sessionId:string;sessionRevision:number;source:ResourceSupplementCorrectionPreview}):ChapterSettlementPromptInput{
  const {sessionId,sessionRevision,source}=value,basis=source.basis;
  return {sessionId,bodyVersionId:basis.bodyVersionId,bodyContentHash:basis.bodyContentHash,bodyContent:basis.bodyContent,
    catalog:resourceCorrectionCandidateCatalog(source,sessionId,sessionRevision),expectedChanges:[],resourceScope:source.resourceScope,stableCorrection:{sessionRevision,source}};
}
/** The exception is an actual issue-owned source repair, never a generic no-op
 * or permission to reopen an original stable settlement. */
export const resourceSupplementCorrectionAsset:PromptAsset={
  ...characterResourceBackfillAsset,assetId:'new_design.character.stable_resource_correction',version:'v1',taskType:'stable_resource_correction',label:'核对资源冲突修正候选',
  instruction:characterResourceBackfillAsset.instruction+'本次修正绑定真实issue和唯一冲突字段。stableCorrection.source保留原稳定章末确认、原记录前后值、全部关联冲突及实际有效章前完整证明。catalog.baseline是该冲突字段的实际章前值；不得以原错误前值、章末值或全书最新投影替代。仅从同一原采用正文核对该字段的正确章末值和实际证据，保留原确认供比较，不复制为新候选。来源修正可以是前后值相同，此时delta必须为0；这仅代表修正本字段前值或时间来源，不代表无证据也可提案。不得操作其他字段、资源、关系、事实或认知，不得自行确认、改写正文或解除冲突。证据不足时返回空items并说明待作者核对，不能伪造来源正确。',
  prepare(value){
    const input=z.object({sessionId:z.string().uuid(),bodyVersionId:z.string().uuid(),bodyContentHash:z.string().regex(/^[a-f0-9]{64}$/),bodyContent:z.string(),catalog:z.unknown(),expectedChanges:z.array(z.string()),resourceScope:z.unknown(),
      stableCorrection:z.object({sessionRevision:z.number().int().positive(),source:z.custom<ResourceSupplementCorrectionPreview>(value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value))}).strict()}).strict().parse(value);
    const source=input.stableCorrection.source,basis=source?.basis,correction=source?.correction;
    const fail=():never=>{throw new Error('修正候选缺少完整实际冲突、原确认或章前证明。');};
    if(source.contract!=='stable_resource_correction_preview_v1'||!basis||!correction||!basis.original||!source.catalog||!Array.isArray(source.relatedIssues))return fail();
    const {sourceHash,...frame}=source,{sourceHash:basisHash,...basisFrame}=basis,{sourceHash:correctionHash,...correctionFrame}=correction;
    if(stableHash(frame)!==sourceHash||stableHash(basisFrame)!==basisHash||stableHash(correctionFrame)!==correctionHash
      ||source.bookId!==basis.bookId||correction.bookId!==basis.bookId||correction.baseCheckpointId!==basis.checkpointId
      ||correction.chapterDocumentId!==basis.chapterDocumentId||correction.bodyVersionId!==basis.bodyVersionId||correction.issueId!==source.input.issueId
      ||stableHash(correction.chapterEndBasis)!==stableHash(basis)||createHash('sha256').update(basis.bodyContent,'utf8').digest('hex')!==basis.bodyContentHash)return fail();
    const original=basis.original,confirmedSources=original.confirmedSources as Record<string,Record<string,unknown>[]>|undefined;
    const plan=original.planning_version as Record<string,unknown>|undefined;
    if(!plan||plan.id!==basis.planningVersionId||!plan.content||!confirmedSources)return fail();
    for(const kind of ['facts','knowledge','states'] as const){
      const ids=basis.confirmed?.[kind],rows=confirmedSources[kind];
      if(!Array.isArray(ids)||new Set(ids).size!==ids.length||!Array.isArray(rows)||rows.length!==ids.length
        ||rows.some(row=>!row||!ids.includes(String(row.id)))||new Set(rows.map(row=>row.id)).size!==rows.length)return fail();
    }
    const prefix=correction.prefixSource.change as Record<string,unknown>|undefined,issue=correction.issue;
    if(!prefix||prefix.book_id!==basis.bookId||prefix.subject_kind!==correction.subjectKind||prefix.subject_id!==correction.subjectId||prefix.state_key!==correction.stateKey
      ||stableHash(prefix.after_json)!==stableHash(correction.beforeValue)||issue.issue_id!==correction.issueId||issue.book_id!==basis.bookId
      ||!source.relatedIssues.some(row=>row.issue_id===correction.issueId)||new Set(source.relatedIssues.map(row=>row.issue_id)).size!==source.relatedIssues.length
      ||source.relatedIssues.some(row=>row.book_id!==basis.bookId||row.chapter_document_id!==basis.chapterDocumentId||row.body_version_id!==basis.bodyVersionId
        ||row.subject_kind!==correction.subjectKind||row.subject_id!==correction.subjectId||row.state_key!==correction.stateKey))return fail();
    const canonical=buildResourceSupplementCorrectionPromptInput({sessionId:input.sessionId,sessionRevision:input.stableCorrection.sessionRevision,source});
    if(stableHash(canonical)!==stableHash(input))return fail();
    const field=canonical.catalog.subjects[0]?.fields[0];
    if(!field||!field.baseline.known||field.baseline.stale||field.baseline.sourceId!==prefix.id||stableHash(field.baseline.value)!==stableHash(correction.beforeValue))return fail();
    const {stableCorrection,...base}=canonical,prepared=characterResourceBackfillAsset.prepare(base);
    return {...prepared,input:canonical};
  },
};
