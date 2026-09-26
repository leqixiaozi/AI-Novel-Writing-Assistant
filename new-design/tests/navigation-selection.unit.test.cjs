const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');

const source=fs.readFileSync(path.join(__dirname,'../src/client/navigation.ts'),'utf8');
const navigation={};
new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(navigation);
const {newDesignCurrentMenuHref,isNewDesignBookWorkspacePath}=navigation;

test('new-design menu chooses only the most specific visible entry',()=>{
 assert.equal(newDesignCurrentMenuHref('/new-design'),'/new-design');
 assert.equal(newDesignCurrentMenuHref('/new-design/books/example/planning'),'/new-design/books');
 assert.equal(newDesignCurrentMenuHref('/new-design/resources/characters'),'/new-design/resources');
 assert.equal(newDesignCurrentMenuHref('/new-design/resources/titles'),'/new-design/resources/titles');
 assert.equal(newDesignCurrentMenuHref('/new-design/resources/professional'),'/new-design/resources');
 assert.equal(navigation.NEW_DESIGN_NAV_GROUPS.find(group=>group.key==='resources').items.some(item=>item.key==='professional'),false);
 assert.equal(newDesignCurrentMenuHref('/new-design/structure/models'),'/new-design/structure/models');
 assert.equal(newDesignCurrentMenuHref('/novels'),undefined);
});

test('book workspace routes use one book navigation, but creation routes stay in project navigation',()=>{
 assert.equal(isNewDesignBookWorkspacePath('/new-design/books/example/overview'),true);
 assert.equal(isNewDesignBookWorkspacePath('/new-design/books/example'),true);
 assert.equal(isNewDesignBookWorkspacePath('/new-design/books/example/planning'),true);
 assert.equal(isNewDesignBookWorkspacePath('/new-design/books/example/knowledge'),true);
 assert.equal(isNewDesignBookWorkspacePath('/new-design/books'),false);
 assert.equal(isNewDesignBookWorkspacePath('/new-design/books/new'),false);
 assert.equal(isNewDesignBookWorkspacePath('/new-design/books/example/simple'),false);
 assert.equal(isNewDesignBookWorkspacePath('/new-design/resources/titles'),false);
});
