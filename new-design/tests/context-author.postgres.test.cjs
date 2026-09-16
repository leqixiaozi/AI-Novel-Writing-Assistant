const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),express=require('express');
const runtime=require('../dist/server/database/runtime'),store=require('../dist/server/database/store'),templates=require('../dist/server/database/templateStore');
const {createNewDesignRouter}=require('../dist/server/http/router');
test('author catalogue API isolates book sources and saves selected exact versions',{skip:process.env.AI_NOVEL_NEW_DESIGN_DEV_RUNTIME!=='1',timeout:60000},async t=>{
 const pool=await runtime.getNewDesignPool(),books=[];let server;
 t.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));for(const book of books)await pool.query("UPDATE new_design.books SET status='archived' WHERE id=$1",[book.id]);await pool.end();});
 const token=randomUUID().slice(0,12),template=(await pool.query('SELECT id FROM new_design.template_group_versions ORDER BY created_at LIMIT 1')).rows[0];
 for(let i=0;i<2;i++)books.push(await templates.createBook({key:`context_${token}_${i}`,name:`上下文验证-${token}-${i}`,description:'独立验证用书，非作者作品',templateVersionId:template.id}));
 const cards=[];
 for(const [i,book] of books.entries()){
  let type=await store.createCardType({key:`context_${token}`,name:'上下文验证资料',description:'',semanticCapabilities:[],fields:[]},book.spaceId);type=await store.publishCardType(type.id,type.revision);cards.push(await store.createCard({spaceId:book.spaceId,cardTypeId:type.id,title:`本书独立资料${i}`,values:{}}));
 }
 const app=express();app.use(express.json());app.use('/api/new-design',createNewDesignRouter());server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${server.address().port}/api/new-design`;
 const api=async(path,method='GET',input)=>{const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:input?JSON.stringify(input):undefined});return {status:response.status,...await response.json()};};
 const response=await api(`/books/${books[0].id}/context-author-catalog`);assert.equal(response.status,200,JSON.stringify(response));const catalog=response.data,source=catalog.sources.find(s=>s.stableId===cards[0].id);
 assert.ok(source);assert.ok(source.versionId);assert.equal(source.label,'本书独立资料0');assert.equal(catalog.sources.some(s=>s.stableId===cards[1].id),false);assert.equal(new Set(catalog.slots.map(s=>s.id)).size,catalog.slots.length);assert.ok(catalog.tasks.length);
 assert.equal((await api(`/books/${randomUUID()}/context-author-catalog`)).status,404);
 const input={bindingKey:`book.verify_${token}`,name:'中文选择的资料规则',description:'',scopeKind:'book',scopeRef:null,bookId:books[0].id,spaceId:null,inheritanceMode:'inherit',activationRule:{kind:'group',operator:'and',items:[]},slotKey:catalog.slots[0]?.id??'book_context',priority:500,contentRole:'reference',tokenBudget:6000,trimStrategy:'lowest_priority',dedupeStrategy:'stable_source',selectors:[{sortOrder:0,selectorKind:'explicit_source',sourceType:'card_version',stableObjectId:source.stableId,exactVersionId:source.versionId,config:{}}],idempotencyKey:`context-${token}`,createdBy:'user'};
 const saved=await api('/context-bindings','POST',input);assert.equal(saved.status,201,JSON.stringify(saved));assert.equal(saved.data.currentVersion.selectors[0].exactVersionId,source.versionId);
 const retry=await api('/context-bindings','POST',input);assert.equal(retry.status,201,JSON.stringify(retry));assert.equal(retry.data.id,saved.data.id);
 await pool.query("UPDATE new_design.books SET status='archived' WHERE id=$1",[books[1].id]);assert.equal((await api(`/books/${books[1].id}/context-author-catalog`)).status,409);
 console.log('context_catalogue_verified_book',books[0].id,'exact_source_version',source.versionId);
});
