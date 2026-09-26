const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve, dirname, relative } = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = resolve(__dirname, '../src');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const requireLocal = (name) => {
    if (name.endsWith('.css')) return {};
    if (name.endsWith('.webp')) return 'fixture-cover.webp';
    if (name === '../api') return { newDesignApi: {} };
    if (!name.startsWith('.')) return require(name);
    const candidate = resolve(dirname(file), name);
    const path = ['.ts', '.tsx', '/index.ts'].map(suffix => candidate + suffix).find(existsSync);
    if (!path) throw Error('Missing fixture dependency: ' + name + ' from ' + relative(root, file));
    return load(path);
  };
  new Function('exports', 'require', code)(exports, requireLocal);
  return exports;
}

const { buildMilestones } = load(resolve(root, 'client/guide/NewDesignGuidePage.tsx'));
const { HomeFirstBook } = load(resolve(root, 'client/home/panels.tsx'));
const models = { configured: true, tasks: [{ label: '正文', configured: true }] };
const book = { id: '41000000-0000-4000-8000-000000000002', name: '测试作品', updatedAt: '2026-09-23T00:00:00Z',
  adoptedChapterPlanCount: 0, writableChapterPlanCount: 0, writtenChapterCount: 0, latestDirector: null };
const snapshot = (books = [], creationDraft = null) => ({ books, creationDraft, readAt: '2026-09-23T00:00:00Z' });
const statuses = (books, draft = null, model = models) => buildMilestones(snapshot(books, draft), model).map(item => item.status);

test('old five-step guide structure follows only new-design formal sources', () => {
  assert.deepEqual(buildMilestones(null, null).map(item => item.status), Array(5).fill('unknown'));
  assert.deepEqual(statuses([]), ['complete', 'current', 'pending', 'pending', 'pending']);
  assert.deepEqual(statuses([], { id: 'draft', selectedDirection: true }), ['complete', 'complete', 'current', 'pending', 'pending']);
  assert.deepEqual(statuses([book]), ['complete', 'complete', 'complete', 'current', 'pending']);
  assert.deepEqual(statuses([{ ...book, latestDirector: { id: 'run', status: 'running' } }]), ['complete', 'complete', 'complete', 'current', 'pending']);
  assert.deepEqual(statuses([{ ...book, adoptedChapterPlanCount: 2 }]), ['complete', 'complete', 'complete', 'complete', 'current']);
  assert.deepEqual(statuses([{ ...book, adoptedChapterPlanCount: 2, writtenChapterCount: 1 }]), Array(5).fill('complete'));
});

test('guide routes point at new-design workspaces and keep unknown states visible', () => {
  const [environment, direction, , production, writing] = buildMilestones(snapshot([book]), null);
  assert.equal(environment.status, 'unknown');
  assert.equal(direction.href, '/new-design/books/' + book.id + '/overview');
  assert.equal(production.href, '/new-design/books/' + book.id + '/planning');
  assert.equal(writing.href, '/new-design/books/' + book.id + '/writing');
});

test('home first-book strip does not call an unread model status incomplete', () => {
  assert.equal(renderToStaticMarkup(React.createElement(HomeFirstBook, { snapshot: snapshot([book]), models: null, book })), '');
  const html = renderToStaticMarkup(React.createElement(HomeFirstBook, { snapshot: snapshot([book]), models, book }));
  assert.match(html, /第一本书向导/);
  assert.match(html, /继续准备/);
});
