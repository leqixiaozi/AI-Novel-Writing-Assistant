const test=require('node:test');
const assert=require('node:assert/strict');
const {restoreFrozenChapterPrompt}=require('../dist/server/application/productionDirector');

const prompt={assetId:'new_design.chapter.generate_candidate',version:'v1',outputSchema:{type:'object',properties:{content:{type:'string'}}},messages:[{role:'system',content:'exact system contract'},{role:'user',content:JSON.stringify({taskData:{materials:[{content:{source:{name:'陈序'},relation:{kind:'friend'}}}]}})}]};
const frozen={assetId:prompt.assetId,assetVersion:prompt.version,outputSchema:prompt.outputSchema,messages:[{role:'system',content:prompt.messages[0].content},{role:'user',content:JSON.stringify({taskData:{materials:[{content:{relation:{kind:'friend'},source:{name:'陈序'}}}]}})}]};

test('original chapter request accepts JSONB key reordering and keeps the exact frozen user message',()=>{
 const restored=restoreFrozenChapterPrompt(prompt,frozen);
 assert.equal(restored.messages[1].content,frozen.messages[1].content);
 assert.notEqual(restored.messages[1].content,prompt.messages[1].content);
});

test('original chapter request rejects changed content or system contract',()=>{
 assert.throws(()=>restoreFrozenChapterPrompt(prompt,{...frozen,messages:[frozen.messages[0],{role:'user',content:frozen.messages[1].content.replace('friend','enemy')}]}),/冻结章节输入/);
 assert.throws(()=>restoreFrozenChapterPrompt(prompt,{...frozen,messages:[{role:'system',content:'different'},frozen.messages[1]]}),/冻结章节输入/);
});
