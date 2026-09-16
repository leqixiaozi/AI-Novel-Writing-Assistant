const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const routing = require("../dist/common/modelRouting");
const source = fs.readFileSync(path.join(__dirname, "../src/client/modelSettings/editing.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exportsObject = {};
new Function("require", "exports", compiled)(name => { assert.equal(name, "../../common/modelRouting"); return routing; }, exportsObject);
const editing = exportsObject;
const settings = {primary:{provider:"ollama",endpoint:"http://127.0.0.1:11434",model:"test",credentialId:null},fallbacks:[],policy:{...routing.DEFAULT_MODEL_POLICY}};
function route(scope="system_default", taskType=null, current=settings) {return {id:scope,scope,taskType,name:"模型设置",revision:4,current:{...current,id:"current",version:4},published:{...current,id:"published",version:3},editable:true,configurationIssue:null};}
function catalog(routes=[route()]) {return {routes,credentials:[],tasks:routing.MODEL_TASKS,environmentReferences:[]};}

test("six Chinese tasks and absent task settings inherit defaults without copying persisted facts", () => {
  assert.equal(routing.MODEL_TASKS.length,6);
  const value=catalog();
  assert.equal(editing.selectedRoute(value,"form_assist"),null);
  const draft=editing.initialSettings(value,"form_assist");
  draft.primary.model="changed";
  assert.equal(value.routes[0].published.primary.model,"test");
  assert.equal(editing.selectedRoute(catalog([route(),route("task","form_assist")]),"form_assist").scope,"task");
});
test("read-only verification compares active settings rather than draft versions", () => {
  const value=catalog();value.routes[0].current={...settings,primary:{...settings.primary,model:"draft-only"},id:"new",version:5};
  const matching=editing.recoveryComparison(value,"default",settings,"save");
  assert.equal(matching.matches,true);assert.match(matching.message,/回执仍未确认/);
  const changed={...settings,primary:{...settings.primary,model:"not-saved"}};
  assert.equal(editing.recoveryComparison(value,"default",changed,"save").matches,false);
  assert.equal(changed.primary.model,"not-saved");
});
test("inheritance is confirmed only when task override no longer exists", () => {
  assert.equal(editing.recoveryComparison(catalog(),"form_assist",settings,"inherit").matches,true);
  assert.equal(editing.recoveryComparison(catalog([route(),route("task","form_assist")]),"form_assist",settings,"inherit").matches,false);
});
test("difference explanation covers fallback ordering, credentials and policy in Chinese", () => {
  const a={...settings,fallbacks:[{...settings.primary,model:"a",failureCategories:["timeout"]},{...settings.primary,model:"b",failureCategories:["transport"]}]};
  const b={...a,primary:{...a.primary,credentialId:"new"},fallbacks:[...a.fallbacks].reverse(),policy:{...a.policy,maxRetries:2}};
  assert.deepEqual(editing.settingsDifferences(a,b),["凭据引用","备用模型及顺序","重试次数"]);
  assert.deepEqual(editing.settingsDifferences(settings,{...settings,primary:{...settings.primary,endpoint:settings.primary.endpoint+"/"}}),[]);
});
test("model page retains Chinese recovery controls, no credential secret input or local storage", () => {
  const page=fs.readFileSync(path.join(__dirname,"../src/client/modelSettings/index.tsx"),"utf8");
  assert.match(page,/保留我的设置，按最新修订继续/);assert.match(page,/保存成功后的目录刷新/);assert.match(page,/replaceUnsupported/);
  assert.doesNotMatch(page,/localStorage|type="password"|apiKey|secretLocator/);
  const connection=fs.readFileSync(path.join(__dirname,"../src/client/modelSettings/ConnectionEditor.tsx"),"utf8");
  assert.match(connection,/不会自动选择/);assert.doesNotMatch(connection,/models\[0\]/);
});
