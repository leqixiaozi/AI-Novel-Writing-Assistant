const test=require("node:test");
const assert=require("node:assert/strict");
const {locateTypeIssues,typeFieldIssuePaths,confirmedPublicationVersion}=require("../dist/common/typeEditing");
const fields=[{key:"name",name:"人物姓名"},{key:"realm",name:"境界"}];

test("validation paths point to Chinese controls and indexed field definitions",()=>{
 const result=locateTypeIssues({name:"类型名称不能为空", "draftFields.1.options":"至少一个选项", "fields.0.name":"字段名称不能为空"},fields);
 assert.equal(result[0].target,"name");
 assert.equal(result[0].label,"类型名称");
 assert.equal(result[1].fieldKey,"realm");
 assert.equal(result[1].label,"字段“境界”");
 assert.equal(result[2].fieldKey,"name");
});

test("published-field policy paths locate stable keys without guessing from message text",()=>{
 const result=locateTypeIssues({realm:"不可修改已发布字段",form:"请检查提交内容","draftFields.999.name":"位置不存在", "draftFields.-1.name":"非法位置"},fields);
 assert.equal(result[0].fieldKey,"realm");
 assert.equal(result[1].target,null);
 assert.equal(result[2].target,"fields");
 assert.equal(result[3].target,"fields");
});

test("top-level property names win over fields sharing the same key",()=>{
 assert.equal(locateTypeIssues({name:"不能为空"},fields)[0].target,"name");
 assert.equal(locateTypeIssues({},fields).length,0);
 assert.equal(locateTypeIssues(typeFieldIssuePaths({name:"已发布字段不可更改"}),fields)[0].target,"field");
 assert.equal(locateTypeIssues(typeFieldIssuePaths({name:"已发布字段不可更改"}),fields)[0].label,"字段“人物姓名”");
});

test("lost publication receipt is confirmed only by a newer exact current immutable version",()=>{
 const submitted={id:"type-a",currentVersion:1,currentVersionId:"v1",draftFields:fields};
 const latest={...submitted,currentVersion:2,currentVersionId:"v2"};
 const version={id:"v2",cardTypeId:"type-a",version:2,fields};
 assert.equal(confirmedPublicationVersion(latest,submitted,[version]),version);
 assert.equal(confirmedPublicationVersion(latest,submitted,[{...version,fields:[]}]),null);
 assert.equal(confirmedPublicationVersion(latest,submitted,[{...version,id:"foreign-version"}]),null);
 assert.equal(confirmedPublicationVersion(submitted,submitted,[version]),null);
});
