import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// Visual fixture only: real UI, fictional records, memory-only mutations, no API proxy.
// Run: node client/scripts/book-arrangement-visual-fixture.mjs
// Open the printed URL in the existing browser. Ctrl+C stops this isolated server.
// ?initialize=0 skips reference-position setup. POST /__fixture/reset resets memory.
const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.dirname(clientRoot);
process.chdir(clientRoot);
const cacheBase = process.env.AI_NOVEL_QA_CACHE ?? "D:/cache/Node/ai-novel-book-arrangement";
await fs.mkdir(cacheBase, { recursive: true });
const cacheDir = await fs.mkdtemp(path.join(cacheBase, "visual-fixture-"));
const clone = value => structuredClone(value);
const novelId = "visual-fixture-book";
const cid = n => `fixture-c${n}`;
const ids = (first, last = first) => Array.from({ length: last - first + 1 }, (_, i) => cid(first + i));
function personIdForColor(colorIndex) {
  for (let i = 0; i < 100; i++) {
    const id = `fixture-person-${i}`;
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    if (hash % 6 === colorIndex) return id;
  }
  throw new Error("Unable to select deterministic fixture colors");
}
const [lin, su, he, chen] = [0, 1, 2, 3].map(personIdForColor);
const characters = [{ id: lin, name: "林舟", role: "主导调查" }, { id: su, name: "苏晓", role: "失主联络" }, { id: he, name: "老何", role: "旧街向导" }, { id: chen, name: "陈默", role: "档案管理员" }];
function createWorkspace() {
  const chapterTitles = { 15: "无人认领", 16: "旧钥匙", 17: "监控空白", 18: "残缺的编号", 19: "各执一词", 20: "雨夜来客", 21: "第二份清单", 22: "失约" };
  const chapters = Array.from({ length: 30 }, (_, i) => ({ id: cid(i + 1), order: i + 1, title: chapterTitles[i + 1] ?? `街角来信 ${i + 1}`, revision: `fixture-revision-${i + 1}`, outline: i === 17 ? "林舟追查残缺编号的来源；苏晓提供失主记录，保留第22章交接的既定安排。" : `沿失物线索推进第${i + 1}章既有规划。`, hasContent: i < 17, wordCount: i < 17 ? 2200 + i * 13 : 0 }));
  const eventPeople = { 15: [lin, su], 16: [lin, su, chen], 17: [su, chen, he], 18: [], 19: [chen], 20: [lin, su], 21: [lin, he], 22: [su, he] };
  const events = Object.entries(eventPeople).filter(([, people]) => people.length).map(([order, people]) => ({ id: `fixture-event-${order}`, title: Number(order) < 18 ? "失物线索记录" : "后续会面计划", summary: Number(order) < 18 ? "登记册中的编号与旧钥匙标签存在关联，参与者交换了各自掌握的资料。" : "计划按已有线索核对清单来源；尚未形成正文事实。", revision: `fixture-event-revision-${order}`, chapterId: cid(Number(order)), chapterOrder: Number(order), storyDayIndex: Number(order) - 15, storyTimeLabel: null, participantIds: people, status: Number(order) < 18 ? "occurred" : "planned", visibility: "author" }));
  const span = (id, characterId, chapterIds, mode = "suggested", note = "按既定规划参与线索核对。", weight = null) => ({ id, characterId, chapterIds, mode, note, weight });
  const record = (id, chapterIds, title, summary, basis, sourceEntity, rest = {}) => ({ id, sourceId: id, chapterIds, title, summary, basis, sourceEntity, status: "active", evidenceLabel: basis === "plan" ? "规划目标" : "已保存记录", ...rest });
  const settings = () => ({ revision: 0, settings: { enabled: false, controls: {}, preserve: [] } });
  return {
    novelId, title: "失物招领处", coverUrl: null, genre: { id: "fixture-urban", name: "都市 · 悬疑 · 成长" }, baseRevision: "fixture-base-1", chapters, characters,
    events,
    scenes: Array.from({ length: 8 }, (_, i) => ({ id: `fixture-scene-${i + 15}`, chapterId: cid(i + 15), title: i === 3 ? "旧档案室" : "失物招领处", objective: i === 3 ? "查清编号来源" : "核对失物与失主的联系", sortOrder: 1 })).concat([{ id: "fixture-scene-15b", chapterId: cid(15), title: "街角小店", objective: "交接钥匙", sortOrder: 2 }, { id: "fixture-scene-18b", chapterId: cid(18), title: "后门楼梯", objective: "确认记录缺口", sortOrder: 2 }]),
    volumes: [{ id: "fixture-volume-blue", title: "失踪案追查（第15—19章）", order: 1, chapterIds: ids(15, 19), startChapterOrder: 15, endChapterOrder: 19 }, { id: "fixture-volume-orange", title: "信任逐渐破裂（第17—22章）", order: 2, chapterIds: ids(17, 22), startChapterOrder: 17, endChapterOrder: 22 }],
    appliedSettings: Object.fromEntries(chapters.map(chapter => [chapter.id, settings()])),
    draft: { revision: 1, updatedAt: "2026-09-13T00:00:00.000Z", payload: { baseRevision: "fixture-base-1", chapterEdits: chapters.map((chapter, i) => ({ chapterId: chapter.id, locked: false, note: i === 17 ? "查清编号来源，保留第22章交接安排。" : "", controls: i >= 14 && i <= 21 ? { tension: { mode: "set", value: [25, 25, 50, 75, 50, 50, 75, 50][i - 14] } } : {} })),
      characterSpans: [span("fixture-plan-lin18", lin, ids(18), "must", "查清钥匙编号来源", 75), span("fixture-plan-lin20", lin, ids(20, 21)), span("fixture-plan-su19", su, ids(19, 20)), span("fixture-plan-su22", su, ids(22)), span("fixture-plan-he18", he, ids(18), "indirect", "提供旧街门牌的口述线索", 0), span("fixture-plan-he21", he, ids(21, 22)), span("fixture-plan-chen19", chen, ids(19), "suggested", "核对遗失清单的修改时间")], pinnedTracks: ["tension"] } },
    previews: [],
    relations: [record("fixture-relation-record", ids(17), "互相试探", "林舟与苏晓分别保留了关键细节。", "record", "CharacterRelationStage", { sourceCharacterId: lin, targetCharacterId: su, sourceType: "chapter", chapterId: cid(17), volumeId: null, isCurrent: true }), record("fixture-relation-plan", ids(21), "有限合作", "计划在清单核实后交换部分资料。", "plan", "CharacterRelationStage", { sourceCharacterId: lin, targetCharacterId: su, sourceType: "volume", chapterId: cid(21), volumeId: "fixture-volume-orange", isCurrent: false })],
    clues: [record("fixture-clue-key", ids(15, 17), "钥匙去向（第15—17章）", "钥匙上的编号在登记册中被划去。", "record", "TimelineHook", { setupChapterId: cid(15), payoffChapterId: null, expectedPayoffChapterOrder: 22, sourceSnapshotId: null }), record("fixture-clue-camera", ids(19, 21), "监控空缺（第19—21章）", "计划追查缺失的十二分钟。", "plan", "TimelineHook", { setupChapterId: cid(19), payoffChapterId: cid(21), expectedPayoffChapterOrder: 21, sourceSnapshotId: null })],
    checks: [record("fixture-check17", ids(17), "记录待核对", "旧报告未绑定当前正文版本，请检查时间口径。", "record", "AuditIssue", { chapterId: cid(17), severity: "warning", category: "timeline", evidence: "登记记录与口述时间存在一小时差异。", fixSuggestion: "核对时间来源。", reportId: "fixture-report17", sourceRevision: null }), record("fixture-check19", ids(19), "出场安排待检查", "计划中多个人物同时到场，需要确认各自作用。", "plan", "OpenConflict", { chapterId: cid(19), severity: "warning", category: "character", evidence: null, fixSuggestion: "检查人物参与安排。", reportId: null, sourceRevision: null })],
  };
}
let workspace = createWorkspace();
const requests = [], operationResults = new Map(), planCandidates = new Map();
let sequence = 0;
const virtualId = "virtual:book-arrangement-visual-fixture";
const entrySource = `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';
import Page from '/src/pages/bookArrangement/BookArrangementPage.tsx';import Shell from '/src/components/layout/BookArrangementShell.tsx';import'/src/index.css';
createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(Shell,null,React.createElement(Page))));
// Reference-position initialization is fixture-only. It invokes existing UI controls,
// changes local selection, and never saves, generates, previews, or accepts anything.
if(new URLSearchParams(location.search).get('initialize')!=='0'){
 let stage=0;const timer=setInterval(()=>{
  if(stage===0){const windowSelect=document.querySelector('select[aria-label="章节窗口"]');if(!windowSelect)return;windowSelect.value='14';windowSelect.dispatchEvent(new Event('change',{bubbles:true}));stage=1;return;}
  if(stage===1){const chapter=document.querySelector('button[aria-label="选择第18章"]');if(!chapter)return;chapter.click();stage=2;return;}
  if(stage===2){if(!document.querySelector('.ba-head.is-selected[data-chapter-id="fixture-c18"]'))return;const span=document.querySelector('[data-span-id="fixture-plan-lin18"]');if(!span)return;span.click();const scope=document.querySelector('input[aria-label="调整范围第18章"]');if(scope&&!scope.checked)scope.click();stage=3;clearInterval(timer);document.documentElement.dataset.fixtureReady='true';}
 },80);setTimeout(()=>clearInterval(timer),15000);
}`;
function send(res, status, data) {
  res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Visual-Fixture", "memory-only");
  res.end(JSON.stringify(status < 400 ? { success: true, data } : { success: false, message: data }));
}
async function readBody(req) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > 2_000_000) throw new Error("Fixture payload too large"); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
async function handleApi(req, res, pathname) {
  const body = await readBody(req);
  const key = req.headers["idempotency-key"];
  requests.push({ method: req.method, path: pathname, key: key ?? null, body });
  const reply = value => send(res, 200, value);
  const write = fn => {
    if (!key) return send(res, 400, "模拟写操作需要幂等键。");
    const identity = `${pathname}:${key}`, input = JSON.stringify(body);
    const previous = operationResults.get(identity);
    if (previous) return previous.input === input ? reply(previous.value) : send(res, 409, "同一幂等键对应不同输入。");
    const value = fn(); operationResults.set(identity, { input, value: clone(value) }); reply(value);
  };
  if (req.method === "GET" && pathname === "/api/novels") return reply({ items: [{ id: novelId, title: workspace.title, status: "draft", chapterCount: 30 }], total: 1, page: 1, limit: 100, totalPages: 1 });
  const base = `/api/novels/${novelId}`;
  if (req.method === "GET" && pathname === `${base}/book-arrangement`) return reply(workspace);
  if (req.method === "GET" && pathname === `${base}/writing-adjustments/workspace`) return reply({ characters, chapters: workspace.chapters, scenes: workspace.scenes, planningVersions: [], reviews: [], editVersions: [], manualSessions: [] });
  if (req.method === "PUT" && pathname === `${base}/book-arrangement/draft`) {
    if (body.expectedRevision !== workspace.draft.revision && !operationResults.has(`${pathname}:${key}`)) return send(res, 409, "模拟草稿版本已变化，请刷新。");
    return write(() => (workspace.draft = { revision: workspace.draft.revision + 1, updatedAt: new Date().toISOString(), payload: clone(body.payload) }));
  }
  if (req.method === "POST" && pathname === `${base}/book-arrangement/preview`) return write(() => {
    const requested = body.chapterIds.filter(id => workspace.chapters.some(chapter => chapter.id === id));
    const excludedChapterIds = requested.filter(id => workspace.draft.payload.chapterEdits.some(edit => edit.chapterId === id && edit.locked));
    const chapterIds = requested.filter(id => !excludedChapterIds.includes(id));
    const preview = { id: `fixture-preview-${++sequence}`, chapterIds, excludedChapterIds, baseRevision: workspace.baseRevision, impact: ["仅在本地内存预览所选章节的后续要求。"], changes: chapterIds.map(chapterId => { const edit = workspace.draft.payload.chapterEdits.find(item => item.chapterId === chapterId); return { chapterId, before: clone(workspace.appliedSettings[chapterId].settings), after: { enabled: true, controls: clone(edit?.controls ?? {}), preserve: [edit?.note, ...workspace.draft.payload.characterSpans.filter(item => item.chapterIds.includes(chapterId)).map(item => `${characters.find(person => person.id === item.characterId)?.name}：${item.note}`)].filter(Boolean) } }; }) };
    workspace.previews.unshift(preview); return preview;
  });
  const applyMatch = pathname.match(/\/book-arrangement\/(fixture-preview-\d+)\/apply$/);
  if (req.method === "POST" && applyMatch) return write(() => {
    const preview = workspace.previews.find(item => item.id === applyMatch[1]);
    if (!preview || body.chapterIds.some(id => !preview.chapterIds.includes(id))) throw new Error("模拟采纳范围不属于预览。");
    const appliedSettings = Object.fromEntries(body.chapterIds.map(id => [id, { revision: workspace.appliedSettings[id].revision + 1, settings: clone(preview.changes.find(change => change.chapterId === id).after) }]));
    Object.assign(workspace.appliedSettings, appliedSettings); return { id: preview.id, status: "applied", chapterIds: body.chapterIds, appliedSettings };
  });
  if (req.method === "POST" && pathname === `${base}/writing-adjustments/plans/preview`) return write(() => {
    const preview = { id: `fixture-plan-${++sequence}`, changes: body.chapterIds.map(id => ({ chapterId: id, before: workspace.chapters.find(chapter => chapter.id === id)?.outline ?? "", after: "根据已保存出场安排，补充核对编号的过程；保留后续交接与既有因果。" })), impact: ["受控模拟候选，没有调用模型。"], baseRevisions: Object.fromEntries(workspace.chapters.map(chapter => [chapter.id, chapter.revision])) };
    planCandidates.set(preview.id, preview); return preview;
  });
  const planMatch = pathname.match(/\/writing-adjustments\/plans\/(fixture-plan-\d+)\/accept$/);
  if (req.method === "POST" && planMatch) return write(() => {
    const preview = planCandidates.get(planMatch[1]);
    if (!preview || body.acceptedChapterIds.some(id => !preview.changes.some(change => change.chapterId === id))) throw new Error("模拟候选范围不符。");
    for (const id of body.acceptedChapterIds) { const chapter = workspace.chapters.find(item => item.id === id); chapter.outline = preview.changes.find(change => change.chapterId === id).after; chapter.revision = `fixture-adopted-${++sequence}`; }
    workspace.baseRevision = `fixture-base-${++sequence}`; return { id: preview.id, status: "applied" };
  });
  return send(res, 404, `Fixture has no real backend: ${req.method} ${pathname}`);
}
const server = await createServer({ root: clientRoot, configFile: false, cacheDir,
  plugins: [react(), { name: "memory-only-arrangement-fixture", resolveId(id) { if (id === virtualId) return `\0${id}`; }, load(id) { if (id === `\0${virtualId}`) return entrySource; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      try {
        if (pathname === "/__fixture/status") return send(res, 200, { memoryOnly: true, novels: 1, chapterCount: workspace.chapters.length, requests, modelCalls: 0 });
        if (pathname === "/__fixture/reset" && req.method === "POST") { workspace = createWorkspace(); requests.length = 0; operationResults.clear(); planCandidates.clear(); return send(res, 200, { reset: true }); }
        if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname);
        if (pathname === "/") { res.statusCode = 302; res.setHeader("Location", `/book-arrangement?novelId=${novelId}`); res.end(); return; }
        if (pathname !== "/book-arrangement") return next();
        const html = await vite.transformIndexHtml(pathname, `<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>全书编排 · 本地内存预览</title></head><body><div id="root"></div><script type="module" src="/@id/__x00__${virtualId}"></script></body></html>`);
        res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html);
      } catch (error) { send(res, 400, error instanceof Error ? error.message : String(error)); }
    }); },
  }], resolve: { alias: { "@": path.join(clientRoot, "src"), "@ai-novel/shared": path.join(repoRoot, "shared") }, dedupe: ["react", "react-dom"] },
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify("visual-fixture"), "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/api") },
  server: { host: "127.0.0.1", port: Number(process.env.BOOK_ARRANGEMENT_FIXTURE_PORT ?? 5299), strictPort: true, fs: { allow: [repoRoot] } }, logLevel: "warn",
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
console.log(JSON.stringify({ url: `${origin}/book-arrangement?novelId=${novelId}`, status: `${origin}/__fixture/status`, reset: `POST ${origin}/__fixture/reset`, memoryOnly: true, browserStarted: false, defaultWindow: "15–22", selectedChapter: 18, cacheDir }, null, 2));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await server.close(); process.exit(0); });
