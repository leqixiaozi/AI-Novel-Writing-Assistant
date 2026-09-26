const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
require('../node_modules/tsx/dist/cjs/index.cjs');
const {filterShelfClassifications,selectShelf,shelfAction}=require('../src/common/bookshelf/presentation.ts');
const {BOOK_WORKFLOW_STEPS}=require('../src/client/bookNavigation/workflow.ts');

const id='41000000-0000-4000-8000-000000000002';
function book(overrides={}){return {id,name:'来源明确的作品',description:'',createdAt:'2026-09-21T00:00:00Z',updatedAt:'2026-09-21T00:00:00Z',cardCount:1,characterCount:1,worldCount:1,requiredFieldCount:0,filledRequiredFieldCount:0,storyPlanCount:1,volumePlanCount:1,chapterPlanCount:2,adoptedChapterPlanCount:2,writableChapterPlanCount:1,writtenChapterCount:1,stableChapterCount:1,pendingFacts:0,pendingChanges:0,openQualityIssues:0,staleResources:0,pendingDependencyReviews:0,runningTasks:0,queuedTasks:0,waitingTasks:0,latestTask:null,latestDirector:null,revision:1,cover:null,coverGenerationStatus:null,wordCount:1000,candidateCount:1,firstChapterId:null,lastChapterCardId:null,storyFormat:{form:'long_novel',targetWordCount:200000},storyFormatSource:'adopted_story_plan',classification:{publicationStatus:'draft',writingMode:'original',platform:'qidian_male',creationExperience:'professional'},classificationSource:'adopted_book_contract',classificationIssue:null,...overrides};}

test('bookshelf classification filters accept only explicit formal sources',()=>{
 const formal=book(),unproven=book({id:'42000000-0000-4000-8000-000000000002',classificationSource:null,storyFormatSource:null});
 assert.deepEqual(filterShelfClassifications([formal,unproven],{form:'long_novel',publication:'draft',mode:'original',platform:'qidian_male'}).map(item=>item.id),[formal.id]);
 assert.deepEqual(filterShelfClassifications([formal,unproven],{form:'unset',publication:'unset',mode:'unset',platform:'unset'}).map(item=>item.id),[unproven.id]);
 assert.equal(selectShelf(Array.from({length:25},(_,index)=>book({id:`41000000-0000-4000-8000-${String(index).padStart(12,'0')}`,name:`作品${index}`})),'','all','updated',1).items.length,24);
});

test('continue and recovery routes retain the original director or source identity',()=>{
 const director=book({latestDirector:{id:'43000000-0000-4000-8000-000000000002',status:'waiting_recovery',leaseExpired:false,chapterCount:2,savedCandidateCount:1}});
 assert.match(shelfAction(director).href,/director\?run=43000000-0000-4000-8000-000000000002$/);
 const failed=book({latestTask:{id:'44000000-0000-4000-8000-000000000002',status:'failed',sourceRoute:`/new-design/books/${id}/writing`,updatedAt:'2026-09-21T00:00:00Z'}});
 assert.equal(shelfAction(failed).href,`/new-design/books/${id}/writing`);
});

test('book workflow exposes saved and adopted reading, cover recovery and three publication formats',()=>{
 const read=relative=>fs.readFileSync(path.join(__dirname,'../src/client',relative),'utf8');
 const reader=read('bookshelf/ReadingPage.tsx'),shelf=read('bookshelf/index.tsx'),visual=read('visualAssets/index.tsx'),image=read('imageGeneration/index.tsx'),completion=read('completionExport/CompletionExportPage.tsx'),workflow=read('bookNavigation/workflow.ts');
 for(const value of ['saved','adopted'])assert.match(reader,new RegExp(`value="${value}"`));
 assert.match(reader,/下载本章/);assert.match(reader,/下载整本 TXT/);assert.match(shelf,/slice\(0,3\)/);assert.match(shelf,/window\.setTimeout\(\(\)=>void load\(\),4000\)/);
 assert.match(visual,/只读核对原图片操作凭证/);assert.match(visual,/operation:"mount"/);assert.match(image,/只读核对原图片请求/);
 for(const value of ['markdown','plain_text','docx'])assert.match(completion,new RegExp(value));
 assert.match(completion,/exportMode/);assert.match(completion,/review_draft/);assert.match(completion,/expectedSourceHash/);
 assert.match(workflow,/BOOK_WORKFLOW_STEPS/);assert.equal(BOOK_WORKFLOW_STEPS.length,8);
});
