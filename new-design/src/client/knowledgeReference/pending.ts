import type {KnowledgeUploadInput,KnowledgeWriteInput,KnowledgeBindInput,KnowledgeArchiveInput,KnowledgeReferenceInput,KnowledgeWriteReceipt} from "../../common/knowledgeReference";
export type KnowledgePending =
  | {operation:"upload";bookId:string;assetId:null;input:KnowledgeUploadInput}
  | {operation:"parse";bookId:string;assetId:string;input:KnowledgeWriteInput}
  | {operation:"bind";bookId:string;assetId:string;input:KnowledgeBindInput}
  | {operation:"archive";bookId:string;assetId:string;input:KnowledgeArchiveInput}
  | {operation:"reference";bookId:string;assetId:string;input:KnowledgeReferenceInput};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validKnowledgeBook(value:string):boolean{return uuid.test(value);}
export interface KnowledgePendingPointer {bookId:string;requestKey:string;operation:KnowledgePending["operation"];assetId:string|null}
const storageKey=(bookId:string)=>`new-design:knowledge:pending:${bookId}`;
/** Store only the original request pointer. File contents stay in the source editor. */
export function saveKnowledgePointer(pending:KnowledgePending):void {
  sessionStorage.setItem(storageKey(pending.bookId),JSON.stringify({bookId:pending.bookId,requestKey:pending.input.requestKey,operation:pending.operation,assetId:pending.assetId}));
}
export function readKnowledgePointer(bookId:string):KnowledgePendingPointer|null {
  try{const raw=sessionStorage.getItem(storageKey(bookId));if(!raw)return null;const value:unknown=JSON.parse(raw);
    if(!value||typeof value!=="object")return null;const row=value as Record<string,unknown>;
    if(row.bookId!==bookId||typeof row.requestKey!=="string"||!uuid.test(row.requestKey)||!['upload','parse','bind','archive','reference'].includes(String(row.operation)))return null;
    if(row.operation==='upload'?row.assetId!==null:typeof row.assetId!=="string"||!uuid.test(row.assetId))return null;
    return row as unknown as KnowledgePendingPointer;
  }catch{return null;}
}
export function clearKnowledgePointer(bookId:string):void {sessionStorage.removeItem(storageKey(bookId));}
export function knowledgePointerStorageBlocked(bookId:string):boolean {
  try{return sessionStorage.getItem(storageKey(bookId))!==null&&!readKnowledgePointer(bookId);}catch{return true;}
}
export function matchesKnowledgeReceipt(pointer:KnowledgePendingPointer,receipt:KnowledgeWriteReceipt):boolean {
  return receipt.bookId===pointer.bookId&&receipt.requestKey===pointer.requestKey&&receipt.operation===pointer.operation&&(pointer.assetId===null||receipt.assetId===pointer.assetId)&&receipt.mutationOutcome==='committed';
}
export function knowledgeIssueLocation(key:string):{label:string;field:string|null} {
  const root=key.split('.')[0];const fields:Record<string,{label:string;field:string|null}>={filename:{label:'文件名',field:'filename'},contentBase64:{label:'文件编码与正文',field:'filename'},title:{label:'参考标题',field:'title'},owner:{label:'使用位置',field:'owner'},reason:{label:'归档原因',field:'reason'},previewHash:{label:'归档影响预览',field:null},expectedRevision:{label:'参考版本',field:null},baseManifestId:{label:'上下文清单',field:'manifest'},slotKey:{label:'引用位置',field:'slot'},sources:{label:'所选引用版本',field:'reference'}};
  return fields[root]??{label:'输入或来源规格',field:null};
}
