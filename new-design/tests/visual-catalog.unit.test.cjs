const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');

const bookId='67000000-0000-4000-8000-000000000001';
const assetId='67000000-0000-4000-8000-000000000002';
const versionId='67000000-0000-4000-8000-000000000003';

test('visual catalog accepts bounded read filters and keeps exact book ownership',()=>{
 const {visualCatalogQuerySchema,visualCatalogAssetRoute}=require('../dist/common/visualAssets');
 assert.deepEqual(visualCatalogQuerySchema.parse({}),{query:'',kind:'all',source:'all',offset:0,limit:30});
 assert.deepEqual(visualCatalogQuerySchema.parse({query:'  封面  ',kind:'cover',source:'ai_generated',offset:'30',limit:'40'}),{query:'封面',kind:'cover',source:'ai_generated',offset:30,limit:40});
 for(const input of [{kind:'world'},{source:'external_url'},{offset:'-1'},{limit:'0'},{limit:'101'},{query:'a'.repeat(121)}])assert.equal(visualCatalogQuerySchema.safeParse(input).success,false);
 assert.equal(visualCatalogAssetRoute(bookId,assetId,versionId),`/new-design/books/${bookId}/visual-assets?asset=${assetId}&version=${versionId}`);
});

test('global visual catalog reads active books and assets without writing or substituting versions',async()=>{
 const {getVisualCatalog,withVisualAssetsPool}=require('../dist/server/database/visualAssets');
 const calls=[];
 const pool={async query(sql,params){calls.push({sql,params});if(/^\s*SELECT count\(\*\) total\b/i.test(sql))return {rows:[{total:'1'}]};return {rows:[{asset_id:assetId,book_id:bookId,book_name:'原书',title:'封面',asset_kind:'cover',current_version_id:null,updated_at:new Date('2026-09-20T00:00:00Z'),version_count:'2',version_id:versionId,version_number:2,version_title:'候选封面',source_kind:'ai_generated',description:'待作者审阅',display_filename:'封面.png',checksum:'a'.repeat(64),byte_size:'128',mime_type:'image/png',storage_kind:'managed_file',storage_provider:'local',storage_locator:`visual-assets/visual-${'a'.repeat(64)}.png`,integrity_state:'verified',version_created_at:new Date('2026-09-19T00:00:00Z')}]};}};
 const result=await withVisualAssetsPool(pool,()=>getVisualCatalog({query:'封面',kind:'cover',source:'ai_generated',offset:0,limit:30}));
 assert.equal(result.total,1);assert.equal(result.nextOffset,null);assert.equal(result.items[0].bookId,bookId);assert.equal(result.items[0].assetId,assetId);assert.equal(result.items[0].version.id,versionId);assert.equal(result.items[0].sourceKind,'ai_generated');assert.equal(result.items[0].adopted,false);
 assert.equal(calls.length,2);assert.ok(calls.every(call=>/^\s*SELECT\b/i.test(call.sql)));
 assert.ok(calls.every(call=>/a\.status='active'/.test(call.sql)&&/b\.status='active'/.test(call.sql)));
 assert.ok(calls.every(call=>call.params.includes('封面')));
 assert.ok(calls.every(call=>call.params.includes('ai_generated')&&/v\.source_kind/.test(call.sql)));
});

test('visual catalog does not offer a looping next page if a concurrent change empties the page',async()=>{
 const {getVisualCatalog,withVisualAssetsPool}=require('../dist/server/database/visualAssets');
 const pool={async query(sql){return /^\s*SELECT count\(\*\) total\b/i.test(sql)?{rows:[{total:'3'}]}:{rows:[]};}};
 const result=await withVisualAssetsPool(pool,()=>getVisualCatalog({query:'',kind:'all',source:'all',offset:0,limit:2}));
 assert.equal(result.nextOffset,null);
});

test('visual catalog page exposes search, type filter, exact preview and original book action',()=>{
 const file=path.join(__dirname,'../src/client/visualCatalog/VisualCatalogPage.tsx');
 assert.ok(fs.existsSync(file),'视觉资源库应有独立页面');
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};
 const load=name=>{
  if(name==='react'||name==='react/jsx-runtime')return require(name);
  if(name==='../ResourceShell')return {default:({children})=>React.createElement(React.Fragment,null,children)};
  if(name==='../api')return {newDesignApi:{getVisualCatalog:async()=>({items:[],total:0,nextOffset:null}),visualImageUrl:()=>'/image'}};
  if(name==='../../common/visualAssets')return {visualCatalogAssetRoute:(book,asset,version)=>`/new-design/books/${book}/visual-assets?asset=${asset}&version=${version}`};
  if(name.endsWith('.css'))return {};
  throw new Error(`Unexpected dependency: ${name}`);
 };
 new Function('require','exports',source)(load,exports);
 const html=renderToStaticMarkup(React.createElement(exports.VisualCatalogContent,{items:[{assetId,bookId,bookName:'原书',title:'封面',kind:'cover',sourceKind:'ai_generated',version:{id:versionId,title:'候选封面',description:'待作者审阅',readable:true,version:2,createdAt:'2026-09-20T00:00:00Z'},adopted:false,versionCount:2,updatedAt:'2026-09-20T00:00:00Z'}],total:1,loading:false,error:'',query:'',kind:'all',source:'all',onQuery:()=>{},onKind:()=>{},onSource:()=>{},onSearch:()=>{},onMore:()=>{},onReload:()=>{},nextOffset:null,imageUrl:()=>'/image'}));
 assert.match(html,/搜索视觉素材/);assert.match(html,/来源/);assert.match(html,/AI 生成/);assert.match(html,/封面/);assert.match(html,/原书/);assert.match(html,/候选版本/);assert.match(html,/打开原书图片工作台/);assert.match(html,new RegExp(`asset=${assetId}&amp;version=${versionId}`));
});

test('independent visual catalog is wired into resource routes and navigation',()=>{
 const root=path.join(__dirname,'../src/client');
 assert.match(fs.readFileSync(path.join(root,'NewDesignPage.tsx'),'utf8'),/\/new-design\/resources\/visual-assets/);
 assert.match(fs.readFileSync(path.join(root,'ResourceShell.tsx'),'utf8'),/视觉资源库/);
 assert.match(fs.readFileSync(path.join(root,'resourceBrowser/catalog.ts'),'utf8'),/visual-assets/);
 assert.match(fs.readFileSync(path.join(__dirname,'../src/server/http/visualAssets/index.ts'),'utf8'),/visual-assets\/catalog/);
});
