import type {ResourceBackfillSeriesInput,ResourceBackfillSeriesPart,ResourceBackfillAiCommand} from '../../../common/characterResources/backfillSeries';
import {resourceBackfillSeriesInputSchema} from '../../../common/characterResources/backfillSeries';
import type {ResourceSupplementApi} from '../../../common/resourceSupplements/api';
import type {CharacterResourceLedger,ResourceBackfillScope,ResourceLedgerSelection} from '../../../common/characterResources';
import type {ChapterSettlementEditingWorkspace} from '../../../common/chapterSettlementEditing';
import {resourceSupplementStartInputSchema} from '../../../common/resourceSupplements';
type SourceApi=Pick<ResourceSupplementApi,'getResourceSupplementChapterBasis'|'previewResourceSupplement'|'getResourceSupplementSource'>&{getCharacterResources:(book:string,actor:string,selection?:ResourceLedgerSelection)=>Promise<CharacterResourceLedger>;getChapterSettlementEditingWorkspace:(session:string)=>Promise<ChapterSettlementEditingWorkspace>};
const same=(a:unknown,b:unknown):boolean=>{if(a===b)return true;if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;const av=a as Record<string,unknown>,bv=b as Record<string,unknown>,keys=Object.keys(av);return keys.length===Object.keys(bv).length&&keys.every(key=>Object.hasOwn(bv,key)&&same(av[key],bv[key]));};
export {same as sameResourceBackfillInput};
function mapping(scope:ResourceBackfillScope):ResourceLedgerSelection{return{relationTypeId:scope.relationTypeId,holdingDimensionKey:scope.holdingDimensionKey,specificationHash:scope.specificationHash};}
function assertWorkspace(workspace:ChapterSettlementEditingWorkspace,book:string,part:ResourceBackfillSeriesPart){
 if(workspace.session.bookId!==book||workspace.session.chapterDocumentId!==part.chapter.documentId||workspace.session.bodyVersionId!==part.chapter.bodyVersionId||workspace.catalog.bodyContentHash!==part.chapter.bodyContentHash||workspace.blockedReason&&workspace.session.adoptionKind!=='resource_supplement'||workspace.session.status==='stable'||workspace.session.status==='cancelled')throw new Error('本章采用正文或清单不可继续，请保留原范围并返回原章节核对。');
}
/** Complete read preflight before the first independent creation or model call. */
export async function prepareResourceBackfillSeries(api:SourceApi,book:string,value:ResourceBackfillSeriesInput,uuid:()=>string):Promise<ResourceBackfillSeriesPart[]>{
 const input=resourceBackfillSeriesInputSchema.parse(value),scope=input.resourceScope,ledger=await api.getCharacterResources(book,scope.characterId,mapping(scope));
 const items=ledger.items.filter(item=>scope.relationIds.includes(item.relationId)&&scope.resourceIds.includes(item.resourceId));
 if(ledger.bookId!==book||ledger.characterId!==scope.characterId||ledger.characterVersionId!==scope.characterVersionId||ledger.characterRevision!==scope.characterRevision||ledger.truncated||!same(ledger.selection,mapping(scope))||items.length!==scope.relationIds.length||new Set(items.map(item=>item.resourceId)).size!==scope.resourceIds.length||items.some(item=>!item.available))throw new Error('人物或完整资源范围已变化，未发送本次批量请求。');
 const chapters=input.documentIds.map(id=>ledger.recentChapters.find(chapter=>chapter.documentId===id));
 if(chapters.some(chapter=>!chapter))throw new Error('所选章节不在本书最近五章的确切采用正文中，未自动替换范围。');
 const ordered=chapters.map(chapter=>chapter!).sort((a,b)=>a.logicalOrder-b.logicalOrder||a.documentId.localeCompare(b.documentId)),parts:ResourceBackfillSeriesPart[]=[];
 for(const chapter of ordered){
  const part:ResourceBackfillSeriesPart={chapter:{documentId:chapter.documentId,chapterCardId:chapter.chapterCardId,bodyVersionId:chapter.bodyVersionId,bodyContentHash:chapter.bodyContentHash,title:chapter.title,logicalOrder:chapter.logicalOrder},kind:chapter.sessionStatus==='stable'?'stable':'editable',aiRequestKey:uuid(),startInput:null,startReceipt:null,ai:null,receipt:null};
  if(part.kind==='stable'){
   const basis=await api.getResourceSupplementChapterBasis(book,chapter.documentId);
   if(basis.bookId!==book||basis.chapterDocumentId!==chapter.documentId||basis.chapterCardId!==chapter.chapterCardId||basis.bodyVersionId!==chapter.bodyVersionId||basis.bodyContentHash!==chapter.bodyContentHash)throw new Error('稳定章原正文已变化，未发送本次批量请求。');
   const preview=await api.previewResourceSupplement(book,{checkpointId:basis.checkpointId,resourceScope:scope});
   if(preview.contract!=='stable_resource_supplement_preview_v1'||preview.bookId!==book||preview.basis.chapterDocumentId!==chapter.documentId||preview.basis.bodyVersionId!==chapter.bodyVersionId||preview.basis.bodyContentHash!==chapter.bodyContentHash||!same(preview.input,{checkpointId:basis.checkpointId,resourceScope:scope}))throw new Error('稳定章完整预览与原范围不同，未发送本次批量请求。');
   part.startInput=resourceSupplementStartInputSchema.parse({...preview.input,requestKey:uuid(),expectedSourceHash:preview.sourceHash});
  }else{
   if(chapter.unavailableReason||!chapter.sessionId)throw new Error(`${chapter.title}：${chapter.unavailableReason??'尚无可编辑的原清单。'}未发送本次批量请求。`);
   const workspace=await api.getChapterSettlementEditingWorkspace(chapter.sessionId);assertWorkspace(workspace,book,part);
   if(workspace.session.id!==chapter.sessionId||workspace.session.revision!==chapter.sessionRevision)throw new Error('原清单修订已变化，未发送本次批量请求。');
   // An existing independent supplement carries its own immutable scope.
   if(workspace.session.adoptionKind==='resource_supplement'){
    const source=await api.getResourceSupplementSource(book,chapter.sessionId);
    if(source.contract!=='stable_resource_supplement_preview_v1'||!same(source.input.resourceScope,scope)||source.basis.chapterDocumentId!==chapter.documentId||source.basis.bodyVersionId!==chapter.bodyVersionId)throw new Error('已有独立清单的完整范围不同或属于冲突修正，请回原章节核对。');
   }
   part.ai={sessionId:chapter.sessionId,input:{requestKey:part.aiRequestKey,expectedSessionRevision:workspace.session.revision,catalogHash:workspace.catalog.specificationHash,resourceScope:structuredClone(scope)}};
  }
  parts.push(part);
 }
 return parts;
}
/** Recheck each source immediately before sending, never substitute a new body. */
export async function prepareResourceBackfillAi(api:SourceApi,book:string,part:ResourceBackfillSeriesPart,scope:ResourceBackfillScope):Promise<ResourceBackfillAiCommand>{
 const session=part.startReceipt?.sessionId??part.ai?.sessionId;if(!session)throw new Error('独立清单原结果尚未核对。');
 const workspace=await api.getChapterSettlementEditingWorkspace(session);assertWorkspace(workspace,book,part);
 if(workspace.session.id!==session)throw new Error('当前清单与完整原请求不同。');
 if(part.kind==='stable'){
  const source=await api.getResourceSupplementSource(book,session);
  if(source.contract!=='stable_resource_supplement_preview_v1'||source.sourceHash!==part.startReceipt?.sourceHash||!same(source.input.resourceScope,scope)||source.basis.chapterDocumentId!==part.chapter.documentId||source.basis.bodyVersionId!==part.chapter.bodyVersionId||source.basis.bodyContentHash!==part.chapter.bodyContentHash)throw new Error('独立清单原来源未完整匹配，请回原章节核对。');
 }
 if(part.ai){if(part.ai.input.expectedSessionRevision!==workspace.session.revision||part.ai.input.catalogHash!==workspace.catalog.specificationHash||!same(part.ai.input.resourceScope,scope))throw new Error('本章来源或原核对修订已变化，已保存候选保留，未发送后续请求。');return part.ai;}
 return{sessionId:session,input:{requestKey:part.aiRequestKey,expectedSessionRevision:workspace.session.revision,catalogHash:workspace.catalog.specificationHash,resourceScope:structuredClone(scope)}};
}
