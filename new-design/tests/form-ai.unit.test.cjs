const test=require("node:test");
const assert=require("node:assert/strict");
const {aiFormFields,validateFormCandidate,validateFormDraft,formAiRequestSchema}=require("../dist/server/domain/formAssist");
const {formHash}=require("../dist/server/database/formAssist/context");
const uuid="10000000-0000-4000-8000-000000000001";
const fields=[{key:"name",name:"人物姓名",description:"",type:"short_text",required:true,defaultValue:null,options:[],group:"身份",order:1},
  {key:"age",name:"年龄",description:"",type:"number",required:false,defaultValue:null,options:[],group:"身份",order:2},
  {key:"secret",name:"内部限制",description:"",type:"short_text",required:false,defaultValue:null,options:[],group:"限制",order:3,hidden:true},
  {key:"fixed",name:"不接受AI建议",description:"",type:"short_text",required:false,defaultValue:null,options:[],group:"限制",order:4,aiSuggestible:false}];
const rule={mode:"single",rootNodeId:"branch",depthMode:"direct_children",relativeDepth:null,leafOnly:true,allowParentSelection:false,showFullPath:true,allowInlineCreate:true,aiSuggestible:true,minSelections:0,maxSelections:1};
const nodes=[{id:"root",parentId:null,name:"世界",status:"active",revision:1,path:["世界"]},{id:"branch",parentId:"root",name:"本宗",status:"active",revision:1,path:["世界","本宗"]},{id:"allowed",parentId:"branch",name:"内门",status:"active",revision:1,path:["世界","本宗","内门"]},{id:"outside",parentId:"root",name:"其他",status:"active",revision:1,path:["世界","其他"]},{id:"archived",parentId:"branch",name:"停用",status:"archived",revision:1,path:["世界","本宗","停用"]}];
const snapshot={target:{bookId:uuid,cardTypeId:uuid,cardId:uuid,typeVersionId:uuid,cardRevision:1,formVersionId:null,title:"测试人物"},fields,localFieldKeys:[],values:{name:"人工姓名"},tagIds:[],trees:[],relations:[],sourceHash:"a".repeat(64)};
test("AI form requests preserve typed target ownership and idempotency",()=>{
 const base={target:snapshot.target,action:"fill_empty",instruction:"填写空白项",values:snapshot.values,tagIds:[],fieldKeys:[],idempotencyKey:"form-request-1"};
 assert.equal(formAiRequestSchema.safeParse(base).success,true);
 assert.equal(formAiRequestSchema.safeParse({...base,idempotencyKey:""}).success,false);
 assert.equal(formAiRequestSchema.safeParse({...base,target:{...base.target,cardRevision:null}}).success,false);
});
test("AI whitelist excludes hidden/disabled fields and fill empty cannot replace a human draft",()=>{
 assert.deepEqual(aiFormFields(snapshot,"fill_empty",[]).map(field=>field.key),["age"]);
 assert.match(validateFormCandidate(snapshot,{id:uuid,name:"建议",values:{name:"AI姓名"},tags:{}},"fill_empty").name,/已有内容/);
 assert.ok(validateFormCandidate(snapshot,{id:uuid,name:"建议",values:{age:"十八",fixed:"改写",secret:"越界",other:true},tags:{}},"supplement").age);
 assert.ok(validateFormCandidate(snapshot,{id:uuid,name:"建议",values:{fixed:"改写"},tags:{}},"supplement").fixed);
 assert.deepEqual(validateFormDraft(snapshot,{age:18}),{}); // Incomplete ordinary draft is allowed before normal strict save.
 assert.deepEqual(aiFormFields(snapshot,"check",[]).map(field=>field.key),["__observations"]);
});
test("AI dictionary and tag suggestions obey current branches/status/counts and expose Chinese paths",()=>{
 const field={...fields[0],key:"role",name:"宗门定位",type:"select",required:false,optionSource:{kind:"dictionary_tree",dictionaryId:uuid,rule}};
 const context={...snapshot,fields:[field],values:{},trees:[{kind:"dictionary",key:"role",name:"人物定位",sourceId:uuid,scope:"book",revision:1,rule,nodes},{kind:"tag",key:"dimension",name:"故事职责",sourceId:uuid,scope:"book",revision:1,rule,nodes}]};
 assert.deepEqual(aiFormFields(context,"recommend",[]).find(field=>field.key==="role").options,[{value:"allowed",label:"世界 / 本宗 / 内门"}]);
 assert.deepEqual(validateFormCandidate(context,{id:uuid,name:"建议",values:{role:"allowed"},tags:{dimension:["allowed"]}},"recommend"),{});
 for(const value of ["outside","archived","branch"])assert.ok(validateFormCandidate(context,{id:uuid,name:"建议",values:{role:value},tags:{dimension:[value]}},"recommend").role);
 assert.ok(validateFormCandidate(context,{id:uuid,name:"建议",values:{},tags:{dimension:["allowed","outside"]}},"recommend").dimension);
});
test("source hashes ignore object key order but preserve revisions and draft values",()=>{
 assert.equal(formHash({b:2,a:1}),formHash({a:1,b:2}));
 assert.notEqual(formHash({revision:1}),formHash({revision:2}));
});
test("conditionally invisible fields cannot become AI candidates",()=>{
 const context={...snapshot,fields:[{...fields[1],visibleWhen:{fieldKey:"name",operator:"equals",value:"另一个人"}}]};
 assert.deepEqual(aiFormFields(context,"supplement",[]),[]);
 assert.ok(validateFormCandidate(context,{id:uuid,name:"建议",values:{age:20},tags:{}},"supplement").age);
});
