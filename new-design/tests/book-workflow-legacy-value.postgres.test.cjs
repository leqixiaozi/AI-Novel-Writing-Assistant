const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {isolatedDatabase,compiled}=require('./support/isolatedDatabase.cjs');
const key=()=>randomUUID();

test('bookshelf projects formal classification and adopted story format sources',{skip:!process.env.ND_REFERENCE_TEST_BUILD,timeout:120000},async t=>{
 const {pool}=await isolatedDatabase(t),templates=compiled('server/database/templateStore'),classification=compiled('server/database/bookshelf/classification'),shelf=compiled('server/database/bookshelf'),planning=compiled('server/database/planning');
 let template=await templates.saveTemplate({key:`shelf_${key()}`,name:'书架来源测试',description:'',draftConfig:{},requestKey:key()});template=await templates.publishTemplate(template.id,template.revision,key());
 const book=await templates.createBook({key:`book_${key()}`,name:'正式分类作品',description:'',templateVersionId:template.currentVersionId},{includeTemplateSeed:false,origin:{method:'blank',sourceReference:'作者明确选择',sourcePayload:{storyFormat:{form:'long_novel',targetWordCount:200000}}}});
 const workspace=await classification.readBookClassification(book.id),input={requestKey:key(),cardId:workspace.cardId,expectedRevision:workspace.revision,classification:{publicationStatus:'draft',writingMode:'original',platform:'qidian_male',creationExperience:'professional'}};
 await classification.saveBookClassification(book.id,input);
 let projected=(await shelf.getBookshelfSnapshot(pool)).books.find(item=>item.id===book.id);
 assert.equal(projected.classificationSource,'adopted_book_contract');assert.equal(projected.storyFormatSource,null);
 let plan=await planning.createPlanningObject({bookId:book.id,level:'story',parentObjectId:null,cardId:null,title:'故事总纲',sortOrder:0,content:{goal:'完成长篇',storyFormat:{form:'long_novel',targetWordCount:200000},storyFormatSourceId:projected.creationStoryFormat.sourceId},source:'manual',executionMode:'manual',references:[],idempotencyKey:key()});
 plan=await planning.adoptPlanningVersion(plan.id,{versionId:plan.currentVersionId,expectedRevision:plan.revision,idempotencyKey:key()});
 projected=(await shelf.getBookshelfSnapshot(pool)).books.find(item=>item.id===book.id);
 assert.equal(projected.storyFormatSource,'adopted_story_plan');assert.equal(projected.storyFormat.form,'long_novel');assert.equal(projected.classificationSource,'adopted_book_contract');
});
