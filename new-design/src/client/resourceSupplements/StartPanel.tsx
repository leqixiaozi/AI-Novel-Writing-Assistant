import {useEffect,useRef,useState} from 'react';
import type {ResourceBackfillChapter,ResourceBackfillScope} from '../../common/characterResources';
import {resourceSupplementStartInputSchema,resourceSupplementStartReceiptSchema,type ResourceSupplementPreview,type ResourceSupplementStartInput,type ResourceSupplementStartReceipt} from '../../common/resourceSupplements';
import {resourceSupplementCorrectionStartInputSchema,resourceSupplementCorrectionStartReceiptSchema,type ResourceSupplementCorrectionPreview,type ResourceSupplementCorrectionStartInput,type ResourceSupplementCorrectionStartReceipt} from '../../common/resourceSupplements/correction';
import {newDesignApi} from '../api';
import {useReferenceCommand} from '../referenceParity/useCommand';
import {sameInput,displayResourceValue} from './requests';
type Command={kind:'normal';input:ResourceSupplementStartInput}|{kind:'correction';input:ResourceSupplementCorrectionStartInput};
type Receipt=ResourceSupplementStartReceipt|ResourceSupplementCorrectionStartReceipt;
export default function ResourceSupplementStartPanel({bookId,scope,chapter,issueId,disabled=false,onLockChange}:{bookId:string;scope:ResourceBackfillScope;chapter?:ResourceBackfillChapter;issueId?:string;disabled?:boolean;onLockChange?:(locked:boolean)=>void}){
 const [preview,setPreview]=useState<ResourceSupplementPreview|ResourceSupplementCorrectionPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false),[receipt,setReceipt]=useState<Receipt|null>(null);
 const epoch=useRef(0),alive=useRef(true),selection=JSON.stringify({scope,document:chapter?.documentId,issueId});
 const command=useReferenceCommand<Command,Receipt>(`nd-resource-start:${bookId}:${issueId??chapter?.documentId??''}`,{
  valid:(value):value is Command=>{
   const saved=value as Command;if(!saved||saved.kind!==(issueId?'correction':'normal')||Object.keys(saved).some(key=>!['kind','input'].includes(key)))return false;
   const input=saved.kind==='correction'?resourceSupplementCorrectionStartInputSchema.safeParse(saved.input):resourceSupplementStartInputSchema.safeParse(saved.input);
   return input.success&&input.data.resourceScope.characterId===scope.characterId&&(saved.kind!=='correction'||saved.input.issueId===issueId);
  },
  write:value=>value.kind==='correction'?newDesignApi.startResourceSupplementCorrection(bookId,value.input):newDesignApi.startResourceSupplement(bookId,value.input),
  read:value=>value.kind==='correction'?newDesignApi.readResourceSupplementCorrectionStartOriginal(bookId,value.input):newDesignApi.readResourceSupplementStartOriginal(bookId,value.input),
  accept:async(result,value)=>{const parsed=value.kind==='correction'?resourceSupplementCorrectionStartReceiptSchema.safeParse(result):resourceSupplementStartReceiptSchema.safeParse(result);
   if(!parsed.success||parsed.data.bookId!==bookId||!sameInput(parsed.data.input,value.input))throw new Error('原清单回执与完整原请求不同，凭证保留。');
   setReceipt(parsed.data);setConfirmed(false);
  },
 });
 useEffect(()=>{alive.current=true;epoch.current++;setBusy(false);setPreview(null);setConfirmed(false);setError('');return()=>{alive.current=false;epoch.current++;};},[selection]);
 useEffect(()=>{onLockChange?.(command.locked||busy);return()=>onLockChange?.(false);},[command.locked,busy,onLockChange]);
 useEffect(()=>{const handler=(event:BeforeUnloadEvent)=>{if(command.locked){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[command.locked]);
 const locked=disabled||busy||command.locked;
 const inspect=async()=>{if(locked)return;const seq=++epoch.current,original=structuredClone(scope);setBusy(true);setPreview(null);setConfirmed(false);setError('');try{
  let next:ResourceSupplementPreview|ResourceSupplementCorrectionPreview;
  if(issueId)next=await newDesignApi.previewResourceSupplementCorrection(bookId,{issueId,resourceScope:original});
  else{if(!chapter)throw new Error('请选择确切的稳定章节。');const basis=await newDesignApi.getResourceSupplementChapterBasis(bookId,chapter.documentId);
   if(basis.bodyVersionId!==chapter.bodyVersionId||basis.bodyContentHash!==chapter.bodyContentHash)throw new Error('采用正文已变化，请保留选择并重新读取原章节。');
   next=await newDesignApi.previewResourceSupplement(bookId,{checkpointId:basis.checkpointId,resourceScope:original});}
  if(next.bookId!==bookId||!sameInput(next.input.resourceScope,original))throw new Error('预览与所选书籍或完整资源范围不同。');
  if(alive.current&&epoch.current===seq)setPreview(next);
 }catch(reason){if(alive.current&&epoch.current===seq)setError(reason instanceof Error?reason.message:'原来源未完成核对。');}finally{if(alive.current&&epoch.current===seq)setBusy(false);}};
 const start=async()=>{if(locked||!confirmed||!preview||!sameInput(preview.input.resourceScope,scope))return;
  if(preview.contract==='stable_resource_correction_preview_v1')await command.perform({kind:'correction',input:resourceSupplementCorrectionStartInputSchema.parse({...preview.input,checkpointId:preview.basis.checkpointId,requestKey:crypto.randomUUID(),expectedSourceHash:preview.sourceHash})});
  else await command.perform({kind:'normal',input:resourceSupplementStartInputSchema.parse({...preview.input,requestKey:crypto.randomUUID(),expectedSourceHash:preview.sourceHash})});
 };
 const correction=preview?.contract==='stable_resource_correction_preview_v1'?preview.correction:null;
 const field=correction&&preview?.catalog.subjects.find(subject=>subject.id===correction.subjectId)?.fields.find(field=>field.key===correction.stateKey);
 return <section className="nd-resource-backfill" aria-label={issueId?'资源冲突来源修正':'稳定章资源补充'}>
  <h4>{issueId?'资源冲突来源修正':'稳定章资源补充'}</h4><p>保留原正文和全部稳定结果，另建清单核对本次资源变化；正式保存需再确认实际影响。</p>
  {error&&<p role="alert">{error}</p>}{command.message&&<p role="status">{command.message}</p>}
  {command.pending&&<><p>完整原请求已保留；核对结果前请勿另建清单。</p><button className="nd-button" disabled={command.busy||busy} onClick={()=>void command.verify()}>只读核对原清单结果</button></>}
  <button className="nd-button" disabled={locked||!scope.resourceIds.length} onClick={()=>void inspect()}>{busy?'正在读取来源…':'预览原正文与资源依据'}</button>
  {preview&&<><details><summary>查看本章正文和原确认依据</summary><pre>{preview.basis.bodyContent}</pre><p>原确认：事实 {preview.basis.confirmed.facts.length} 项、认知 {preview.basis.confirmed.knowledge.length} 项、状态 {preview.basis.confirmed.states.length} 项。</p></details>
   {correction&&<p>原记录：{displayResourceValue(correction.originalRecordedBefore,field??undefined,preview.catalog.objectChoices)} → {displayResourceValue(correction.originalRecordedAfter,field??undefined,preview.catalog.objectChoices)}；实际章前值：{field?.baseline.display}。仅核对此冲突字段，关联冲突 {preview.contract==='stable_resource_correction_preview_v1'?preview.relatedIssues.length:0} 项。</p>}
   <label><input type="checkbox" disabled={locked} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>我已核对本章正文、人物和所选资源范围，保留原确认记录。</label>
   <button className="nd-button nd-button-primary" disabled={locked||!confirmed} onClick={()=>void start()}>创建独立{issueId?'修正':'补充'}清单</button></>}
  {receipt&&<p role="status">独立清单已保存，原稳定结果保留。<a href={receipt.sourceRoute}>打开本章清单，生成候选并人工核对</a></p>}
 </section>;
}
