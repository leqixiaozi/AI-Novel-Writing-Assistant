const test=require('node:test'),assert=require('node:assert/strict');
const {buildAuthorSelectors,replaceActivationChild}=require('../dist/common/contextAuthorEditing');
const {contextScopeChoices,contextChoiceLabel}=require('../dist/common/contextAuthor');

test('editing one source preserves additional sources and invisible configuration',()=>{
 const first={selectorKind:'relation',sourceType:'card_version',sortOrder:10,stableObjectId:null,exactVersionId:null,config:{relationTypeId:'old',anchorCardId:'anchor',direction:'incoming'}},tail={selectorKind:'tag',sourceType:'card_version',sortOrder:20,stableObjectId:null,exactVersionId:null,config:{tagId:'tag'}};
 const result=buildAuthorSelectors({selectors:[first,tail],selectorKind:'relation',selectorSourceType:'card_version',selectorPrimary:'new',selectorSecondary:'',selectorRangeEnd:100});
 assert.equal(result.length,2);assert.deepEqual(result[1],tail);assert.deepEqual(result[0].config,{relationTypeId:'new',anchorCardId:'anchor',direction:'incoming'});assert.equal(result[0].sortOrder,10);assert.equal(first.config.relationTypeId,'old');
});
test('nested activation editing and deletion do not flatten sibling groups',()=>{
 const nested={kind:'group',operator:'or',items:[{kind:'condition',field:'tag',operator:'in',value:['a','b']}]},rule={kind:'group',operator:'and',items:[{kind:'condition',field:'task_key',operator:'equals',value:'write'},nested]};
 const edited=replaceActivationChild(rule,0,{...rule.items[0],value:'repair'});assert.deepEqual(edited.items[1],nested);assert.equal(rule.items[0].value,'write');assert.deepEqual(replaceActivationChild(edited,0,null).items,[nested]);
});
test('one-time scope uses actual task nodes and missing labels hide identifiers',()=>{
 const c={tasks:[{id:'chapter.write',label:'章节写作'}],groups:[],scopes:[]};assert.deepEqual(contextScopeChoices(c,'one_time'),c.tasks);assert.equal(contextChoiceLabel([], 'private-uuid'),'已保存的选项（需复核）');
});
