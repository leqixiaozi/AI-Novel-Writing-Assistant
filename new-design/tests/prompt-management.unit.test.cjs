const test=require('node:test'),assert=require('node:assert/strict');
const {promptCategoryDescendants}=require('../dist/common/promptManagement');
test('prompt category scope includes active descendants without looping or merging unrelated branches',()=>{
 const groups=[{id:'root',parentId:null,status:'active'},{id:'child',parentId:'root',status:'active'},{id:'grandchild',parentId:'child',status:'active'},{id:'archived',parentId:'root',status:'archived'},{id:'other',parentId:null,status:'active'}];
 assert.deepEqual([...promptCategoryDescendants(groups,'root')].sort(),['child','grandchild','root']);
 assert.equal(promptCategoryDescendants([{id:'a',parentId:'b',status:'active'},{id:'b',parentId:'a',status:'active'}],'a').size,2);
});
