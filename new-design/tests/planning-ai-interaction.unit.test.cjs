const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const read=name=>fs.readFileSync(path.join(__dirname,'../src/client/planningCenter',name),'utf8');
const page=read('PlanningCenterPage.tsx'),panel=read('AiPlanningPanel.tsx');

test('planning entry is not an auto-open AI form, including legacy query links',()=>{
 assert.match(page,/\[aiOpen,setAiOpen\]=useState\(false\)/);
 assert.doesNotMatch(page,/get\("ai"\)/);
 assert.doesNotMatch(page,/nd-ai-planning-state/);
 assert.equal((page.match(/<AiPlanningPanel\s/g)||[]).length,1);
 assert.match(page,/onClick=\{openAi\}[^>]*aria-haspopup="dialog"/);
});

test('modal uses native focus isolation, guarded Escape and restored trigger focus',()=>{
 assert.match(panel,/element\.showModal\(\)/);
 assert.match(panel,/onCancel=\{event=>\{event\.preventDefault\(\);if\(!busy\)onCancel\(\);\}\}/);
 assert.match(panel,/opener\.isConnected\)opener\.focus\(\{preventScroll:true\}\)/);
 assert.match(panel,/disabled=\{busy\|\|blocked\|\|!workspace\.aiCapability\.configured\}/);
 assert.match(panel,/failure&&<p[^>]*role="alert"/);
});

test('successful generation returns to the original candidate comparison without adoption',()=>{
 const start=page.indexOf('const generateWithAi='),end=page.indexOf('if(message&&!book)',start);
 const handler=page.slice(start,end);
 assert.match(handler,/sourceUnavailable\|\|writeUnknown\|\|dirty/);
 assert.match(handler,/await load\(run\.planningObjectId\)/);
 assert.match(handler,/setFocus\("all"\)/);
 assert.match(handler,/planning-versions-title/);
 assert.doesNotMatch(handler,/adoptPlanningVersion/);
 assert.doesNotMatch(panel,/setAiInstruction\(""\)/);
});

test('overview has exactly one full planning workspace action',()=>{
 const source=read('BookOverviewPage.tsx');
 const node=source.match(/<div className="nd-overview-actions">([\s\S]*?)<\/div>/)?.[1];
 assert.ok(node);
 assert.equal((node.match(/<a\s/g)||[]).length,1);
 assert.match(node,/打开规划工作台/);
 assert.doesNotMatch(node,/\?ai=/);
});

test('edited TSX files parse without syntax diagnostics',()=>{
 for(const name of ['PlanningCenterPage.tsx','AiPlanningPanel.tsx','BookOverviewPage.tsx']){
  const parsed=ts.createSourceFile(name,read(name),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  assert.deepEqual(parsed.parseDiagnostics,[],name);
 }
});
