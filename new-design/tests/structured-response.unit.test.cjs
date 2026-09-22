const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {decodeModelObject}=require('../dist/server/ai/runtime/structuredResponse');
test('valid JSON remains unchanged, including escaped nested quotes',()=>{
 const raw=JSON.stringify({text:'他说"回来"，然后走了',path:'C:\\work'});
 assert.deepEqual(decodeModelObject(raw),{value:JSON.parse(raw)});
});
test('only a missing paired closing-quote escape is repaired, with exact provenance',()=>{
 const raw=String.raw`{"text":"孩子多用\"他在的时候"三个字起头。"}`;
 const fixed=decodeModelObject(raw);
 assert.deepEqual(fixed.value,{text:'孩子多用"他在的时候"三个字起头。'});
 assert.equal(fixed.outputRepair.kind,'paired_quote_escape');assert.equal(fixed.outputRepair.positions.length,1);
 assert.equal(fixed.outputRepair.sourceSha256,createHash('sha256').update(raw).digest('hex'));
 assert.notEqual(fixed.outputRepair.normalizedSha256,fixed.outputRepair.sourceSha256);
});
test('no guessing commas, fields, missing values, fences, unpaired quotes or truncated objects',()=>{
 for(const raw of [String.raw`{"text":"收入。motivation":"动机"}`,String.raw`{"text":"他说"你好"再走"}`,String.raw`{"text":"\"你好`,String.raw`{"text":"正常" "name":"缺逗号"}`,String.raw`{"text":}`,String.raw`{"text":"\"你好"三个字"`, '```json\n{"text":"你好"}\n```'])assert.throws(()=>decodeModelObject(raw),raw);
});
