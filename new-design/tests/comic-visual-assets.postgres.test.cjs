const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const express=require('express');
const {isolatedDatabase,compiled}=require('./support/isolatedDatabase.cjs');

const pngBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=';

test('comic visual assets keep immutable candidates and require explicit adoption',async t=>{
 const {pool}=await isolatedDatabase(t,[
  {id:'109_comic_projects',fileName:'109_comic_projects.sql'},
  {id:'112_comic_bibles',fileName:'112_comic_bibles.sql'},
  {id:'114_comic_visual_assets',fileName:'114_comic_visual_assets.sql'},
 ]);
 const projects=compiled('server/database/comicProjects');
 const bibles=compiled('server/database/comicBibles');
 const visuals=compiled('server/database/comicVisualAssets');
 const project=(await projects.createComicProject({requestKey:randomUUID(),title:'视觉资产测试',sourceType:'original',sourceText:'雨夜相遇。',comicFormat:'webtoon',stylePreset:'webtoon_color'})).project;
 const proposed=await bibles.proposeComicBible(project.id,{kind:'character',requestKey:randomUUID(),expectedRevision:0,content:{name:'林青',gender:'female',persona:'侦探',visualAnchor:'黑发、蓝色雨衣'}});
 const adopted=await bibles.adoptComicBible(project.id,proposed.entity.id,{requestKey:randomUUID(),versionId:proposed.version.id,expectedRevision:0});
 const upload={requestKey:randomUUID(),bibleEntityId:adopted.entity.id,assetId:null,expectedRevision:null,assetType:'portrait',name:'基础肖像',description:'正面角色锚点',filename:'portrait.png',mimeType:'image/png',base64:pngBase64};

 const first=await visuals.uploadComicVisualCandidate(project.id,upload);
 assert.equal(first.repeated,false);
 assert.equal(first.asset.revision,0);
 assert.equal(first.asset.adoptedVersionId,null);
 assert.equal(first.version.sourceBibleVersionId,proposed.version.id);
 assert.equal(first.version.byteSize,Buffer.from(pngBase64,'base64').length);
 assert.equal('imageData' in first.version,false);
 const repeated=await visuals.uploadComicVisualCandidate(project.id,upload);
 assert.equal(repeated.repeated,true);
 assert.equal(repeated.version.id,first.version.id);
 await assert.rejects(()=>visuals.uploadComicVisualCandidate(project.id,{...upload,name:'另一张图'}),/原视觉素材请求已用于不同内容/);

 const content=await visuals.readComicVisualContent(project.id,first.asset.id,first.version.id);
 assert.equal(content.mimeType,'image/png');
 assert.deepEqual(content.bytes,Buffer.from(pngBase64,'base64'));
 const workspace=await visuals.getComicVisualWorkspace(project.id,adopted.entity.id);
 assert.equal(workspace.assets.length,1);
 assert.equal(JSON.stringify(workspace).includes(pngBase64),false);

 const adoptionInput={requestKey:randomUUID(),versionId:first.version.id,expectedRevision:0};
 const adoption=await visuals.adoptComicVisualVersion(project.id,first.asset.id,adoptionInput);
 assert.equal(adoption.asset.revision,1);
 assert.equal(adoption.asset.adoptedVersionId,first.version.id);
 assert.equal((await visuals.readComicVisualAdoptionOriginal(project.id,adoptionInput.requestKey)).adoptedVersionId,first.version.id);

 const second=await visuals.uploadComicVisualCandidate(project.id,{...upload,requestKey:randomUUID(),assetId:first.asset.id,expectedRevision:1,name:'雨夜肖像'});
 assert.equal(second.version.version,2);
 assert.equal(second.asset.adoptedVersionId,first.version.id);
 await assert.rejects(()=>pool.query('UPDATE new_design.comic_visual_asset_versions SET name=$2 WHERE id=$1',[first.version.id,'篡改']),/immutable|不可改写/i);

 const other=(await projects.createComicProject({requestKey:randomUUID(),title:'另一个项目',sourceType:'original',sourceText:'另一份来源。',comicFormat:'single_page',stylePreset:'shounen_bw'})).project;
 await assert.rejects(()=>visuals.uploadComicVisualCandidate(other.id,{...upload,requestKey:randomUUID()}),/设定对象不存在或不属于该漫画项目/);
 await assert.rejects(()=>visuals.uploadComicVisualCandidate(project.id,{...upload,requestKey:randomUUID(),mimeType:'image/jpeg'}),/图片内容与声明格式不一致/);
});

test('comic visual asset HTTP routes preserve envelopes, exact bytes and explicit adoption',async t=>{
 await isolatedDatabase(t,[
  {id:'109_comic_projects',fileName:'109_comic_projects.sql'},
  {id:'112_comic_bibles',fileName:'112_comic_bibles.sql'},
  {id:'114_comic_visual_assets',fileName:'114_comic_visual_assets.sql'},
 ]);
 const projects=compiled('server/database/comicProjects');
 const bibles=compiled('server/database/comicBibles');
 const project=(await projects.createComicProject({requestKey:randomUUID(),title:'视觉接口测试',sourceType:'original',sourceText:'夜雨。',comicFormat:'webtoon',stylePreset:'webtoon_color'})).project;
 const proposed=await bibles.proposeComicBible(project.id,{kind:'character',requestKey:randomUUID(),expectedRevision:0,content:{name:'林青',gender:'female',persona:'侦探',visualAnchor:'蓝色雨衣'}});
 const adopted=await bibles.adoptComicBible(project.id,proposed.entity.id,{requestKey:randomUUID(),versionId:proposed.version.id,expectedRevision:0});
 const {comicVisualAssetsRouter}=compiled('server/http/comicVisualAssets');
 const app=express();app.use(express.json({limit:'15mb'}));app.use('/api/new-design',comicVisualAssetsRouter());app.use((error,_req,res,_next)=>res.status(error.status??500).json({success:false,error:error.message}));
 const server=await new Promise((resolve,reject)=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));value.once('error',reject);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin=`http://127.0.0.1:${server.address().port}/api/new-design/comic/projects/${project.id}`;
 const upload={requestKey:randomUUID(),bibleEntityId:adopted.entity.id,assetId:null,expectedRevision:null,assetType:'portrait',name:'基础肖像',description:'正面锚点',filename:'portrait.png',mimeType:'image/png',base64:pngBase64};
 const createdResponse=await fetch(`${origin}/visual-assets`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(upload)});
 assert.equal(createdResponse.status,201);const created=await createdResponse.json();assert.equal(created.success,true);assert.equal(created.data.asset.adoptedVersionId,null);
 const workspace=await (await fetch(`${origin}/visual-assets?bibleEntityId=${adopted.entity.id}`)).json();assert.equal(workspace.success,true);assert.equal(workspace.data.assets.length,1);assert.equal(JSON.stringify(workspace).includes(pngBase64),false);
 const content=await fetch(`${origin}/visual-assets/${created.data.asset.id}/versions/${created.data.version.id}/content`);assert.equal(content.status,200);assert.equal(content.headers.get('content-type'),'image/png');assert.match(content.headers.get('cache-control'),/immutable/);assert.deepEqual(Buffer.from(await content.arrayBuffer()),Buffer.from(pngBase64,'base64'));
 const original=await (await fetch(`${origin}/visual-asset-requests/${upload.requestKey}`)).json();assert.equal(original.data.version.id,created.data.version.id);assert.equal(original.data.repeated,true);
 const adoptionInput={requestKey:randomUUID(),versionId:created.data.version.id,expectedRevision:0};const adoptionResponse=await fetch(`${origin}/visual-assets/${created.data.asset.id}/adoptions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(adoptionInput)});assert.equal(adoptionResponse.status,201);const adoption=await adoptionResponse.json();assert.equal(adoption.data.adoptedVersionId,created.data.version.id);
 const adoptionOriginal=await (await fetch(`${origin}/visual-asset-adoptions/${adoptionInput.requestKey}`)).json();assert.equal(adoptionOriginal.data.adoptedVersionId,created.data.version.id);assert.equal(adoptionOriginal.data.repeated,true);
});
