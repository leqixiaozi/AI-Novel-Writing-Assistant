import {useEffect,useRef,useState} from 'react';
import type {ChapterSettlementEditingWorkspace} from '../../common/chapterSettlementEditing';
import type {ResourceSupplementFrozenSource} from '../../common/resourceSupplements/correction';
import type {ResourceSupplementSettlementImpact} from '../../common/resourceSupplements';
import {resourceSupplementImpactReviewInputSchema,resourceSupplementImpactReviewReceiptSchema,type ResourceSupplementImpactReviewInput,type ResourceSupplementImpactReviewReceipt} from '../../common/resourceSupplements/review';
import {resourceSupplementCommitInputSchema,resourceSupplementCommitReceiptSchema,type ResourceSupplementCommitInput,type ResourceSupplementCommitReceipt} from '../../common/resourceSupplements/commit';
import {resourceSupplementCorrectionCommitReceiptSchema,type ResourceSupplementCorrectionCommitReceipt} from '../../common/resourceSupplements/correctionCommit';
import {newDesignApi} from '../api';
import {useReferenceCommand} from '../referenceParity/useCommand';
import {sameInput,displayResourceValue} from './requests';
type FormalCommand={kind:'normal'|'correction';input:ResourceSupplementCommitInput};
type FormalReceipt=ResourceSupplementCommitReceipt|ResourceSupplementCorrectionCommitReceipt;
export default function ResourceSupplementCommitPanel({workspace,source,disabled,onLockChange,onCommitted}:{workspace:ChapterSettlementEditingWorkspace;source:ResourceSupplementFrozenSource|null;disabled:boolean;onLockChange:(locked:boolean)=>void;onCommitted:()=>Promise<void>}){
 const {bookId,id:sessionId}=workspace.session;
 const [impact,setImpact]=useState<ResourceSupplementSettlementImpact|null>(null),[review,setReview]=useState<ResourceSupplementImpactReviewReceipt|null>(null),[receipt,setReceipt]=useState<FormalReceipt|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false),[selected,setSelected]=useState<string[]>([]),[note,setNote]=useState('');
 const alive=useRef(true),epoch=useRef(0);
 const reviewCommand=useReferenceCommand<ResourceSupplementImpactReviewInput,ResourceSupplementImpactReviewReceipt>(`nd-resource-review:${bookId}:${sessionId}`,{
  valid:(value):value is ResourceSupplementImpactReviewInput=>resourceSupplementImpactReviewInputSchema.safeParse(value).success,
  write:value=>newDesignApi.confirmResourceSupplementImpact(bookId,sessionId,value),read:value=>newDesignApi.readResourceSupplementImpactOriginal(bookId,sessionId,value),
  accept:async(result,input)=>{const parsed=resourceSupplementImpactReviewReceiptSchema.safeParse(result);if(!parsed.success||parsed.data.bookId!==bookId||parsed.data.sessionId!==sessionId||!sameInput(parsed.data.input,input))throw new Error('原影响确认与完整原请求不同，凭证保留。');setReview(parsed.data);setImpact(parsed.data.impact);setConfirmed(false);},
 });
 const formalCommand=useReferenceCommand<FormalCommand,FormalReceipt>(`nd-resource-commit:${bookId}:${sessionId}`,{
  valid:(value):value is FormalCommand=>{const saved=value as FormalCommand;return Boolean(saved)&&['normal','correction'].includes(saved.kind)&&Object.keys(saved).every(key=>['kind','input'].includes(key))&&resourceSupplementCommitInputSchema.safeParse(saved.input).success;},
  write:value=>value.kind==='correction'?newDesignApi.commitResourceSupplementCorrection(bookId,sessionId,value.input):newDesignApi.commitResourceSupplement(bookId,sessionId,value.input),
  read:value=>value.kind==='correction'?newDesignApi.readResourceSupplementCorrectionCommitOriginal(bookId,sessionId,value.input):newDesignApi.readResourceSupplementCommitOriginal(bookId,sessionId,value.input),
  accept:async(result,value)=>{const parsed=value.kind==='correction'?resourceSupplementCorrectionCommitReceiptSchema.safeParse(result):resourceSupplementCommitReceiptSchema.safeParse(result);
   if(!parsed.success||parsed.data.bookId!==bookId||parsed.data.sessionId!==sessionId||!sameInput(parsed.data.input,value.input))throw new Error('原正式结果与完整原请求不同，凭证保留。');
   setReceipt(parsed.data);await onCommitted();
  },
 });
 const pending=reviewCommand.locked||formalCommand.locked,locked=disabled||busy||pending||workspace.session.status==='stable';
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;};},[]);
 useEffect(()=>{onLockChange(busy||pending);return()=>onLockChange(false);},[busy,pending,onLockChange]);
 useEffect(()=>{const handler=(event:BeforeUnloadEvent)=>{if(pending){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[pending]);
 const preview=async()=>{if(locked||!source)return;const seq=++epoch.current;setBusy(true);setError('');try{
  const next=await newDesignApi.previewResourceSupplementImpact(bookId,sessionId);
  if(next.bookId!==bookId||next.sessionId!==sessionId||next.sessionRevision!==workspace.session.revision||next.sourceHash!==source.sourceHash)throw new Error('原清单或来源已变化，请先刷新本章核对清单。');
  if(alive.current&&epoch.current===seq){setImpact(next);setReview(null);setSelected([]);setConfirmed(false);}
 }catch(reason){if(alive.current&&epoch.current===seq)setError(reason instanceof Error?reason.message:'实际影响未完成读取。');}finally{if(alive.current&&epoch.current===seq)setBusy(false);}};
 const conflicts=impact?.stateChain.filter(row=>row.reason!=='compatible')??[];
 const confirm=async()=>{if(locked||!confirmed||!impact||conflicts.some(row=>!selected.includes(row.stateChangeId)))return;
  await reviewCommand.perform(resourceSupplementImpactReviewInputSchema.parse({requestKey:crypto.randomUUID(),expectedSessionRevision:impact.sessionRevision,expectedImpactHash:impact.impactHash,acknowledgedConflictStateChangeIds:selected,note:note.trim()||'作者明确核对本次实际资源来源、变化和全部下游影响'}));
 };
 const commit=async()=>{if(locked||!source||!review||review.sessionRevision!==workspace.session.revision)return;
  await formalCommand.perform({kind:source.contract==='stable_resource_correction_preview_v1'?'correction':'normal',input:resourceSupplementCommitInputSchema.parse({requestKey:crypto.randomUUID(),reviewId:review.reviewId,expectedSessionRevision:review.sessionRevision,expectedImpactHash:review.impact.impactHash})});
 };
 const fieldFor=(kind:string,id:string,key:string)=>source?.catalog.subjects.find(subject=>subject.subjectKind===kind&&subject.id===id)?.fields.find(field=>field.key===key);
 if(workspace.session.status==='stable'&&!pending)return <p role="status">{receipt?`本次正式资源结果已保存，原确认保留；新增 ${receipt.merged.newStateChangeIds.length} 项资源变化${receipt.contract==='resource_supplement_correction_commit_v1'?`，解除 ${receipt.resolutions.length} 项资源冲突`:''}。`:'本章资源正式结果保留，可查看原采用正文与确认记录。'}</p>;
 return <section className="nd-settlement-source" aria-label="资源正式保存与影响核对"><h3>核对资源变化与实际影响</h3>
  <p>原正文和全部确认记录保留。核对新变化与下游来源后明确保存；确认影响本身不会解除资源冲突。</p>
  {error&&<p role="alert">{error}</p>}{reviewCommand.message&&<p role="status">{reviewCommand.message}</p>}{formalCommand.message&&<p role="status">{formalCommand.message}</p>}
  {reviewCommand.pending&&<button type="button" disabled={busy||reviewCommand.busy||formalCommand.busy} onClick={()=>void reviewCommand.verify()}>只读核对原影响确认</button>}
  {formalCommand.pending&&<button type="button" disabled={busy||reviewCommand.busy||formalCommand.busy} onClick={()=>void formalCommand.verify()}>只读核对原正式保存结果</button>}
  <button type="button" disabled={locked||!source||workspace.counts.pending>0||workspace.counts.defer>0} onClick={()=>void preview()}>{busy?'正在读取实际来源…':'预览本次变化与下游影响'}</button>
  {impact&&<><table><thead><tr><th>本次资源变化</th><th>依据前值</th><th>确认后值</th></tr></thead><tbody>{impact.changes.map(change=>{const field=fieldFor(change.subjectKind,change.subjectId,change.stateKey);return <tr key={change.itemId}><td>{workspace.items.find(item=>item.id===change.itemId)?.title??field?.label??'资源变化'}</td><td>{displayResourceValue(change.before,field,source?.catalog.objectChoices)}</td><td>{displayResourceValue(change.after,field,source?.catalog.objectChoices)}</td></tr>;})}</tbody></table>
   <p>完整下游章节 {impact.downstreamSource.chapters.length} 章，状态来源 {impact.stateChain.length} 项，需核对冲突 {conflicts.length} 项。</p>
   {conflicts.map(row=>{const field=fieldFor(row.subjectKind,row.subjectId,row.stateKey);return <label key={row.stateChangeId}><input type="checkbox" disabled={locked} checked={selected.includes(row.stateChangeId)} onChange={event=>{setSelected(values=>event.target.checked?[...values,row.stateChangeId]:values.filter(id=>id!==row.stateChangeId));setConfirmed(false);}}/>第 {row.chapterOrder} 章 · {field?.label??'资源字段'}：此前应为 {displayResourceValue(row.expectedBefore,field,source?.catalog.objectChoices)}，原记录前值 {displayResourceValue(row.recordedBefore,field,source?.catalog.objectChoices)}。{row.reason==='backdated_source'?'变化故事位置也需核对。':''}</label>;})}
   {!review&&<><label>核对说明（可选）<input disabled={locked} value={note} maxLength={4000} onChange={event=>setNote(event.target.value)}/></label><label><input type="checkbox" disabled={locked} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>我已核对本次实际资源变化和全部下游影响。</label><button type="button" disabled={locked||!confirmed||conflicts.some(row=>!selected.includes(row.stateChangeId))} onClick={()=>void confirm()}>保存本次影响确认</button></>}
  </>}
  {review&&<><p>本次完整影响确认已保存，正式保存将重新核对实际来源。</p><button className="nd-button nd-button-primary" disabled={locked||!source||review.sessionRevision!==workspace.session.revision} onClick={()=>void commit()}>正式保存{source?.contract==='stable_resource_correction_preview_v1'?'资源修正':'资源补充结果'}</button></>}
  {receipt&&<p role="status">正式结果已保存；原确认保留，新增状态 {receipt.merged.newStateChangeIds.length} 项，{receipt.contract==='resource_supplement_correction_commit_v1'?`解除资源冲突 ${receipt.resolutions.length} 项，`:' '}下游需核对 {receipt.issues.length} 项。<a href={receipt.sourceRoute}>查看本章原保存结果</a></p>}
 </section>;
}
