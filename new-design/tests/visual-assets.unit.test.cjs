const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {VISUAL_MAX_BYTES,visualUploadSchema,visualCommandSchema,visualPreviewSchema,readVisualSelection}=require("../dist/common/visualAssets");
const {validateVisualBytes,decodeVisualUpload,withVisualAssetsPool,executeVisualCommand}=require("../dist/server/database/visualAssets");
const bookId="67000000-0000-4000-8000-000000000001",assetId="67000000-0000-4000-8000-000000000002",versionId="67000000-0000-4000-8000-000000000003",previewId="67000000-0000-4000-8000-000000000004";
const read=file=>fs.readFileSync(path.join(__dirname,"../",file),"utf8");
test("author-facing visual metadata keeps opaque provenance in read-only details",()=>{const code=read("src/client/visualAssets/index.tsx");assert.match(code,/<summary>原请求凭证（只读）<\/summary><p>\{lastReceipt.requestKey\}/);assert.match(code,/<summary>原正式内容版本凭证（只读）<\/summary><p>\{item.ownerVersionId\}/);assert.match(code,/<summary>影响来源凭证（只读）<\/summary><p>\{item.id\}/);assert.doesNotMatch(code,/绕过门禁假称完成|底层资产和版本/);});
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/w1UAAAAASUVORK5CYII=","base64");
const upload=()=>({bookId,assetId:null,expectedRevision:null,kind:"cover",title:"真实封面",description:"作者已有本地图片",filename:"封面.png",mimeType:"image/png",base64:png.toString("base64"),requestKey:"original-image-key"});
test("visual upload requires exact paired asset revision and bounded controlled image inputs",()=>{
 assert.equal(visualUploadSchema.safeParse(upload()).success,true);
 for(const patch of [{assetId},{expectedRevision:1},{title:""},{mimeType:"image/svg+xml"},{filename:"../file.png"},{filename:"C:\\file.png"},{provider:"old"},{locator:"https://remote"},{base64:"a".repeat(Math.ceil(VISUAL_MAX_BYTES/3)*4+1)}])assert.equal(visualUploadSchema.safeParse({...upload(),...patch}).success,false);
 assert.equal(visualUploadSchema.safeParse({...upload(),assetId,expectedRevision:1}).success,true);
});
test("visual selection exact UUID scope never falls back from an invalid version",()=>{
 assert.deepEqual(readVisualSelection(`?asset=${assetId}&version=${versionId}`),{assetId,versionId,valid:true});
 for(const input of ["?asset=","?version="+versionId,`?asset=${assetId}&asset=${assetId}`,`?asset=${assetId}&version=missing`])assert.equal(readVisualSelection(input).valid,false);
});
test("image content validation checks actual bytes and canonical encoding, not extension alone",()=>{
 const decoded=decodeVisualUpload(visualUploadSchema.parse(upload()));assert.equal(decoded.byteSize,png.length);assert.match(decoded.checksum,/^[a-f0-9]{64}$/);assert.match(decoded.locator,/^visual-[a-f0-9]{64}\.png$/);
 assert.throws(()=>validateVisualBytes(Buffer.from("<svg>not an image</svg>"),"image/png"));assert.throws(()=>validateVisualBytes(Buffer.from([255,216,255,217]),"image/jpeg"));assert.throws(()=>validateVisualBytes(Buffer.alloc(VISUAL_MAX_BYTES+1),"image/png"));assert.throws(()=>decodeVisualUpload({...upload(),base64:upload().base64+"\n"}));const oversized=Buffer.from(png);oversized.writeUInt32BE(16385,16);assert.throws(()=>validateVisualBytes(oversized,"image/png"));
});
test("explicit adopt and archive require real preview references; bindings freeze actual owners",()=>{
 const ref={bookId,assetId,expectedRevision:1,requestKey:"original-image-command"};
 assert.equal(visualCommandSchema.safeParse({...ref,operation:"adopt",versionId,previewId}).success,true);
 assert.equal(visualCommandSchema.safeParse({...ref,operation:"archive",previewId,reason:"保留历史，停止新增引用"}).success,true);
 for(const input of [{...ref,operation:"adopt",versionId},{...ref,operation:"archive",previewId,reason:""},{...ref,operation:"mount",versionId,ownerKind:"external",ownerStableId:bookId,ownerVersionId:bookId,label:""},{...ref,operation:"adopt",versionId,previewId,force:true}])assert.equal(visualCommandSchema.safeParse(input).success,false);
 assert.equal(visualPreviewSchema.safeParse({...ref,toVersionId:null}).success,true);
});
test("visual facts reuse original asset ledgers and original local storage contract",()=>{
 const code=read("src/server/database/visualAssets/index.ts"),adoptions=read("src/server/database/assets/adoptions.ts"),sql=read("migrations/067_visual_asset_source_receipts.sql"),native=read("src/server/database/bootstrap/tablesOnly/assets-jobs-functions.sql");
 for(const table of ["cards","card_types","card_versions","asset_versions","asset_content_objects","asset_events","asset_links"])assert.match(code,new RegExp("new_design\\."+table+"\\b"));
 assert.match(code,/record_type\.type_key='asset' JOIN new_design\.card_versions record_version ON record_version\.id=record\.current_version_id AND record_version\.card_id=record\.id/);
 assert.match(code,/createRecordCard\(client,\{[^\n]*typeKey:"asset"/);assert.match(code,/requireRecordCard\(client,String\(asset\.id\),"asset"/);
 assert.match(code,/new_design\.asset_versions v JOIN new_design\.asset_content_objects c ON c\.id=v\.content_object_id/);
 assert.match(code,/INSERT INTO new_design\.asset_links\(id,book_id,asset_id,asset_version_id,owner_kind,owner_stable_id,owner_exact_version_id/);
 assert.match(code,/typeKey:"dependency_change_preview"/);assert.match(code,/recordAssetAdoption\(client,values\)/);
 assert.match(adoptions,/createRecordCard\(client,\{[^\n]*typeKey:'asset_adoption'/);assert.match(adoptions,/asset\.book_id!==values\.book_id\|\|asset\.current_version_id!==values\.to_version_id\|\|Number\(asset\.revision\)!==Number\(values\.asset_revision\)/);assert.match(adoptions,/new_design\.record_dependency_invalidation/);assert.match(adoptions,/values\.dependency_preview_id/);
 assert.match(native,/IF kind IN \('asset_adoption'/);assert.match(native,/CREATE TRIGGER native_asset_version_scope BEFORE INSERT ON new_design\.asset_versions/);assert.match(native,/CREATE TRIGGER native_asset_link_scope BEFORE INSERT ON new_design\.asset_links/);
 assert.doesNotMatch(code,/new_design\.(?:assets|asset_adoptions|asset_mounts|dependency_change_previews)\b/);
 assert.match(code,/'managed_file','local'/);assert.doesNotMatch(code,/new_design_visual|invokeStructuredModel|fetch\(/);assert.doesNotMatch(sql,/CREATE TABLE/);assert.match(sql,/visual_preview_source_validate/);assert.match(sql,/visual event operation or version mismatch/);assert.match(code,/getManagedImageConnectionCatalog/);assert.match(code,/generation=\(await getManagedImageConnectionCatalog\(\)\)\.connections\.length>0/);assert.match(code,/row\.incomplete/);assert.match(code,/await checkedImage/);assert.match(code,/stableHash\(await mountReferences/);assert.match(sql,/visual_mount_active_source/);
});
test("image reading is controlled, content-addressed and immutable exact version scoped",()=>{
 const files=read("src/server/database/visualAssets/files.ts"),http=read("src/server/http/visualAssets/index.ts");assert.match(files,/O_NOFOLLOW/);assert.match(files,/isSymbolicLink/);assert.match(files,/hash\(bytes\)!==checksum/);assert.match(files,/await link\(temporary,target\)/);assert.match(files,/await unlink\(temporary\)/);assert.doesNotMatch(files,/writeFile\(target|fetch\(|https:/);assert.match(http,/X-Content-Type-Options/);assert.match(http,/sandbox/);assert.match(http,/getVisualImage\(uuid\.parse/);
});
test('HTTP raw failures are unknown and readonly failures never unlock writes',()=>{const http=read('src/server/http/visualAssets/index.ts');assert.match(http,/error instanceof z\.ZodError\?'not_written':'unknown'/);assert.match(http,/if\(request\.method==='GET'\)delete failure\.recovery\.mutationOutcome/);});
test("unknown original recovery queries only; explicit completion uses same full payload and key",()=>{
 const code=read("src/client/visualAssets/index.tsx"),check=code.slice(code.indexOf("const check=async"),code.indexOf("const completeOriginal=")),complete=code.slice(code.indexOf("const completeOriginal="),code.indexOf("const upload=async"));assert.match(check,/api\.receipt\(id\.bookId,id\.requestKey\)/);assert.doesNotMatch(check,/send\(|api\.upload|api\.command|randomUUID/);assert.match(complete,/writeAttempted&&notWritten/);assert.match(complete,/await send\(original\)/);assert.doesNotMatch(complete,/randomUUID|model|api\.run/);assert.match(code,/read_only/);assert.match(code,/unreadableMarker/);assert.match(code,/scopeChanged\|\|storageIssue/);assert.match(code,/dirtyRef\.current/);
});
test("pure database rollback acknowledgement never turns an unknown COMMIT into not-written",async()=>{
 const input={operation:"archive",bookId,assetId,expectedRevision:1,previewId,reason:"原归档",requestKey:"original-key-proof"},inputHash=require("../dist/server/database/aiContracts").stableHash(input);
 for(const failure of ["ack","lost","commit"]){const calls=[],client={async query(sql){calls.push(sql);if(sql==="ROLLBACK"&&failure==="lost")throw Error("private rollback");if(sql.includes("SELECT visual_input_hash,visual_receipt")){if(failure!=="commit")throw Error("private SQL");return{rows:[{visual_input_hash:inputHash,visual_receipt:{bookId,requestKey:"original-key-proof",operation:"archive",assetId,versionId,previewId,mountId:null,retainedResult:"原版本保留",repeated:false}}]};}if(sql==="COMMIT")throw Error("private COMMIT");return{rows:[]};},release(){calls.push("release");}},pool={async connect(){return client;}};
 await assert.rejects(withVisualAssetsPool(pool,()=>executeVisualCommand(input)),error=>{assert.equal(error.recovery.mutationOutcome,failure==="ack"?"not_written":"unknown");assert.equal(error.recovery.requestKey,"original-key-proof");assert.equal(error.recovery.actionLabel,"返回本书视觉资产");assert.doesNotMatch(error.message,/private|COMMIT/);return true;});assert.equal(calls.at(-1),"release");
 }
});
