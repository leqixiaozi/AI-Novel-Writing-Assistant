const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {parseResearchSourceSelection,parseExportSourceSelection,parseResearchAdoptionSourceSelection,findResearchAdoptionSource,findResearchSourceRecord,findResearchSourceVersion,findExportSourceRecord,researchMetadataBaseline}=require("../dist/common/authorTasks");
const recordId="79000000-0000-4000-8000-000000000001",versionId="79000000-0000-4000-8000-000000000002",currentId="79000000-0000-4000-8000-000000000003",bookId="79000000-0000-4000-8000-000000000004",requestId="79000000-0000-4000-8000-000000000005",otherId="79000000-0000-4000-8000-000000000006";
function research(){return{id:recordId,title:"研究",tags:[],notes:"人工说明",favorite:false,status:"active",revision:1,currentVersion:{id:currentId,recordId,version:2,report:"当前报告"},versions:[{id:versionId,recordId,version:1,report:"原报告"},{id:currentId,recordId,version:2,report:"当前报告"}]};}
function exports(){return{bookId,exports:[{requestId,manifest:{id:currentId,bookId,chapters:[]},artifact:null}]};}
test("source parameters are strict UUIDs, reject empty/duplicate/missing ownership, never keyword-route",()=>{
 for(const search of ["?record=bad",`?version=${versionId}`,`?record=${recordId}&version=bad`,`?record=${recordId}&record=${otherId}`,"?record="])assert.equal(parseResearchSourceSelection(search).valid,false);
 for(const search of ["?export=bad","?export=",`?export=${requestId}&export=${requestId}`])assert.equal(parseExportSourceSelection(search).valid,false);
 for(const search of ["?book=bad",`?adoption=${requestId}`,`?book=${bookId}&adoption=bad`,`?book=${bookId}&book=${bookId}`])assert.equal(parseResearchAdoptionSourceSelection(search).valid,false);
 assert.equal(parseResearchSourceSelection(`?record=${recordId.toUpperCase()}&version=${versionId}`).recordId,recordId);
});
test("research source selects only a loaded matching record, and exact historical version of that record",()=>{
 const data=research(),selection=parseResearchSourceSelection(`?record=${recordId}&version=${versionId}`);assert.equal(findResearchSourceRecord([data],selection),data);assert.equal(findResearchSourceVersion(data,selection).report,"原报告");assert.equal(data.currentVersion.id,currentId);
 assert.equal(findResearchSourceRecord([data],parseResearchSourceSelection(`?record=${otherId}`)),null);
 assert.equal(findResearchSourceVersion(data,parseResearchSourceSelection(`?record=${recordId}&version=${otherId}`)),null);
 data.versions[0].recordId=otherId;assert.equal(findResearchSourceVersion(data,selection),null);
 assert.equal(findResearchSourceVersion(data,parseResearchSourceSelection(`?record=${otherId}&version=${currentId}`)),null);
});
test("exports verify loaded workspace and manifest book scope plus artifact provenance without replacement",()=>{
 const data=exports(),selection=parseExportSourceSelection(`?export=${requestId}`),before=JSON.stringify(data);assert.equal(findExportSourceRecord(data,bookId,selection),data.exports[0]);assert.equal(JSON.stringify(data),before);
 assert.equal(findExportSourceRecord(data,otherId,selection),null);assert.equal(findExportSourceRecord(data,bookId,parseExportSourceSelection(`?export=${otherId}`)),null);
 data.exports[0].manifest.bookId=otherId;assert.equal(findExportSourceRecord(data,bookId,selection),null);data.exports[0].manifest.bookId=bookId;
 data.exports[0].artifact={requestId:otherId,manifestId:currentId};assert.equal(findExportSourceRecord(data,bookId,selection),null);
 data.exports[0].artifact={requestId,manifestId:otherId};assert.equal(findExportSourceRecord(data,bookId,selection),null);
});
test("research adoption matches exact loaded same-book batch and rejects cross-book or missing targets",()=>{
 const item={id:requestId,bookId},selection=parseResearchAdoptionSourceSelection(`?book=${bookId}&adoption=${requestId}`);assert.equal(findResearchAdoptionSource([item],bookId,selection),item);assert.equal(findResearchAdoptionSource([item],otherId,selection),null);
 assert.equal(findResearchAdoptionSource([{...item,bookId:otherId}],bookId,selection),null);assert.equal(findResearchAdoptionSource([{...item,id:otherId}],bookId,selection),null);
});
test("author metadata dirty baseline is independent of current/report versions and cannot mutate reports",()=>{
 const data=research(),baseline=researchMetadataBaseline(data);data.versions[0].report="只读新回执";data.currentVersion={id:otherId,recordId};assert.equal(researchMetadataBaseline(data),baseline);data.notes="新人工说明";assert.notEqual(researchMetadataBaseline(data),baseline);assert.equal(data.versions[1].report,"当前报告");
});
test("research page guards pending draft switches and late read replacement while keeping history separate",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../src/client/ResearchRecordsPage.tsx"),"utf8");assert.match(source,/findResearchSourceRecord\(nextRecords,source\)/);assert.match(source,/findResearchSourceVersion\(next,selection\)/);assert.match(source,/if\(dirtyRef.current\)/);assert.match(source,/放弃本条说明并切换/);assert.match(source,/viewedVersionRef.current/);assert.doesNotMatch(source,/currentVersion:\s*viewedVersion/);
});
test("history component has no submit path or manifest setter, and exact export selects only original receipt",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../src/client/completionExport/ExportHistory.tsx"),"utf8");assert.match(source,/findExportSourceRecord\(workspace,bookId,currentSelection\)/);assert.doesNotMatch(source,/setManifest|submitPublicationExport|createPublicationExportManifest|retryJob|cancelJob/);assert.match(source,/只读刷新导出回执/);
});
test("adoption editor reports value changes directly including trees; page refresh preserves dirty children",()=>{
 const child=fs.readFileSync(path.join(__dirname,"../src/client/researchAdoption/AdoptionItemEditor.tsx"),"utf8"),page=fs.readFileSync(path.join(__dirname,"../src/client/ReferencePacksPage.tsx"),"utf8");assert.match(child,/onDraftDirty\?/);assert.match(child,/onChange=\{editValues\}/);assert.match(page,/if\(dirtyItemsRef.current.length\)/);assert.match(page,/findResearchAdoptionSource\(owned,bookId,source\)/);assert.match(page,/放弃对应草稿并切换/);assert.doesNotMatch(page,/requestedAdoptionId.*items\[0\]/);
});
