const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const runtime=require('../dist/server/database/runtime');
const ledger=require('../dist/server/database/payoffLedger');

const bookId='00000000-0000-4000-8000-000000000101';
const cardId='00000000-0000-4000-8000-000000000102';
const requestKey='00000000-0000-4000-8000-000000000103';
const timestamp=new Date('2026-01-01T00:00:00Z');
const fields=[{key:'status',type:'select',description:'作者侧的布置和回收进度',stateSettlement:'lifecycle'}];

async function withPool(pool,run){const original=runtime.getNewDesignPool;runtime.getNewDesignPool=async()=>pool;try{return await run();}finally{runtime.getNewDesignPool=original;}}

function projectionPool(formalChanges=[],scopedFields=[]){
  const queries=[];
  const client={query:async sql=>{
    queries.push(sql);
    if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK')return{rows:[]};
    if(sql.includes("to_regclass('new_design.payoff_window_versions')"))return{rows:[{installed:false}]};
    if(sql.includes("SELECT id FROM new_design.books"))return{rows:[{id:bookId}]};
    if(sql.includes('SELECT card.id,card.card_type_id,card.current_version_id'))return{rows:[{id:cardId,card_type_id:requestKey,current_version_id:requestKey,title:'灯下名字',values:{setup_content:'灯先亮',payoff_plan:'第十章回收',status:'paid_off'},type_fields:fields,draft_fields:fields,type_status:'published',settlement_capability:'optional',state_mode:'lifecycle',settlement_policy:null}]};
    if(sql.includes('SELECT reference.id,reference.card_id'))return{rows:[{id:requestKey,card_id:cardId,card_version_id:requestKey,action_key:'recover',note:'计划回收',object_id:requestKey,plan_title:'第2章',level:'chapter',plan_version_id:requestKey,logical_order:2}]};
    if(sql.includes('SELECT placement.id,placement.subject_card_id'))return{rows:[{id:requestKey,subject_card_id:cardId,role:'recover',chapter_title:'第1章',logical_order:1}]};
    if(sql.includes('SELECT change.id,change.subject_id'))return{rows:formalChanges};
    if(sql.includes('SELECT document.logical_order,EXISTS('))return{rows:[{logical_order:1,stable:true},{logical_order:2,stable:true},{logical_order:3,stable:true}]};
    if(sql.includes('SELECT definition.card_type_id,definition.card_id,version.field_schema'))return{rows:scopedFields};
    throw Error(`Unexpected payoff query: ${sql.slice(0,100)}`);
  },release:()=>{}};
  return{pool:{connect:async()=>client},queries};
}

test('author card, adopted plan and narrative placement do not prove recovery',async()=>{
  const {pool,queries}=projectionPool();
  const result=await withPool(pool,()=>ledger.getPayoffLedger(bookId));
  assert.equal(result.summary.paidOffCount,0);
  assert.equal(result.summary.overdueCount,1);
  assert.equal(result.items[0].status,'overdue');
  assert.equal(result.items[0].windowSource,'adopted_plan');
  assert.ok(result.items[0].sources.some(source=>source.kind==='narrative_placement'));
  const formalQuery=queries.find(sql=>sql.includes('SELECT change.id,change.subject_id'));
  assert.match(formalQuery,/settlement\.status='committed'/);
  assert.match(formalQuery,/checkpoint\.status='stable'/);
  assert.match(formalQuery,/document\.adopted_version_id=settlement\.body_version_id/);
});

test('a stable committed status change is the only recovery proof',async()=>{
  const {pool}=projectionPool([{id:requestKey,subject_id:cardId,after_json:'paid_off',sequence:1,state_key:'status',logical_order:2,settlement_id:requestKey}]);
  const result=await withPool(pool,()=>ledger.getPayoffLedger(bookId));
  assert.equal(result.summary.paidOffCount,1);
  assert.equal(result.summary.overdueCount,0);
  assert.equal(result.items[0].paidOffChapterOrder,2);
});

test('a published local status override controls settlement availability',async()=>{
  const {pool}=projectionPool([],[{card_type_id:requestKey,card_id:cardId,field_schema:{key:'status',type:'select',stateSettlement:'none'}}]);
  const result=await withPool(pool,()=>ledger.getPayoffLedger(bookId));
  assert.match(result.items[0].settlementUnavailableReason,/局部字段/);
  assert.equal(result.items[0].status,'overdue');
});

test('window retry reuses the original key and rejects changed payload',async()=>{
  let inserted=null,insertCount=0;
  const client={query:async(sql,params=[])=>{
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return{rows:[]};
    if(sql.includes("to_regclass('new_design.payoff_window_versions')"))return{rows:[{installed:true}]};
    if(sql.includes('SELECT card.id FROM new_design.books'))return{rows:[{id:cardId}]};
    if(sql.includes('SELECT * FROM new_design.payoff_window_versions'))return{rows:inserted?[inserted]:[]};
    if(sql.includes('SELECT revision FROM new_design.payoff_windows'))return{rows:[]};
    if(sql.includes('INSERT INTO new_design.payoff_window_versions')){
      insertCount++;
      inserted={id:params[0],book_id:bookId,card_id:cardId,version:1,start_chapter_order:2,end_chapter_order:4,idempotency_key:requestKey,created_at:timestamp};
      return{rows:[inserted]};
    }
    if(sql.includes('INSERT INTO new_design.payoff_windows'))return{rows:[]};
    throw Error(`Unexpected window query: ${sql.slice(0,100)}`);
  },release:()=>{}};
  const input={startChapterOrder:2,endChapterOrder:4,expectedRevision:0,idempotencyKey:requestKey};
  await withPool({connect:async()=>client},async()=>{
    const first=await ledger.savePayoffWindow(bookId,cardId,input);
    const repeated=await ledger.savePayoffWindow(bookId,cardId,input);
    assert.equal(first.id,repeated.id);
    assert.equal(insertCount,1);
    await assert.rejects(ledger.savePayoffWindow(bookId,cardId,{...input,endChapterOrder:5}),error=>error.status===409);
  });
});

test('manual 107 has guarded immutable-version publication for foreshadow status and template',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../migrations/107_payoff_ledger_windows.sql'),'utf8');
  assert.match(sql,/target\.draft_fields IS DISTINCT FROM target\.fields/);
  assert.match(sql,/status_field - 'stateSettlement' <> \$status\$/);
  assert.match(sql,/"value":"paid_off","label":"已回收"/);
  assert.match(sql,/stateSettlement/);
  assert.match(sql,/INSERT INTO card_type_versions/);
  assert.match(sql,/INSERT INTO template_group_versions/);
  assert.match(sql,/IF TG_OP <> 'INSERT' THEN/);
  assert.match(sql,/BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(sql,/sourceVersionId/);
  assert.doesNotMatch(sql,/UPDATE card_type_versions SET/);
  assert.doesNotMatch(sql,/UPDATE cards SET/);
});
