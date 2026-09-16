import {useEffect,useRef,useState} from "react";
import type {CardGroupFormSummary,TemplateGroupSummary} from "../../common/contracts";
import type {StructureWriteKind,StructureWriteOperation} from "../../common/structureWrites";
import {runInputRecord} from "../../common/contextRunInput";
import {ApiError,newDesignApi} from "../api";
import {structureDraftHash,structureIssueLabel,normalizedStructureDraft} from "../structureDraftRecovery";

type Draft=CardGroupFormSummary|TemplateGroupSummary;
interface Pending{format:1;kind:StructureWriteKind;key:string;operation:StructureWriteOperation;draft:Draft;rawDraft?:Draft;}
export function isDraft(value:unknown,kind:StructureWriteKind):value is Draft {
  if(!runInputRecord(value)||!['id','key','name','description','createdAt','updatedAt'].every(key=>typeof value[key]==='string')||typeof value.revision!=='number'||!Number.isInteger(value.revision)||value.revision<1||!['draft','published','archived'].includes(String(value.status))||!(value.currentVersion===null||typeof value.currentVersion==='number')||!(value.currentVersionId===null||typeof value.currentVersionId==='string'))return false;
  if(kind==='template')return runInputRecord(value.draftConfig);
  return runInputRecord(value.draftDefinition)&&typeof value.draftDefinition.primaryTypeKey==='string'&&Array.isArray(value.draftDefinition.groups)&&typeof value.isSystem==='boolean'&&value.draftDefinition.groups.every(group=>runInputRecord(group)&&typeof group.key==='string'&&typeof group.name==='string'&&Array.isArray(group.sections)&&group.sections.every(section=>runInputRecord(section)&&typeof section.key==='string'&&typeof section.name==='string'&&Array.isArray(section.slots)&&section.slots.every(slot=>runInputRecord(slot)&&typeof slot.key==='string'&&typeof slot.name==='string'&&['primary_card','card_reference'].includes(String(slot.kind))&&Array.isArray(slot.allowedTypeKeys)&&slot.allowedTypeKeys.every(key=>typeof key==='string')&&typeof slot.min==='number'&&typeof slot.max==='number'&&Array.isArray(slot.localFields)&&slot.localFields.every(field=>runInputRecord(field)&&typeof field.key==='string'&&typeof field.name==='string'))));
}
function matches(saved:Draft,original:Pending):boolean {
  if(!isDraft(saved,original.kind)||!saved.id||(original.draft.id&&saved.id!==original.draft.id))return false;
  const actual=normalizedStructureDraft(saved),expected=normalizedStructureDraft(original.draft);
  if(actual.key!==expected.key)return false;
  if(original.operation==='publish')return saved.status==='published'&&saved.revision===original.draft.revision+1&&!!saved.currentVersionId&&saved.currentVersion!==null&&structureDraftHash(actual)===structureDraftHash(expected);
  return structureDraftHash({...actual,id:original.draft.id})===structureDraftHash(expected)&&saved.revision===(original.draft.id?original.draft.revision+1:1);
}
export function useStructureWriteRecovery(kind:StructureWriteKind,onRestore:(value:Draft,saved:boolean)=>void){
  const [pending,setPending]=useState<Pending|null>(null),[blocked,setBlocked]=useState(false),[working,setWorking]=useState(false),[message,setMessage]=useState(''),[issues,setIssues]=useState<string[]>([]);
  const pendingRef=useRef<Pending|null>(null),workingRef=useRef(false),storageBlockedRef=useRef(false),callback=useRef(onRestore);callback.current=onRestore;
  const storage=`nd-structure-write:${kind}`;
  useEffect(()=>{try{const raw=sessionStorage.getItem(storage);if(!raw)return;const value:unknown=JSON.parse(raw);if(!runInputRecord(value)||value.format!==1||value.kind!==kind||typeof value.key!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.key)||!['save','publish'].includes(String(value.operation))||!isDraft(value.draft,kind))throw new Error('原结构写入凭证格式无法核对；保留本机内容，请打开运行维护，不准备新请求。');const rawDraft=value.rawDraft;if(rawDraft!==undefined&&(!isDraft(rawDraft,kind)||rawDraft.id!==value.draft.id||rawDraft.revision!==value.draft.revision||structureDraftHash(normalizedStructureDraft(rawDraft))!==structureDraftHash(normalizedStructureDraft(value.draft))))throw new Error('原稿与原冻结输入的来源范围不一致；保留原凭证，请打开运行维护，不重新准备。');const restored:Pending={format:1,kind,key:value.key,operation:value.operation as StructureWriteOperation,draft:value.draft,...(rawDraft!==undefined&&isDraft(rawDraft,kind)?{rawDraft}:{})};pendingRef.current=restored;setPending(restored);callback.current(restored.rawDraft??restored.draft,false);setMessage('原保存或发布结果尚未确认；原稿与原凭证已恢复，请核对原请求结果。');}catch(error){storageBlockedRef.current=true;setBlocked(true);setMessage(error instanceof Error?error.message:'本机原凭证不可用；请打开运行维护。');}},[kind,storage]);
  function clear():boolean{try{sessionStorage.removeItem(storage);}catch{storageBlockedRef.current=true;setBlocked(true);setMessage('结果已确认，但本机原凭证清理失败；当前已确认结果保留，请恢复本机存储后刷新核对，不发送新请求。');return false;}pendingRef.current=null;setPending(null);return true;}
  async function perform(operation:StructureWriteOperation,draft:Draft,write:(key:string)=>Promise<Draft>,rawDraft?:Draft){
    if(pendingRef.current||storageBlockedRef.current||workingRef.current)return;
    const original:Pending={format:1,kind,operation,key:crypto.randomUUID(),draft:structuredClone(draft),...(rawDraft?{rawDraft:structuredClone(rawDraft)}:{})};
    try{sessionStorage.setItem(storage,JSON.stringify(original));pendingRef.current=original;setPending(original);}catch{storageBlockedRef.current=true;setBlocked(true);setMessage('发送前无法保存原稿和请求凭证；未发送请求，请恢复本机存储后刷新，再明确重新准备。');return;}
    workingRef.current=true;setWorking(true);setMessage('');setIssues([]);
    try{const saved=await write(original.key);if(!matches(saved,original))throw new Error('返回结果与原草稿或正式修订不一致；保留原请求，只读核对。');callback.current(saved,true);if(clear())setMessage(operation==='save'?'草稿保存结果已确认；当前表单保留。':`版本 v${saved.currentVersion} 发布结果已确认；不会重复追加版本。`);}
    catch(error){const recovery=error instanceof ApiError?error.recovery:null;if(error instanceof ApiError)setIssues(Object.entries(error.issues).map(([path,detail])=>`${structureIssueLabel(original.draft,path)}：${detail}`));if(recovery?.mutationOutcome==='not_written'){if(clear())setMessage(`${recovery.failedStep}：${recovery.summary} ${recovery.savedResult} 可核对目录后明确重新准备；当前原稿保留。`);}else setMessage(`${operation==='save'?'核对保存草稿结果':'核对发布版本结果'}：${error instanceof Error?error.message:'服务响应中断'}。结果尚未确认；原稿和原凭证保留，请核对原请求结果，勿再次保存或发布。`);}
    finally{workingRef.current=false;setWorking(false);}
  }
  async function verify(){const original=pendingRef.current;if(!original||workingRef.current)return;workingRef.current=true;setWorking(true);try{const receipt=await newDesignApi.getStructureWriteReceipt(kind,original.key);if(!receipt){setMessage('尚未找到原请求回执；空查询不证明未写入，原稿与凭证保留，请继续只读核对或打开运行维护。');return;}if(receipt.kind!==kind||receipt.operation!==original.operation||receipt.requestKey!==original.key||!matches(receipt.result,original))throw new Error('原请求回执与冻结草稿范围不一致，禁止覆盖当前草稿。');callback.current(receipt.result,true);if(clear())setMessage('原请求保存或发布结果已确认；没有重新执行写入。');}catch(error){setMessage(`核对原请求结果：${error instanceof Error?error.message:'读取失败'}。原稿与凭证保留。`);}finally{workingRef.current=false;setWorking(false);}}
  return {locked:!!pending||blocked||working,isLocked:()=>!!pendingRef.current||storageBlockedRef.current||workingRef.current,working,message,issues,pending,perform,verify};
}
