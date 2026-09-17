const {test}=require('node:test');
const assert=require('node:assert/strict');
const {knowledgeSegmentSchema,compositionKnowledgeSelectionFromQuery}=require('../dist/common/knowledgeIndex/segments');
const {resolveKnowledgeReferenceSegment}=require('../dist/server/database/knowledgeReference/paragraphs');
const {createHash}=require('node:crypto');
const id='00000000-0000-4000-8000-000000000001',hash='a'.repeat(64);
const query=()=>new URLSearchParams({knowledgeAsset:id,sourceVersion:id,parsedVersion:id,checksum:hash,chunkId:id,segmentStart:'0',segmentEnd:'100',segmentChecksum:hash});
test('explicit paragraph proposal retains original source and exact range',()=>{
 const value=compositionKnowledgeSelectionFromQuery(query());
 assert.equal(value.parsedVersionId,id);assert.deepEqual(value.segment,{chunkId:id,start:0,end:100,checksum:hash});
});
test('partial, duplicate, fractional, reversed and oversized anchors are rejected',()=>{
 for(const mutate of [q=>q.delete('segmentChecksum'),q=>q.append('chunkId',id),q=>q.set('segmentStart','1.5'),q=>q.set('segmentStart','100'),q=>q.set('segmentEnd','50001')]){const q=query();mutate(q);assert.throws(()=>compositionKnowledgeSelectionFromQuery(q));}
});
test('ordinary full-text selection stays unchanged and does not acquire a paragraph',()=>{
 const q=query();for(const name of ['chunkId','segmentStart','segmentEnd','segmentChecksum'])q.delete(name);
 assert.deepEqual(compositionKnowledgeSelectionFromQuery(q),{assetId:id,sourceVersionId:id,parsedVersionId:id,checksum:hash});
 assert.equal(compositionKnowledgeSelectionFromQuery(new URLSearchParams()),null);
});
test('segment schema is strict and cannot accept copied text or out-of-range numbers',()=>{
 assert.equal(knowledgeSegmentSchema.safeParse({chunkId:id,start:0,end:100,checksum:hash,text:'copied'}).success,false);
 assert.equal(knowledgeSegmentSchema.safeParse({chunkId:id,start:0,end:2097153,checksum:hash}).success,false);
});
test('actual paragraph resolver returns only the exact original text slice',async()=>{
 const text='甲乙丙丁',selected='乙丙',segment={chunkId:id,start:1,end:3,checksum:createHash('sha256').update(selected).digest('hex')};
 const client={query:async(sql,values)=>{assert.match(sql,/chunk\.book_id=\$2/);assert.match(sql,/snapshot\.source_version_id=\$4/);assert.match(sql,/snapshot\.source_hash=\$5/);assert.deepEqual(values,[id,id,id,id,hash]);return {rows:[{chunk_text:selected,anchor:{start:1,end:3}}]};}};
 assert.equal(await resolveKnowledgeReferenceSegment(client,id,id,id,hash,text,segment),selected);
});
test('resolver rejects missing, changed, differently anchored and checksum-mismatched paragraphs',async()=>{
 const text='甲乙丙丁',segment={chunkId:id,start:1,end:3,checksum:createHash('sha256').update('乙丙').digest('hex')};
 for(const rows of [[],[{chunk_text:'甲乙丙丁',anchor:{start:1,end:3}}],[{chunk_text:'乙丙',anchor:{start:0,end:2}}]])await assert.rejects(()=>resolveKnowledgeReferenceSegment({query:async()=>({rows})},id,id,id,hash,text,segment));
 await assert.rejects(()=>resolveKnowledgeReferenceSegment({query:async()=>({rows:[{chunk_text:'乙丙',anchor:{start:1,end:3}}]})},id,id,id,hash,text,{...segment,checksum:hash}));
});
test('paragraph resolver uses exact resource lifecycle, book/space and profile joins rather than trusting current columns alone',async()=>{
 const text='甲😀乙',selected='😀',segment={chunkId:id,start:1,end:3,checksum:createHash('sha256').update(selected,'utf8').digest('hex')};
 const client={query:async sql=>{for(const name of ['snapshot','chunk']){assert.match(sql,new RegExp(`${name}_resource\\.resource_kind='embedding_${name==='snapshot'?'source_snapshot':'chunk'}'`));assert.match(sql,new RegExp(`${name}_resource\\.stable_object_id=${name}\\.id`));assert.match(sql,new RegExp(`${name}_resource\\.exact_version_id=${name}\\.id`));assert.match(sql,new RegExp(`${name}_resource\\.book_id=book\\.id`));assert.match(sql,new RegExp(`${name}_resource\\.space_id=book\\.space_id`));assert.match(sql,new RegExp(`${name}_state\\.book_id=book\\.id`));assert.match(sql,new RegExp(`${name}_state\\.state IN \\('fresh','recomputed'\\)`));}assert.match(sql,/snapshot_resource\.content_hash=snapshot\.source_hash/);assert.match(sql,/chunk_resource\.content_hash=chunk\.content_hash/);assert.match(sql,/snapshot\.book_id=chunk\.book_id/);assert.match(sql,/snapshot\.book_id=\$2/);assert.match(sql,/snapshot\.profile_version_id=chunk\.profile_version_id/);assert.doesNotMatch(sql,/COALESCE\([^)]*state[^)]*fresh|INSERT|UPDATE|DELETE/i);return{rows:[{chunk_text:selected,anchor:{start:1,end:3}}]};}};
 assert.equal(await resolveKnowledgeReferenceSegment(client,id,id,id,hash,text,segment),selected);assert.equal(selected.length,2);
});
test('SQL missing or invalid lifecycle yields no paragraph and never retries against full text',async()=>{
 const text='甲乙丙丁',segment={chunkId:id,start:1,end:3,checksum:createHash('sha256').update('乙丙').digest('hex')};let reads=0;
 await assert.rejects(()=>resolveKnowledgeReferenceSegment({query:async sql=>{reads++;assert.match(sql,/JOIN new_design\.dependency_resource_states chunk_state/);assert.match(sql,/JOIN new_design\.dependency_resource_states snapshot_state/);return{rows:[]};}},id,id,id,hash,text,segment),/缺少有效状态/);assert.equal(reads,1);
});
test('preparation initializes only successful new fact inserts and retrieval uses the same strict lifecycle without promoting history',()=>{
 const fs=require('node:fs'),path=require('node:path'),read=name=>fs.readFileSync(path.join(__dirname,'../src/server/database/knowledgeIndex',name),'utf8'),preparation=read('preparation.ts'),retrieval=read('retrieval.ts');
 assert.match(preparation,/if\(created\)await client\.query\("INSERT INTO new_design\.dependency_resource_states/);assert.match(preparation,/ON CONFLICT\(resource_id\) DO NOTHING/);assert.match(preparation,/const snapshotCreated=!snapshot/);assert.match(preparation,/if\(snapshotCreated\)snapshot=.*INSERT INTO new_design\.embedding_source_snapshots/);assert.match(preparation,/String\(row\.resource_id\),snapshotCreated/);assert.match(preparation,/parent,Boolean\(inserted\)/);assert.match(preparation,/state\.state IN \('fresh','recomputed'\)/);assert.doesNotMatch(preparation,/UPDATE\s+new_design\.dependency_resource_states/i);
 assert.equal((retrieval.match(/JOIN new_design\.dependency_resource_states chunk_state/g)??[]).length,2);assert.equal((retrieval.match(/JOIN new_design\.dependency_resource_states snapshot_state/g)??[]).length,2);assert.match(retrieval,/source\.book_id=chunk\.book_id/);assert.match(retrieval,/source\.profile_version_id=chunk\.profile_version_id/);assert.match(retrieval,/source\.source_stable_id=vector\.source_stable_id/);assert.match(retrieval,/source\.source_version_id=vector\.source_version_id/);assert.doesNotMatch(retrieval,/COALESCE\([^)]*state[^)]*fresh|INSERT INTO new_design\.dependency_resource_states|UPDATE new_design\.dependency_resource_states/i);
});
