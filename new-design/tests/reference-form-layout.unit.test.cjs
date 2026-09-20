const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file,mocks={}){
 const output={};new Function('require','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>{if(name in mocks)return mocks[name];throw Error(`Unexpected dependency: ${name}`);},output);return output;
}
const presentation=load('src/common/formPresentation/index.ts');
const field=(key,group,extras={})=>({key,name:key,description:'',type:'short_text',required:false,options:[],defaultValue:null,order:0,group,...extras});
test('cast grouping uses the published structured role, never a title or free text guess',()=>{
 const role=field('story_role','基本信息',{type:'select',options:[{value:'protagonist',label:'主角'},{value:'supporting',label:'配角'}]});
 const card={title:'反派主角导师',values:{story_role:'protagonist'},typeFields:[role]};
 assert.equal(presentation.castSection(card),'protagonists');
 assert.equal(presentation.castSection({...card,values:{story_role:'supporting'}}),'supporting');
 assert.equal(presentation.castSection({...card,values:{story_role:'主角'}}),'unspecified');
 assert.equal(presentation.castSection({...card,typeFields:[{...role,type:'short_text'}]}),'unspecified');
 assert.equal(presentation.castSection({...card,typeFields:[{...role,optionSource:{kind:'dictionary_tree'}}]}),'unspecified');
});
test('unknown groups stay editable in the profile; display retains zero and false',()=>{
 assert.equal(presentation.fieldInCharacterSection(field('extra','自定义成长'),'profile'),true);
 assert.equal(presentation.fieldInCharacterSection(field('appearance','外在表现'),'visible'),true);
 assert.equal(presentation.fieldDisplay(field('age','基本信息'),0),'0');
 assert.equal(presentation.fieldDisplay(field('flag','补充信息'),false),'否');
 assert.equal(presentation.fieldDisplay(field('kind','基础',{options:[{value:'x',label:'中文选项'}]}),'x'),'中文选项');
});
test('profile and visible share all AI fields and original values; errors reveal their hidden group',()=>{
 let context;
 const DynamicForm=load('src/client/DynamicForm.tsx',{
  react:React,'react/jsx-runtime':require('react/jsx-runtime'),
  './api':{newDesignApi:{}},'./tree':{TreeSelector:()=>null},
  './businessForms/legacy-form.css':{},
  './businessForms/aiAssist':{FormAiPanel:props=>{context=props;return null;}},
  '../common/treePolicy':{},'./storyWorkspace/Help':{default:()=>null},
  '../common/formPresentation':presentation,
 }).default;
 const fields=[field('name','基本信息'),field('appearance','外在表现',{type:'long_text'}),field('extra','作者自定义')];
 const values={name:'保留姓名',appearance:'保留外貌',extra:'保留扩展'};
 const render=(section,issues={})=>renderToStaticMarkup(React.createElement(DynamicForm,{fields,values,fieldSection:section,aiContext:{},issues}));
 const profile=render('profile');
 assert.equal(context.fields,fields);assert.equal(context.values,values);
 assert.match(profile,/保留扩展/);assert.match(profile,/保留外貌/);
 assert.equal((profile.match(/hidden=""/g)||[]).length,1);
 const visible=render('visible');assert.equal((visible.match(/hidden=""/g)||[]).length,2);
 const failed=render('profile',{appearance:'请补充外貌'});assert.equal((failed.match(/hidden=""/g)||[]).length,0);assert.match(failed,/请补充外貌/);
 assert.deepEqual(values,{name:'保留姓名',appearance:'保留外貌',extra:'保留扩展'});
});
