const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const {PassThrough}=require('node:stream');
const ts=require('typescript');
const React=require('react');
const {renderToPipeableStream}=require('react-dom/server');

test('a host can lazy-load the package entry without losing its shell or route props',async()=>{
  let pageLoads=0;
  const module={exports:{}};
  const source=ts.transpileModule(readFileSync(require.resolve('../src/client/index.ts'),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  runInNewContext(source,{exports:module.exports,require(name){
    if(name==='react')return React;
    if(name==='./navigation')return {};
    if(name==='./NewDesignPage'){
      pageLoads++;
      return {__esModule:true,default:({pathname})=>React.createElement('main',null,pathname)};
    }
    throw new Error(`Unexpected entry dependency: ${name}`);
  }});
  assert.equal(pageLoads,0,'reading menu exports must not load business pages');
  const HostPage=React.lazy(()=>Promise.resolve(module.exports));
  const html=await new Promise((resolve,reject)=>{
    const output=new PassThrough();let value='';
    output.on('data',chunk=>{value+=chunk;});output.on('end',()=>resolve(value));output.on('error',reject);
    const stream=renderToPipeableStream(React.createElement('section',null,
      React.createElement('nav',null,'legacy menu'),
      React.createElement(React.Suspense,{fallback:'loading'},React.createElement(HostPage,{pathname:'/new-design/books'}))),{
      onAllReady(){stream.pipe(output);},onError:reject,
    });
  });
  assert.equal(pageLoads,1);
  assert.match(html,/<nav>legacy menu<\/nav>/);
  assert.match(html,/<main>\/new-design\/books<\/main>/);
});
