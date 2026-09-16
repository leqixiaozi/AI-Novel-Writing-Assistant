const test=require('node:test');
const assert=require('node:assert/strict');
const {typeWriteFailure,publishTypeDraft,sameTypeDraft,reconcileTypeWrite}=require('../dist/common/typeEditing');
const draft={id:'type-a',key:'a',revision:2,name:'人物',description:'说明',categoryId:null,semanticCapabilities:[],draftFields:[{key:'name',name:'姓名',type:'short_text'}],currentVersion:1,currentVersionId:'v1',status:'published'};

test('validation can retry; conflict and uncertain receipts must be checked first',()=>{
 assert.equal(typeWriteFailure('save',422).needsReview,false);
 for(const status of [undefined,500,503,409]) assert.equal(typeWriteFailure('save',status).needsReview,true);
 assert.match(typeWriteFailure('publish',503).title,/发布版本.*待核对/);
 assert.match(typeWriteFailure('save',409).guidance,/对比/);
});
test('publishing modified inputs saves first and uses the returned revision',async()=>{
 const calls=[];
 const result=await publishTypeDraft({draft,needsSave:true,save:async current=>{calls.push('save');return {...current,revision:3};},publish:async(id,revision)=>{assert.equal(revision,3);calls.push('publish');return {...draft,revision:4,currentVersion:2};},confirmed:(type,step)=>calls.push(`confirmed:${step}`),attempting:step=>calls.push(`attempt:${step}`)});
 assert.equal(result.currentVersion,2);
 assert.deepEqual(calls,['attempt:save','save','confirmed:save','attempt:publish','publish','confirmed:publish']);
});
test('failed save stops publish and identifies the failed step',async()=>{
 let step,published=false;
 await assert.rejects(publishTypeDraft({draft,needsSave:true,save:async()=>{throw Error('姓名为空');},publish:async()=>{published=true;},confirmed:()=>{},attempting:current=>{step=current;}}));
 assert.equal(step,'save');assert.equal(published,false);
});
test('failed publish retains confirmed saved draft; no automatic retry',async()=>{
 let confirmed,step,calls=0;
 await assert.rejects(publishTypeDraft({draft,needsSave:true,save:async current=>({...current,revision:3}),publish:async()=>{calls++;throw Error('lost receipt');},confirmed:current=>{confirmed=current;},attempting:current=>{step=current;}}));
 assert.equal(step,'publish');assert.equal(confirmed.revision,3);assert.equal(calls,1);
});
test('confirmed publication survives subsequent read failure without repeating write',async()=>{
 let confirmed,calls=0;
 const result=await publishTypeDraft({draft,needsSave:false,save:async()=>{throw Error('unnecessary save');},publish:async()=>{calls++;return {...draft,currentVersion:2};},confirmed:current=>{confirmed=current;},attempting:()=>{}});
 await assert.rejects(Promise.reject(Error('version list unavailable')));
 assert.equal(confirmed.currentVersion,2);assert.equal(result.currentVersion,2);assert.equal(calls,1);
});
test('receipt verification preserves edits typed after submission',()=>{
 const current={...draft,name:'作者保留的新名字'};
 const saved={...draft,revision:3};
 assert.equal(reconcileTypeWrite(current,draft,saved).name,current.name);
 assert.equal(reconcileTypeWrite(current,draft,saved).revision,3);
 assert.equal(reconcileTypeWrite(draft,draft,saved),saved);
 assert.equal(sameTypeDraft(draft,{...draft,revision:99}),true);
 assert.equal(sameTypeDraft(draft,current),false);
});
