const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const source=fs.readFileSync(path.join(__dirname,"../src/client/promptComposition/editing.ts"),"utf8");
const moduleExports={};new Function("exports",ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(moduleExports);
const edit=moduleExports;
function catalog(){return{recipes:[],books:[{id:"book",spaceId:"book-space"}],types:[{id:"owned",spaceId:"book-space",status:"published"},{id:"foreign",spaceId:"other",status:"published"}],prompts:{organization:{groups:[{id:"category",parentId:null,name:"任务指令",status:"active",sortOrder:1}],memberships:[]},primaryGroups:{component:"category"},components:[{id:"component",title:"场景要求",values:{enabled:true},currentVersionId:"exact-v1"}]}};}
test("composition settings store references and preserve order/enable/exact versions",()=>{const original={...edit.emptyRecipe(),name:"中文组合",components:[{cardId:"component",versionId:"exact-v1",enabled:false}],variables:[{key:"variable",label:"口吻",type:"select",options:["克制"],defaultValue:"克制"}]};const copy=edit.copyDraft(original);assert.equal(edit.sameComposition(original,copy),true);copy.components[0].enabled=true;copy.variables[0].options.push("轻快");assert.equal(original.components[0].enabled,false);assert.equal(original.variables[0].options.length,1);assert.equal(edit.sameComposition(original,copy),false);assert.equal("content"in original.components[0],false);});
test("classified picker references same prompt catalog and selected book filters schema types",()=>{const value=catalog(),nodes=edit.pickerNodes(value);assert.equal(nodes.find(node=>node.id==="component").parentId,"group:category");assert.equal(nodes.find(node=>node.id==="component").name,"场景要求");assert.deepEqual(edit.bookTypes(value,"book").map(type=>type.id),["owned"]);assert.deepEqual(edit.bookTypes(value,null),[]);});
test("saved recipe comparisons do not guess identity from name alone",()=>{const value=catalog(),draft={...edit.emptyRecipe(),name:"同名组合"};value.recipes=[{...draft,id:"a"},{...draft,id:"b",taskType:"directions"}];assert.deepEqual(edit.matchingSavedRecipes(value,{...draft,id:null}).map(item=>item.id),["a"]);assert.deepEqual(edit.matchingSavedRecipes(value,{...draft,id:"missing"}),[]);});
test("Chinese parameters use eight stable analysis keys and no author JSON input",()=>{const params=fs.readFileSync(path.join(__dirname,"../src/client/promptComposition/Parameters.tsx"),"utf8");assert.match(params,/story_structure/);assert.match(params,/hooks_payoffs/);assert.match(params,/rankingSnapshotIds/);assert.doesNotMatch(params,/JSON\.parse|JSON\.stringify/);const page=fs.readFileSync(path.join(__dirname,"../src/client/promptComposition/index.tsx"),"utf8");assert.match(page,/getCompositionRecipeByRequest/);assert.match(page,/getCompositionPreviewByRequest/);assert.match(page,/按原请求标识明确重试/);assert.match(page,/setPreviewFresh\(false\)/);assert.doesNotMatch(page,/localStorage|type="password"|JSON\.parse/);});
test("result is read-only and technical schema/JSON is folded",()=>{const page=fs.readFileSync(path.join(__dirname,"../src/client/promptComposition/PreviewResult.tsx"),"utf8");assert.match(page,/不会采用为小说资料、规划或正文/);assert.match(page,/<details><summary>输出规格与冻结凭证/);assert.doesNotMatch(page,/createCard|applyPlanning|adoptChapter|saveFormInstance/);});
function extractedFunctions(filename,names,bindings={}){
  const text=fs.readFileSync(path.join(__dirname,filename),"utf8"),tree=ts.createSourceFile(filename,text,ts.ScriptTarget.Latest,true);
  const statements=tree.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text)).map(node=>node.getText(tree));
  assert.equal(statements.length,names.length);const output={};
  new Function("exports",...Object.keys(bindings),ts.transpileModule(statements.join("\n"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(output,...Object.values(bindings));
  return output;
}
test("recovery whitelist accepts only fixed model/maintenance/composition routes and strict preview UUID",()=>{
  const route="/new-design/resources/ai/prompt-composition",professional=require('../dist/common/professionalResources').PROFESSIONAL_ROUTE,helpers=extractedFunctions("../src/client/api.ts",["safeRecoveryTarget","isGlobalModelRecovery"],{COMPOSITION_ROUTE:route,PROFESSIONAL_ROUTE:professional});
  const candidate={failedStep:"核对引用版本",summary:"引用需重新预览",savedResult:"草稿保留",sourceRoute:route,actionLabel:"返回提示词组合"};
  assert.ok(helpers.safeRecoveryTarget(candidate));assert.equal(helpers.isGlobalModelRecovery(candidate),false);
  const uuid="21cd93bc-886d-4769-b5e7-2cfcaf859317";
  assert.ok(helpers.safeRecoveryTarget({...candidate,sourceRoute:route+"?previewId="+uuid}));
  for(const sourceRoute of [route+"?previewId=bad",route+"?previewId="+uuid+"&next=evil",route+"?previewId="+uuid+"#evil",route+"/../books",route+"?other="+uuid,"https://evil.example","javascript:alert(1)","//evil.example"]){assert.equal(helpers.safeRecoveryTarget({...candidate,sourceRoute}),null);}
  assert.equal(helpers.safeRecoveryTarget({...candidate,actionLabel:"任意动作"}),null);
  const model={...candidate,sourceRoute:"/new-design/structure/models",actionLabel:"打开模型设置"};assert.ok(helpers.safeRecoveryTarget(model));assert.equal(helpers.isGlobalModelRecovery(model),true);
  assert.ok(helpers.safeRecoveryTarget({...candidate,sourceRoute:professional,actionLabel:'返回专业创作资源'}));
  assert.equal(helpers.safeRecoveryTarget({...candidate,sourceRoute:professional+'?next=evil',actionLabel:'返回专业创作资源'}),null);
  assert.equal(helpers.safeRecoveryTarget({...candidate,savedResult:3}),null);
});
test("unknown model submissions remain read-only and successful partial reads are retained",()=>{
  const page=fs.readFileSync(path.join(__dirname,"../src/client/promptComposition/index.tsx"),"utf8");
  assert.match(page,/pending.kind!=="run"&&pending.checked/);assert.match(page,/提交状态未知，不能断言原请求未执行/);
  assert.match(page,/Promise.allSettled/);assert.match(page,/if\(output\)setResult\(output\)/);assert.match(page,/recovery.savedResult/);assert.match(page,/compositionFieldLabel\(key\)/);
  const api=fs.readFileSync(path.join(__dirname,"../src/client/api.ts"),"utf8");assert.match(api,/recovery&&isGlobalModelRecovery\(recovery\)/);
  const css=fs.readFileSync(path.join(__dirname,"../src/client/promptComposition/composition.css"),"utf8");assert.match(css,/textarea \{ font-size: 16px/);
  assert.equal(edit.compositionFieldLabel("parameters.rankingSnapshotIds.0"),"已采集榜单");assert.equal(edit.compositionFieldLabel("parameters.direction.centralConflict"),"主要冲突");
});
test("ordinary result enums use Chinese labels while prose remains unchanged",()=>{
  const labels=extractedFunctions("../src/client/promptComposition/PreviewResult.tsx",["outputChoiceLabel"],{ANALYSIS_DIMENSIONS:[{key:"story_structure",label:"故事结构"}]}),value=catalog();value.types[0].fields=[{key:"motivation",name:"人物动机"}];value.types[1].fields=[];
  assert.equal(labels.outputChoiceLabel("status","running",value),"处理中");assert.equal(labels.outputChoiceLabel("key","story_structure",value),"故事结构");assert.equal(labels.outputChoiceLabel("fieldKey","motivation",value),"人物动机");assert.equal(labels.outputChoiceLabel("platforms","jinjiang",value),"晋江");
  assert.equal(labels.outputChoiceLabel("summary","running in the night",value),null);assert.match(labels.outputChoiceLabel("status","future_state",value),/选项需复核/);
});
