const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {isolatedDatabase,finalCardKernelDatabase,compiled}=require('./support/isolatedDatabase.cjs');

test('comic projects keep an independent immutable source snapshot and recover the original create request',async t=>{
 const {pool}=await finalCardKernelDatabase(t);
 const comic=compiled('server/database/comicProjects');
 const templates=compiled('server/database/templateStore');
 let template=await templates.saveTemplate({key:`comic_${randomUUID().replaceAll('-','')}`,name:'漫画测试模板',description:'',draftConfig:{},requestKey:randomUUID()});
 template=await templates.publishTemplate(template.id,template.revision,randomUUID());
 const book=await templates.createBook({key:`comic_${randomUUID().replaceAll('-','')}`,name:'来源小说',description:'',templateVersionId:template.currentVersionId});
 const input={requestKey:randomUUID(),title:'改编项目',sourceType:'novel_import',sourceBookId:book.id,comicFormat:'webtoon',stylePreset:'webtoon_color'};
 await assert.rejects(comic.createComicProject(input),error=>error.status===422);
 const chapterStore=compiled('server/database/chapterBodyStore');
 const cards=compiled('server/database/store'),author=compiled('server/database/authorMaterials');
 const type=(await cards.listCardTypes(book.spaceId)).find(item=>item.key==='chapter');
 const chapter=(await author.createAuthorMaterial(book.id,{requestKey:randomUUID(),cardTypeId:type.id,title:'第一章',values:{chapter_name:'第一章',chapter_goal:'改编来源'}})).card;
 const document=await chapterStore.createChapterDocument({bookId:book.id,chapterCardId:chapter.id,logicalOrder:1,title:'第一章'});
 const body=await chapterStore.addChapterBodyVersion(document.id,{content:'第一章的正式正文',source:'manual',createdByKind:'user'});
 await chapterStore.adoptChapterBodyVersion(document.id,{versionId:body.id,expectedRevision:document.revision,idempotencyKey:randomUUID()});
 const created=await comic.createComicProject(input);
 assert.equal(created.source.type,'novel_import');
 assert.match(created.source.content,/第一章的正式正文/);
 assert.equal(created.source.sourceBookId,book.id);
 assert.equal((await comic.readComicCreateOriginal(input.requestKey)).project.id,created.project.id);
 assert.equal((await comic.createComicProject(input)).project.id,created.project.id);
 await assert.rejects(comic.createComicProject({...input,title:'不同输入'}),error=>error.status===409);
 const later=await chapterStore.addChapterBodyVersion(document.id,{content:'第二版正文',source:'manual',createdByKind:'user'});
 await chapterStore.adoptChapterBodyVersion(document.id,{versionId:later.id,expectedRevision:(await chapterStore.getChapterDocument(document.id)).revision,idempotencyKey:randomUUID()});
 assert.match((await comic.getComicProject(created.project.id)).source.content,/第一章的正式正文/);
 assert.doesNotMatch((await comic.getComicProject(created.project.id)).source.content,/第二版正文/);
 assert.equal((await comic.listComicProjects()).length,1);
 await assert.rejects(pool.query("UPDATE new_design.card_version_actions SET action_key='tampered' WHERE request_key=$1",[input.requestKey]),error=>error.code==='23514');
 await pool.query('ALTER TABLE new_design.card_version_actions DISABLE TRIGGER card_version_actions_immutable');
 assert.equal((await comic.getComicCapability()).operational,false);
 assert.equal((await comic.getComicProject(created.project.id)).source.content,created.source.content);
 assert.equal((await comic.readComicCreateOriginal(input.requestKey)).project.id,created.project.id);
 await assert.rejects(comic.createComicProject({...input,requestKey:randomUUID()}),error=>error.status===503);
});

test('original idea and imported text are distinct project sources',async t=>{
 await finalCardKernelDatabase(t);
 const comic=compiled('server/database/comicProjects');
 for(const sourceType of ['original','text_import']){
  const result=await comic.createComicProject({requestKey:randomUUID(),title:sourceType,sourceType,sourceText:`${sourceType} 的来源文本`,comicFormat:'4koma',stylePreset:'chibi'});
  assert.equal(result.source.type,sourceType);
  assert.equal(result.source.content,`${sourceType} 的来源文本`);
 }
 const express=require('express'),app=express();app.use(express.json());app.use('/api/new-design',compiled('server/http/router').createNewDesignRouter());
 const http=app.listen(0,'127.0.0.1');await new Promise(resolve=>http.once('listening',resolve));t.after(()=>new Promise(resolve=>http.close(resolve)));
 const base=`http://127.0.0.1:${http.address().port}/api/new-design`;
 assert.equal((await(await fetch(`${base}/comic/capability`)).json()).data.operational,true);
 const response=await fetch(`${base}/comic/projects`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestKey:randomUUID(),title:'HTTP 漫画项目',sourceType:'original',sourceText:'HTTP 原创来源',comicFormat:'webtoon',stylePreset:'realistic'})});
 assert.equal(response.status,201);
 const result=(await response.json()).data;
 assert.equal((await(await fetch(`${base}/comic/projects/${result.project.id}`)).json()).data.source.content,'HTTP 原创来源');
 assert.equal((await(await fetch(`${base}/comic/create-requests/${result.requestKey}`)).json()).data.project.id,result.project.id);
});

test('comic project creation stays closed before its manual migration is installed',async t=>{
 await isolatedDatabase(t);
 const comic=compiled('server/database/comicProjects');
 assert.deepEqual(await comic.getComicCapability(),{installed:false,operational:false,reason:'漫画卡片收敛迁移尚未启用。'});
 await assert.rejects(comic.createComicProject({requestKey:randomUUID(),title:'尚未启用',sourceType:'original',sourceText:'保留输入',comicFormat:'webtoon',stylePreset:'webtoon_color'}),error=>error.status===503);
});
