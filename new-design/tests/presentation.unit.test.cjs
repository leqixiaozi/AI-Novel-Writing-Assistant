const test=require("node:test");
const assert=require("node:assert/strict");
const {publicServiceError,publishedProposalFields,unknownProposalFieldCount,runtimeLabel}=require("../dist/common/presentation");

test("technical service failures stay out of ordinary copy while validation messages survive",()=>{
 const raw='docker build failed: registry EOF /private/path';
 assert.doesNotMatch(publicServiceError(raw,500),/docker|EOF|private/);
 assert.doesNotMatch(publicServiceError(raw,502),/docker|EOF|private/);
 assert.equal(publicServiceError("姓名不能为空。",422),"姓名不能为空。");
 assert.equal(publicServiceError("资料修订冲突，草稿保留。",409),"资料修订冲突，草稿保留。");
});

test("proposal fields come from the exact published pointer, never an unconfirmed draft",()=>{
 const fields=[{key:"name",name:"姓名"}],versions=[{id:"old",fields:[]},{id:"current",fields}];
 assert.equal(publishedProposalFields({status:"published",currentVersionId:"current",draftFields:[{key:"secret"}]},versions),fields);
 assert.equal(publishedProposalFields({status:"draft",currentVersionId:"current"},versions),null);
 assert.equal(publishedProposalFields({status:"published",currentVersionId:"missing"},versions),null);
 assert.equal(unknownProposalFieldCount(fields,{name:"作者填写",removed:"保留待复核"}),1);
});

test("fixed runtime labels do not leak unknown technical keys or change internal identities",()=>{
 assert.equal(runtimeLabel("embedding.generate"),"参考向量生成");
 assert.equal(runtimeLabel("partial"),"部分完成");
 assert.equal(runtimeLabel("new.internal.key"),"待确认");
});
