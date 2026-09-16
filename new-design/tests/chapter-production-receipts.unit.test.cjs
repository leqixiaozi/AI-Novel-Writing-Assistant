const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {prepareChapterProductionReplyReceipt,sanitizeChapterProductionExecutionReceipt,readChapterProductionReplyReceipt,ChapterProductionReplyReceiptError,CHAPTER_PRODUCTION_RECEIPT_MAX_BYTES}=require("../dist/server/ai/chapterProductionReceipts");
const id="77000000-0000-4000-8000-000000000001",requestId="77000000-0000-4000-8000-000000000002",attemptId="77000000-0000-4000-8000-000000000003",snapshotId="77000000-0000-4000-8000-000000000004",hash="a".repeat(64);
function input(){return {bookId:id,requestId,attemptId,inputHash:hash,output:{content:"宗门夜雨",decision:"continue_with_warning",warnings:["人物动机待人工审阅"],reason:"候选尚未采用"},execution:{provider:"ollama",model:"example-model",routeSnapshotId:snapshotId,inputTokens:10,outputTokens:20,knownTokens:30,retryCount:0,fallbackCount:0,usageReported:true,usageStatus:"reported",budgetExceeded:false,attempts:[{provider:"ollama",model:"example-model",kind:"primary",status:"succeeded",category:null,reservedTokens:1000,usedTokens:30,durationMs:100,requestSent:true,responseReceived:true}]}};}
test("original reply receipt has exact original refs and deterministic payload hashes, not a database receipt",()=>{
 const first=prepareChapterProductionReplyReceipt(input()),second=prepareChapterProductionReplyReceipt(input());assert.deepEqual(first,second);assert.equal(first.contract,"chapter_production_reply_v1");assert.equal(first.output.content,"宗门夜雨");assert.equal(first.execution.routeSnapshotHash,null);assert.match(first.receiptHash,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(first),/databaseCommitted|adopted|locator|sourceRoute/);
 const changed=input();changed.output.content="另一个回复";assert.notEqual(prepareChapterProductionReplyReceipt(changed).receiptHash,first.receiptHash);changed.output=input().output;changed.inputHash="b".repeat(64);assert.notEqual(prepareChapterProductionReplyReceipt(changed).receiptHash,first.receiptHash);
});
test("execution whitelist discards endpoint credentials route configuration and raw technical output",()=>{
 const source=input();Object.assign(source.execution,{endpoint:"https://private.example/secret",credentialId:"secret-ref",apiKey:"private-key",sourceLayers:[{config:{password:"private-password"}}],providerOutput:"private-raw"});Object.assign(source.execution.attempts[0],{error_message:"private SQL",requestHeaders:{Authorization:"private-bearer"}});
 const receipt=prepareChapterProductionReplyReceipt(source);assert.doesNotMatch(JSON.stringify(receipt),/private|credential|endpoint|Authorization|sourceLayers|providerOutput|error_message/);assert.equal(receipt.execution.attempts[0].responseReceived,true);
});
test("missing usage remains unknown rather than zero or measured budget success",()=>{
 const source=input();Object.assign(source.execution,{inputTokens:null,outputTokens:null,knownTokens:0,usageReported:false,usageStatus:"partial_or_unavailable"});source.execution.attempts[0].usedTokens=null;const receipt=prepareChapterProductionReplyReceipt(source);assert.equal(receipt.execution.inputTokens,null);assert.equal(receipt.execution.outputTokens,null);assert.equal(receipt.execution.usageStatus,"partial_or_unavailable");
});
test("only confirmed received successful output can be spooled, no unknown-send success fiction",()=>{
 for(const patch of [{requestSent:false},{responseReceived:false},{status:"failed",category:"transport"}]){const source=input();Object.assign(source.execution.attempts[0],patch);assert.throws(()=>prepareChapterProductionReplyReceipt(source),ChapterProductionReplyReceiptError);}
 const mismatch=input();mismatch.execution.model="different-model";assert.throws(()=>prepareChapterProductionReplyReceipt(mismatch),ChapterProductionReplyReceiptError);
 const secret=input();secret.execution.model="https://private.example/model";assert.throws(()=>sanitizeChapterProductionExecutionReceipt(secret.execution),ChapterProductionReplyReceiptError);
});
test("strict output bounds and original scope reject traversal forged hashes or extra prose keys",()=>{
 for(const patch of [{bookId:"../other"},{requestId:""},{attemptId:"invalid"},{inputHash:"not-a-hash"}])assert.throws(()=>prepareChapterProductionReplyReceipt({...input(),...patch}),ChapterProductionReplyReceiptError);
 for(const patch of [{content:" "},{content:"文".repeat(2000001)},{warnings:Array(101).fill("警告")},{warnings:["警".repeat(2001)]},{reason:"文".repeat(4001)},{sql:"private"}]){const source=input();Object.assign(source.output,patch);assert.throws(()=>prepareChapterProductionReplyReceipt(source),ChapterProductionReplyReceiptError);}
 const maximum=input();maximum.output.content="文".repeat(2000000);assert.equal(prepareChapterProductionReplyReceipt(maximum).output.content.length,2000000);assert.equal(CHAPTER_PRODUCTION_RECEIPT_MAX_BYTES,16*1024*1024);
});
test("invalid read scope errors are fixed Chinese and never expose paths original content or stack",async()=>{
 await assert.rejects(()=>readChapterProductionReplyReceipt({bookId:"../private",requestId,attemptId,inputHash:hash}),error=>error instanceof ChapterProductionReplyReceiptError&&!/private|Zod|ENOENT|C:/.test(error.message));
});
test("controlled publication is exclusive flushed no-replace and read verifies bounded regular exact file",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../src/server/ai/chapterProductionReceipts/index.ts"),"utf8");assert.match(source,/O_EXCL\|constants\.O_NOFOLLOW/);assert.match(source,/await handle\.sync\(\)/);assert.match(source,/await link\(pending,target\)/);assert.doesNotMatch(source,/rename\(|writeFile\(target|fetch\(|getNewDesignPool|executeManagedPrompt|ingestChapterWritingResult/);assert.match(source,/before\.nlink!==1/);assert.match(source,/opened\.ino!==before\.ino/);assert.match(source,/Buffer\.alloc\(opened\.size\)/);assert.match(source,/receiptHash!==stableHash\(payload\)/);assert.match(source,/previous\.receiptHash!==receipt\.receiptHash/);assert.match(source,/"data","ai-receipts","chapter-production"/);assert.doesNotMatch(source,/throw error;.*error\.message/);
});
