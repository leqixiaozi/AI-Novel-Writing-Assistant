const test=require('node:test'),assert=require('node:assert/strict');
const {compiled}=require('./support/isolatedDatabase.cjs');
const {storyFormatSchema,shortStoryShapeIssues}=compiled('common/storyFormat');
const short={form:'short_story',targetWordCount:8000};
const plan=(level,decision='adopt')=>({level,decision,content:level==='story'?{storyFormat:short}:{}});
test('short form validates its declared length without inferring form from chapter count',()=>{
 assert.equal(storyFormatSchema.safeParse({form:'short_story',targetWordCount:30000}).success,true);
 assert.equal(storyFormatSchema.safeParse({form:'short_story',targetWordCount:30001}).success,false);
 assert.equal(storyFormatSchema.safeParse({form:'long_novel',targetWordCount:30000}).success,false);
 assert.equal(storyFormatSchema.safeParse({form:'long_novel',targetWordCount:200000}).success,true);
 assert.deepEqual(shortStoryShapeIssues([plan('chapter'),plan('chapter')],null,true),[]);
});
test('complete short story requires one explicitly adopted hierarchy and preserves the declared profile',()=>{
 const plans=[plan('story'),plan('volume'),plan('chapter'),plan('scene')];
 assert.deepEqual(shortStoryShapeIssues(plans,short,true),[]);
 assert.ok(shortStoryShapeIssues([...plans,plan('chapter')],short,true).length);
 assert.ok(shortStoryShapeIssues(plans.map(item=>item.level==='chapter'?{...item,decision:'draft'}:item),short,true).length);
 assert.ok(shortStoryShapeIssues(plans.map(item=>item.level==='story'?{...item,content:{storyFormat:{...short,targetWordCount:9000}}}:item),short,true).length);
 assert.deepEqual(shortStoryShapeIssues([...plans,plan('chapter','exclude')],short,true),[]);
});
