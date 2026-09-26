import {randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {link,lstat,mkdir,open,realpath,unlink} from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import type {ChapterGenerationOutput} from "../../../common/productionDirector";
import {stableHash} from "../../database/aiContracts";
import {NewDesignError} from "../../domain/errors";

const digest=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid().transform(value=>value.toLowerCase());
const counter=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const provider=z.enum(["ollama","openai-compatible","anthropic-compatible"]);
const model=z.string().min(1).max(300).refine(value=>!/[\u0000-\u001f\u007f]/.test(value)&&!value.includes("://"));
const outputSchema=z.object({content:z.string().min(1).max(2000000).refine(value=>Boolean(value.trim())),decision:z.enum(["continue","continue_with_warning","pause_for_manual","stop_for_replan"]),warnings:z.array(z.string().min(1).max(2000)).max(100),reason:z.string().max(4000)}).strict();
const attemptSchema=z.object({provider,model,kind:z.enum(["primary","fallback"]),status:z.enum(["succeeded","failed"]),category:z.enum(["timeout","rate_limit","authentication","provider_unavailable","transport","context_limit","structure_parse","content_unsatisfactory","cancelled","safety","data_integrity","unknown"]).nullable(),reservedTokens:counter,usedTokens:counter.nullable(),durationMs:counter,requestSent:z.boolean(),responseReceived:z.boolean()}).strict();
const executionSchema=z.object({provider,model,routeSnapshotId:z.string().uuid(),routeSnapshotHash:digest.nullable().default(null),inputTokens:counter.nullable(),outputTokens:counter.nullable(),knownTokens:counter,retryCount:counter.max(3),fallbackCount:counter.max(4),usageReported:z.boolean(),usageStatus:z.enum(["reported","partial_or_unavailable"]),budgetExceeded:z.boolean(),attempts:z.array(attemptSchema).min(1).max(20)}).strict().superRefine((execution,ctx)=>{
  if(!execution.attempts.some(attempt=>attempt.status==="succeeded"&&attempt.requestSent&&attempt.responseReceived))ctx.addIssue({code:"custom",message:"缺少真实已收到的成功原回复"});
  if(execution.attempts.some(attempt=>attempt.responseReceived&&!attempt.requestSent||attempt.status==="succeeded"&&(!attempt.requestSent||!attempt.responseReceived)))ctx.addIssue({code:"custom",message:"原尝试发送与接收凭证不一致"});
  const last=execution.attempts[execution.attempts.length-1];if(last.status!=="succeeded"||last.category!==null||last.provider!==execution.provider||last.model!==execution.model)ctx.addIssue({code:"custom",message:"成功原回复与末次模型回执不一致"});
  if(execution.usageStatus==="reported"&&!execution.usageReported||execution.usageStatus==="partial_or_unavailable"&&execution.usageReported)ctx.addIssue({code:"custom",message:"原用量确认状态不一致"});
});
const referenceSchema=z.object({bookId:uuid,requestId:uuid,attemptId:uuid,inputHash:digest}).strict();
const receiptSchema=referenceSchema.extend({contract:z.literal("chapter_production_reply_v1"),outputHash:digest,executionHash:digest,receiptHash:digest,output:outputSchema,execution:executionSchema}).strict();
export type ChapterProductionExecutionReceipt=z.infer<typeof executionSchema>;
export type ChapterProductionReplyReceipt=z.infer<typeof receiptSchema>;
export interface ReadChapterProductionReplyReceiptInput {bookId:string;requestId:string;attemptId:string;inputHash:string;}
export interface WriteChapterProductionReplyReceiptInput extends ReadChapterProductionReplyReceiptInput {output:ChapterGenerationOutput;execution:Record<string,unknown>;}
const appRoot=path.resolve(__dirname,"../../../.."),root=path.join(appRoot,"data","ai-receipts","chapter-production");
export const CHAPTER_PRODUCTION_RECEIPT_MAX_BYTES=16*1024*1024;
/** Contains no low-level message, credential, SQL, file path or original model text. */
export class ChapterProductionReplyReceiptError extends NewDesignError {
  constructor(readonly kind:"invalid"|"conflict"|"unavailable"){super(kind==="invalid"?"原章节回复凭证或冻结来源不完整，禁止保存替代结果。":kind==="conflict"?"原章节回复凭证与已保留内容不一致，不能覆盖；请保留原请求核对。":"原章节回复本地凭证暂未完成读写确认；已有内容保留，请按原请求核对，不重新调用模型。",kind==="unavailable"?503:409);}
}
const keys=["provider","model","routeSnapshotId","routeSnapshotHash","inputTokens","outputTokens","knownTokens","retryCount","fallbackCount","usageReported","usageStatus","budgetExceeded","attempts"] as const;
const attemptKeys=["provider","model","kind","status","category","reservedTokens","usedTokens","durationMs","requestSent","responseReceived"] as const;
function pick(value:object,fields:readonly string[]):Record<string,unknown>{const entries=new Map<string,unknown>(Object.entries(value));return Object.fromEntries(fields.map(key=>[key,entries.get(key)]));}
/** Infrastructure boundary: unrelated runtime configuration is deliberately discarded before persistence. */
export function sanitizeChapterProductionExecutionReceipt(value:Record<string,unknown>):ChapterProductionExecutionReceipt {
  try{const selected=pick(value,keys);selected.attempts=Array.isArray(value.attempts)?value.attempts.map(item=>typeof item==="object"&&item!==null&&!Array.isArray(item)?pick(item,attemptKeys):item):value.attempts;return executionSchema.parse(selected);}catch{throw new ChapterProductionReplyReceiptError("invalid");}
}
export function prepareChapterProductionReplyReceipt(input:WriteChapterProductionReplyReceiptInput):ChapterProductionReplyReceipt {
  try{const references=referenceSchema.parse(pick(input,["bookId","requestId","attemptId","inputHash"])),output=outputSchema.parse(input.output),execution=sanitizeChapterProductionExecutionReceipt(input.execution);
    const payload={contract:"chapter_production_reply_v1" as const,...references,outputHash:stableHash(output),executionHash:stableHash(execution),output,execution};return receiptSchema.parse({...payload,receiptHash:stableHash(payload)});
  }catch(error){if(error instanceof ChapterProductionReplyReceiptError)throw error;throw new ChapterProductionReplyReceiptError("invalid");}
}
function validateReceipt(value:unknown,references:ReadChapterProductionReplyReceiptInput):ChapterProductionReplyReceipt {
  const receipt=receiptSchema.parse(value),{receiptHash,...payload}=receipt;
  if(receipt.bookId!==references.bookId||receipt.requestId!==references.requestId||receipt.attemptId!==references.attemptId||receipt.inputHash!==references.inputHash||receipt.outputHash!==stableHash(receipt.output)||receipt.executionHash!==stableHash(receipt.execution)||receiptHash!==stableHash(payload))throw new ChapterProductionReplyReceiptError("conflict");return receipt;
}
function errno(error:unknown,code:string):boolean{return typeof error==="object"&&error!==null&&"code" in error&&error.code===code;}
const samePath=(left:string,right:string)=>process.platform==="win32"?left.toLowerCase()===right.toLowerCase():left===right;
/** Check every controlled ancestor; no symlink/junction or outside-root locator is accepted. */
async function directory(bookId:string,create:boolean):Promise<string|null> {
  let current=appRoot;
  const base=await lstat(current);if(!base.isDirectory()||base.isSymbolicLink()||!samePath(await realpath(current),current))throw new ChapterProductionReplyReceiptError("unavailable");
  for(const part of [...path.relative(appRoot,root).split(path.sep),bookId]){const parent=current;current=path.join(current,part);let created=false;if(create)try{await mkdir(current,0o700);created=true;}catch(error){if(!errno(error,"EEXIST"))throw error;}
    let info;try{info=await lstat(current);}catch(error){if(!create&&errno(error,"ENOENT"))return null;throw error;}if(!info.isDirectory()||info.isSymbolicLink()||!samePath(await realpath(current),current))throw new ChapterProductionReplyReceiptError("unavailable");if(created)await syncDirectory(parent);}
  return current;
}
const filename=(references:ReadChapterProductionReplyReceiptInput)=>`${references.requestId}-${references.attemptId}.json`;
async function readFileReceipt(target:string,references:ReadChapterProductionReplyReceiptInput):Promise<ChapterProductionReplyReceipt|null>{
  let before;try{before=await lstat(target);}catch(error){if(errno(error,"ENOENT"))return null;throw error;}
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size<=0||before.size>CHAPTER_PRODUCTION_RECEIPT_MAX_BYTES)throw new ChapterProductionReplyReceiptError("unavailable");
  const handle=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const opened=await handle.stat();if(!opened.isFile()||opened.nlink!==1||opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size)throw new ChapterProductionReplyReceiptError("unavailable");
    // Bounded positional read, not readFile: a concurrently enlarged file cannot exhaust memory.
    const bytes=Buffer.alloc(opened.size);let offset=0;while(offset<bytes.length){const part=await handle.read(bytes,offset,bytes.length-offset,offset);if(!part.bytesRead)throw new ChapterProductionReplyReceiptError("unavailable");offset+=part.bytesRead;}const after=await handle.stat();if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs)throw new ChapterProductionReplyReceiptError("unavailable");
    const text=bytes.toString("utf8");if(!Buffer.from(text,"utf8").equals(bytes))throw new ChapterProductionReplyReceiptError("unavailable");return validateReceipt(JSON.parse(text),references);
  }finally{await handle.close();}
}
/** Exact original scope only. null is absence of local evidence, never proof of no model call or no DB commit. */
export async function readChapterProductionReplyReceipt(input:ReadChapterProductionReplyReceiptInput):Promise<ChapterProductionReplyReceipt|null>{
  try{const references=referenceSchema.parse(input),folder=await directory(references.bookId,false);if(!folder)return null;return await readFileReceipt(path.join(folder,filename(references)),references);}catch(error){if(error instanceof ChapterProductionReplyReceiptError)throw error;throw new ChapterProductionReplyReceiptError("unavailable");}
}
async function syncDirectory(folder:string):Promise<void>{
  // Windows cannot reliably open/fsync a directory with Node. The file itself is always fsynced.
  if(process.platform==="win32")return;const handle=await open(folder,constants.O_RDONLY|constants.O_NOFOLLOW);try{await handle.sync();}finally{await handle.close();}
}
/** No provider or database write here. Exclusive publication never replaces an original reply. */
export async function writeChapterProductionReplyReceipt(input:WriteChapterProductionReplyReceiptInput):Promise<ChapterProductionReplyReceipt>{
  const receipt=prepareChapterProductionReplyReceipt(input);let temporary:string|null=null;
  try{const folder=await directory(receipt.bookId,true);if(!folder)throw new ChapterProductionReplyReceiptError("unavailable");const target=path.join(folder,filename(receipt)),previous=await readFileReceipt(target,receipt);if(previous){if(previous.receiptHash!==receipt.receiptHash)throw new ChapterProductionReplyReceiptError("conflict");return previous;}
    const bytes=Buffer.from(JSON.stringify(receipt),"utf8");if(bytes.length>CHAPTER_PRODUCTION_RECEIPT_MAX_BYTES)throw new ChapterProductionReplyReceiptError("invalid");
    const pending=path.join(folder,`pending-${randomUUID()}.tmp`),handle=await open(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);temporary=pending;
    try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    // Recheck ancestors immediately before no-replace publication.
    await directory(receipt.bookId,false);try{await link(pending,target);}catch(error){if(!errno(error,"EEXIST"))throw error;await unlink(pending);temporary=null;const concurrent=await readFileReceipt(target,receipt);if(!concurrent||concurrent.receiptHash!==receipt.receiptHash)throw new ChapterProductionReplyReceiptError("conflict");return concurrent;}
    await unlink(pending);temporary=null;await syncDirectory(folder);const published=await readFileReceipt(target,receipt);if(!published||published.receiptHash!==receipt.receiptHash)throw new ChapterProductionReplyReceiptError("conflict");return published;
  }catch(error){if(error instanceof ChapterProductionReplyReceiptError)throw error;throw new ChapterProductionReplyReceiptError("unavailable");}
  finally{if(temporary)await unlink(temporary).catch(()=>{/* Only this exclusive temporary file; never remove a published original. */});}
}
