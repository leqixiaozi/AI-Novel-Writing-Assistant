import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// The real page runs against fixture APIs on an isolated ephemeral Vite port.
// No request reaches a running application, a real novel, or a model provider.
const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.dirname(clientRoot);
process.chdir(clientRoot);
const require = createRequire(import.meta.url);
const cacheRoot = process.env.AI_NOVEL_QA_CACHE ?? "D:/cache/Node/ai-novel-book-arrangement";
await fs.mkdir(cacheRoot, { recursive: true });
const artifacts = await fs.mkdtemp(path.join(cacheRoot, "browser-"));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "D:/cache/Node/playwright";
const packages = await fs.readdir(path.join(repoRoot, "node_modules/.pnpm"));
const playwrightPackage = packages.find(name => /^playwright@\d/.test(name));
if (!playwrightPackage) throw new Error("Reuse an existing Playwright installation to run this check.");
const { chromium } = require(path.join(repoRoot, "node_modules/.pnpm", playwrightPackage, "node_modules/playwright"));
const virtualId = "virtual:book-arrangement-qa";
const server = await createServer({
  root: clientRoot, configFile: false, cacheDir: path.join(artifacts, "vite"),
  plugins: [react(), {
    name: "book-arrangement-qa-only",
    resolveId(id) { if (id === virtualId) return `\0${id}`; },
    load(id) {
      if (id !== `\0${virtualId}`) return;
      return `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';
        import BookArrangementPage from '/src/pages/bookArrangement/BookArrangementPage.tsx';import'/src/index.css';
        createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(BookArrangementPage)));`;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (new URL(req.url ?? "/", "http://127.0.0.1").pathname !== "/book-arrangement") return next();
        const html = await vite.transformIndexHtml("/book-arrangement", `<html lang="zh"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__${virtualId}"></script></body></html>`);
        res.setHeader("Content-Type", "text/html;charset=utf-8"); res.end(html);
      });
    },
  }],
  resolve: { alias: { "@": path.join(clientRoot, "src"), "@ai-novel/shared": path.join(repoRoot, "shared") }, dedupe: ["react", "react-dom"] },
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify("qa"), "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/api") },
  server: { host: "127.0.0.1", port: 0, strictPort: true, fs: { allow: [repoRoot] } }, logLevel: "warn",
});

const clone = value => JSON.parse(JSON.stringify(value));
const emptySettings = () => ({ enabled: false, controls: {}, preserve: [] });
function createWorkspace(novelId, title, chapterCount) {
  const chapters = Array.from({ length: chapterCount }, (_, index) => ({
    id: `${novelId}-c${index + 1}`, title: `章节${index + 1}`, order: index + 1,
    revision: `${novelId}-chapter-${index + 1}-rev`, outline: index === 7 ? "第8章双方结盟" : `第${index + 1}章既有规划`, hasContent: index < 8, wordCount: index < 8 ? 2100 + index : 0,
  }));
  return {
    novelId, title, baseRevision: `${novelId}-base`, chapters,
    characters: [{ id: `${novelId}-p1`, name: "林舟", role: "主角" }, { id: `${novelId}-p2`, name: "林舟", role: "同名配角" }],
    scenes: chapters.map(c => ({ id: `scene-${c.id}`, chapterId: c.id, title: "既有场景", objective: "保持原有目标", sortOrder: 1 })),
    events: chapters.map(c => ({ id: `event-${c.id}`, title: "既有事件", summary: `第${c.order}章发生的原事件`, revision: `event-rev-${c.id}`, chapterId: c.id, chapterOrder: c.order, storyDayIndex: c.order - 1, storyTimeLabel: null, participantIds: [`${novelId}-p1`], status: c.hasContent ? "occurred" : "planned", visibility: "author" })),
    volumes: [{ id: `${novelId}-v1`, title: "第一卷", order: 1, chapterIds: chapters.map(c => c.id), startChapterOrder: 1, endChapterOrder: chapterCount }],
    appliedSettings: Object.fromEntries(chapters.map(c => [c.id, { revision: 0, settings: emptySettings() }])),
    draft: { revision: 0, updatedAt: null, payload: { baseRevision: `${novelId}-base`, chapterEdits: [{ chapterId: `${novelId}-c5`, note: "保留第8章结盟", controls: { tension: { mode: "set", value: 0 } }, locked: false }].filter(e => chapters.some(c => c.id === e.chapterId)), characterSpans: [], pinnedTracks: ["pace", "tension"] } },
    previews: [],
  };
}
const workspaces = { n1: createWorkspace("n1", "甲书：失物招领", 23), n2: createWorkspace("n2", "乙书：独立故事", 3) };
const originalCanon = clone(Object.fromEntries(Object.entries(workspaces).map(([id, w]) => [id, { chapters: w.chapters, events: w.events, scenes: w.scenes, appliedSettings: w.appliedSettings }])));
const requests = [], errors = [], checks = [];
let failNextSave = false, counter = 0;

await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const cachedBrowsers = (await fs.readdir(process.env.PLAYWRIGHT_BROWSERS_PATH))
  .filter(name => /^chromium_headless_shell-\d+$/.test(name)).sort((a, b) => Number(b.split("-").at(-1)) - Number(a.split("-").at(-1)));
const executablePath = process.env.AI_NOVEL_QA_BROWSER ?? (cachedBrowsers[0]
  ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, cachedBrowsers[0], "chrome-headless-shell-win64/chrome-headless-shell.exe") : undefined);
const browser = await chromium.launch({ headless: true, executablePath }).catch(async error => { await server.close(); throw error; });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
page.on("pageerror", error => errors.push(error.message));
page.on("dialog", dialog => dialog.accept());
await page.route(url => url.pathname.startsWith("/api/"), async route => {
  const req = route.request(), url = new URL(req.url()), body = req.postDataJSON();
  requests.push({ path: url.pathname, method: req.method(), body, key: req.headers()["idempotency-key"] });
  const reply = data => route.fulfill({ json: { success: true, data } });
  if (url.pathname === "/api/novels") return reply({ items: Object.values(workspaces).map(w => ({ id: w.novelId, title: w.title, chapterCount: w.chapters.length, status: "draft" })), total: 2, page: 1, limit: 100, totalPages: 1 });
  if (url.pathname === "/api/novels/n1/writing-adjustments/plans/preview") {
    assert.deepEqual(body.chapterIds, ["n1-c4"]);
    return reply({ id: "plan-preview-1", changes: body.chapterIds.map(id => ({ chapterId: id, before: workspaces.n1.chapters.find(c => c.id === id).outline, after: "依照编排草稿加强既有对立，保留第8章结盟。" })), impact: ["仅候选规划，现有章节规划保持原样。"], baseRevisions: Object.fromEntries(workspaces.n1.chapters.map(c => [c.id, c.revision])) });
  }
  const match = url.pathname.match(/^\/api\/novels\/(n1|n2)\/book-arrangement(?:\/(.*))?$/);
  if (!match) return route.fulfill({ status: 500, json: { success: false, error: `Unexpected fixture endpoint ${url.pathname}` } });
  const workspace = workspaces[match[1]], suffix = match[2] ?? "";
  if (req.method() === "GET" && (!suffix || suffix === "workspace")) return reply(workspace);
  if (req.method() === "PUT" && suffix === "draft") {
    if (failNextSave) { failNextSave = false; return route.fulfill({ status: 503, json: { success: false, error: "模拟草稿保存暂不可用" } }); }
    if (body.expectedRevision !== workspace.draft.revision) return route.fulfill({ status: 409, json: { success: false, error: "草稿版本已变化" } });
    workspace.draft = { revision: workspace.draft.revision + 1, updatedAt: new Date().toISOString(), payload: clone(body.payload) };
    return reply(workspace.draft);
  }
  if (req.method() === "POST" && suffix === "preview") {
    const allowed = new Set(workspace.chapters.map(c => c.id));
    if (body.chapterIds.some(id => !allowed.has(id))) return route.fulfill({ status: 400, json: { success: false, error: "章节不属于当前作品" } });
    const excludedChapterIds = body.chapterIds.filter(id => workspace.draft.payload.chapterEdits.some(edit => edit.chapterId === id && edit.locked));
    const chapterIds = body.chapterIds.filter(id => !excludedChapterIds.includes(id));
    const preview = { id: `preview-${++counter}`, chapterIds, excludedChapterIds, baseRevision: workspace.baseRevision, impact: ["只修改选定章节后续写作要求，保留第8章结盟。"], changes: chapterIds.map(chapterId => ({ chapterId, before: workspace.appliedSettings[chapterId].settings, after: { enabled: true, controls: workspace.draft.payload.chapterEdits.find(edit => edit.chapterId === chapterId)?.controls ?? {}, preserve: [] } })) };
    workspace.previews.unshift(preview); return reply(preview);
  }
  if (req.method() === "POST" && suffix.endsWith("/apply")) {
    const preview = workspace.previews.find(item => `${item.id}/apply` === suffix);
    assert.ok(preview, "apply must name the preview actually returned by the fixture");
    assert.deepEqual(body.chapterIds, ["n1-c4"], "only the selected unlocked chapter may be applied");
    assert.ok(req.headers()["idempotency-key"], "apply requires a stable operation key");
    const appliedSettings = {};
    for (const chapterId of body.chapterIds) {
      assert.ok(preview.chapterIds.includes(chapterId));
      assert.equal(workspace.draft.payload.chapterEdits.some(edit => edit.chapterId === chapterId && edit.locked), false);
      const change = preview.changes.find(item => item.chapterId === chapterId);
      appliedSettings[chapterId] = { revision: workspace.appliedSettings[chapterId].revision + 1, settings: clone(change.after) };
    }
    Object.assign(workspace.appliedSettings, appliedSettings);
    return reply({ id: preview.id, status: "applied", chapterIds: body.chapterIds, appliedSettings });
  }
  return route.fulfill({ status: 500, json: { success: false, error: `Unimplemented fixture mutation ${req.method()} ${url.pathname}` } });
});

const screenshot = name => page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: true });
async function assertAligned(expectedIds) {
  const geometry = await page.locator(".ba-matrix").evaluate(matrix => {
    const rect = element => ({ x: element.getBoundingClientRect().x, width: element.getBoundingClientRect().width });
    const heads = [...matrix.querySelectorAll(".ba-head[data-chapter-id]")];
    return {
      ids: heads.map(element => element.dataset.chapterId), heads: heads.map(rect),
      people: [...matrix.querySelectorAll(".ba-person-cell")].map(rect),
      parameters: [...matrix.querySelectorAll(".ba-curve-cell")].map(rect),
      events: [...matrix.querySelectorAll(".ba-event")].map(element => rect(element.closest(".ba-cell"))),
      scenes: [...matrix.querySelectorAll(".ba-scene")].map(element => rect(element.closest(".ba-cell"))),
      clippedParameters: [...matrix.querySelectorAll(".ba-curve-cell")].flatMap(element => {
        const cell = element.getBoundingClientRect(), label = element.querySelector("span").getBoundingClientRect();
        return label.bottom > cell.bottom + 1 ? [{ text: element.textContent, overflow: label.bottom - cell.bottom }] : [];
      }),
    };
  });
  assert.deepEqual(geometry.ids, expectedIds);
  assert.deepEqual(geometry.clippedParameters, [], "parameter labels overflow their chapter cells");
  for (const kind of ["people", "parameters", "events", "scenes"]) {
    assert.ok(geometry[kind].length >= expectedIds.length, `${kind} row missing`);
    geometry[kind].forEach((cell, index) => {
      const head = geometry.heads[index % expectedIds.length];
      assert.ok(Math.abs(cell.x - head.x) <= 1 && Math.abs(cell.width - head.width) <= 1, `${kind} column ${index} is misaligned`);
    });
  }
}
const noPageOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "page overflows instead of containing chapter scroll");
const selectChapter = order => page.getByRole("button", { name: `选择第${order}章`, exact: true }).click();
const canonicalData = () => Object.fromEntries(Object.entries(workspaces).map(([id, w]) => [id, { chapters: w.chapters, events: w.events, scenes: w.scenes, appliedSettings: w.appliedSettings }]));
try {
  await page.goto(`${origin}/book-arrangement`);
  await page.getByLabel("选择作品").waitFor();
  await page.waitForTimeout(250);
  assert.equal(requests.some(r => r.method !== "GET"), false);
  assert.equal(requests.some(r => r.path.includes("/book-arrangement")), false);
  checks.push("unselected entry only reads the novel list");
  await screenshot("01-unselected");
  await page.getByLabel("选择作品").selectOption("n1");
  await page.getByRole("button", { name: "选择第1章", exact: true }).waitFor();
  assert.equal(requests.some(r => r.method !== "GET"), false);
  await assertAligned(workspaces.n1.chapters.slice(0, 10).map(c => c.id));
  await page.getByRole("button", { name: "下一窗口", exact: true }).click();
  await page.getByRole("button", { name: "下一窗口", exact: true }).click();
  await assertAligned(workspaces.n1.chapters.slice(-10).map(c => c.id));
  assert.equal(await page.locator(".ba-head[data-chapter-id].is-selected").count(), 1, "tail window must keep the inspected chapter visible and selected");
  const selectedTailId = await page.locator(".ba-head[data-chapter-id].is-selected").getAttribute("data-chapter-id");
  const selectedTail = workspaces.n1.chapters.find(chapter => chapter.id === selectedTailId);
  assert.ok(await page.locator(".ba-inspector h2").innerText().then(text => text.includes(`第 ${selectedTail.order} 章`)), "inspector must follow the highlighted chapter");
  assert.equal(await page.getByRole("button", { name: "下一窗口", exact: true }).isDisabled(), true);
  await screenshot("02-tail-window-aligned");
  await page.getByLabel("选择作品").selectOption("n2");
  await page.getByRole("button", { name: "选择第1章", exact: true }).waitFor();
  await assertAligned(workspaces.n2.chapters.map(c => c.id));
  assert.equal(requests.some(r => r.method !== "GET"), false);
  checks.push("selecting and switching novels never writes; all four tracks share the exact tail and short-book chapter columns");
  await page.getByLabel("选择作品").selectOption("n1");
  await page.getByRole("button", { name: "第4章紧张感表达未设置", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "第5章紧张感表达0", exact: true }).innerText(), "0");
  assert.equal(await page.getByLabel("紧张感表达曲线，未设置处断线").locator("circle").count(), 1);
  checks.push("unset tension is a gap while explicit zero remains a visible point");
  await page.getByRole("button", { name: "选择第4章", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("编排备注", { exact: true }).fill("第4—5章加强既有对立，保留第8章结盟");
  await page.locator("summary").filter({ hasText: "本章五种表达参数" }).click();
  await page.getByLabel("叙述节奏设置方式", { exact: true }).selectOption("set");
  await page.getByLabel("叙述节奏档位", { exact: true }).selectOption("75");
  await page.reload();
  await page.getByRole("button", { name: "恢复未保存编辑", exact: true }).click();
  await selectChapter(4);
  assert.equal(await page.getByLabel("编排备注", { exact: true }).inputValue(), "第4—5章加强既有对立，保留第8章结盟");
  assert.equal(requests.some(r => r.method !== "GET"), false);
  for (const checkbox of await page.getByRole("checkbox", { name: /^调整范围第/ }).all()) await checkbox.uncheck();
  await page.getByRole("checkbox", { name: "调整范围第4章", exact: true }).check();
  await page.getByRole("checkbox", { name: "调整范围第5章", exact: true }).check();
  await page.getByRole("tab", { name: "人物区段", exact: true }).click();
  await page.getByRole("button", { name: "新增人物区段", exact: true }).click();
  assert.equal(await page.getByLabel("区段权重", { exact: true }).inputValue(), "");
  await page.getByLabel("区段人物", { exact: true }).selectOption("n1-p2");
  const beforeInvalidSave = requests.length;
  await page.getByLabel("区段权重", { exact: true }).fill("101");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "0 至 100" }).waitFor();
  assert.equal(requests.length, beforeInvalidSave);
  const chapterOptions = await page.getByLabel("范围起始章节").locator("option").evaluateAll(options => options.map(option => option.value));
  assert.deepEqual(chapterOptions, workspaces.n1.chapters.map(c => c.id));
  checks.push("out-of-range weight is rejected before any API call and chapter ranges only expose this novel's chapter IDs");
  await page.getByLabel("区段权重", { exact: true }).fill("0");
  await page.getByLabel("区段参与方式", { exact: true }).selectOption("indirect");
  await page.getByLabel("区段备注", { exact: true }).fill("同名配角仅产生间接影响");
  failNextSave = true;
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "模拟草稿保存暂不可用" }).waitFor();
  assert.equal(await page.getByLabel("区段权重", { exact: true }).inputValue(), "0");
  await screenshot("03-save-error-retains-input");
  await Promise.all([page.waitForResponse(r => r.url().endsWith("/book-arrangement/draft") && r.status() === 200), page.getByRole("button", { name: "保存草稿", exact: true }).click()]);
  const saves = requests.filter(r => r.path.endsWith("/draft"));
  assert.equal(saves.length, 2); assert.ok(saves[0].key); assert.equal(saves[0].key, saves[1].key);
  const saved = workspaces.n1.draft;
  assert.equal(saved.payload.characterSpans[0].characterId, "n1-p2");
  assert.equal(saved.payload.characterSpans[0].weight, 0);
  assert.deepEqual(saved.payload.characterSpans[0].chapterIds.sort(), ["n1-c4", "n1-c5"]);
  checks.push("same-named character uses its stable ID; null and zero survive editing; 503 retry retains the same idempotency key");
  await page.reload();
  await page.getByRole("button", { name: "选择第4章", exact: true }).waitFor();
  await selectChapter(4);
  assert.equal(await page.getByLabel("编排备注", { exact: true }).inputValue(), "第4—5章加强既有对立，保留第8章结盟");
  await page.getByRole("tab", { name: "人物区段", exact: true }).click();
  await page.getByLabel("选择人物区段").selectOption(saved.payload.characterSpans[0].id);
  assert.equal(await page.getByLabel("区段人物", { exact: true }).inputValue(), "n1-p2");
  assert.equal(await page.getByLabel("区段权重", { exact: true }).inputValue(), "0");
  await page.getByRole("tab", { name: "章信息", exact: true }).click();
  await page.getByRole("button", { name: "林舟第4章区段", exact: true }).click();
  await page.getByRole("tab", { name: "人物区段", exact: true, selected: true }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "人物区段", exact: true }).getAttribute("aria-selected"), "true", "clicking the same existing span must reopen its inspector tab");
  await page.getByLabel("选择作品").selectOption("n2");
  await page.getByRole("button", { name: "选择第1章", exact: true }).waitFor();
  assert.deepEqual(workspaces.n2.draft.payload.characterSpans, []);
  await page.getByLabel("选择作品").selectOption("n1");
  await page.getByRole("button", { name: "选择第4章", exact: true }).waitFor();
  await selectChapter(4);
  await page.getByRole("tab", { name: "章信息", exact: true }).click();
  assert.equal(await page.getByLabel("编排备注", { exact: true }).inputValue(), "第4—5章加强既有对立，保留第8章结盟");
  checks.push("unsaved edits and server drafts restore after reload; cross-book navigation retains character zero without leaking edits");
  await selectChapter(5);
  await page.getByRole("checkbox", { name: "锁定本章编排", exact: true }).check();
  assert.equal(await page.getByLabel("编排备注", { exact: true }).isDisabled(), true);
  await Promise.all([page.waitForResponse(r => r.url().endsWith("/book-arrangement/draft") && r.status() === 200), page.getByRole("button", { name: "保存草稿", exact: true }).click()]);
  for (const checkbox of await page.getByRole("checkbox", { name: /^调整范围第/ }).all()) await checkbox.uncheck();
  await page.getByRole("checkbox", { name: "调整范围第4章", exact: true }).check();
  await page.getByRole("checkbox", { name: "调整范围第5章", exact: true }).check();
  await Promise.all([page.waitForResponse(r => r.url().endsWith("/book-arrangement/preview") && r.status() === 200), page.getByRole("button", { name: "预览后续要求", exact: true }).click()]);
  assert.deepEqual(workspaces.n1.previews[0].chapterIds, ["n1-c4"]);
  assert.deepEqual(canonicalData(), originalCanon);
  await page.getByRole("region", { name: "后续要求预览", exact: true }).scrollIntoViewIfNeeded();
  await screenshot("04-preview-preserves-canonical");
  await page.locator("summary").filter({ hasText: "AI 重编排所选大纲" }).click();
  assert.equal(await page.getByLabel("大纲调整目标", { exact: true }).inputValue(), "");
  await Promise.all([page.waitForResponse(r => r.url().endsWith("/writing-adjustments/plans/preview") && r.status() === 200), page.getByRole("button", { name: "预览大纲调整", exact: true }).click()]);
  const planRequest = requests.find(r => r.path.endsWith("/writing-adjustments/plans/preview"));
  assert.deepEqual(planRequest.body.chapterIds, ["n1-c4"]);
  assert.ok(planRequest.body.instruction.includes("第4—5章加强既有对立，保留第8章结盟"));
  assert.ok(planRequest.body.instruction.includes("n1-p2"));
  assert.match(planRequest.body.instruction, /"weight"\s*:\s*0/);
  assert.deepEqual(canonicalData(), originalCanon);
  await page.getByRole("button", { name: "采纳所选大纲", exact: true }).scrollIntoViewIfNeeded();
  await screenshot("06-config-driven-plan-preview");
  checks.push("locked chapter five is excluded; empty-target AI preview assembles saved notes and character-ID/zero configuration without modifying canonical data");
  const applyButton = page.getByRole("button", { name: "应用所选章节要求", exact: true });
  await page.getByRole("checkbox", { name: "应用要求n1-c4", exact: true }).uncheck();
  assert.equal(await applyButton.isDisabled(), true, "empty application selection must disable apply");
  await page.getByRole("checkbox", { name: "应用要求n1-c4", exact: true }).check();
  await Promise.all([page.waitForResponse(r => r.url().endsWith(`/book-arrangement/${workspaces.n1.previews[0].id}/apply`) && r.status() === 200), applyButton.click()]);
  await page.getByText("要求已应用，可从章节写作继续使用。", { exact: true }).waitFor();
  await page.getByRole("status").filter({ hasText: "所选章节的后续要求已应用" }).waitFor();
  assert.equal(await applyButton.isDisabled(), true, "successful application must prevent duplicate clicks");
  const applyRequest = requests.filter(request => request.path.endsWith("/apply"));
  assert.equal(applyRequest.length, 1);
  assert.deepEqual(applyRequest[0].body, { chapterIds: ["n1-c4"] });
  assert.deepEqual(workspaces.n1.appliedSettings["n1-c4"].settings.controls.pace, { mode: "set", value: 75 });
  const expectedAfterApply = clone(originalCanon);
  expectedAfterApply.n1.appliedSettings["n1-c4"] = clone(workspaces.n1.appliedSettings["n1-c4"]);
  assert.deepEqual(canonicalData(), expectedAfterApply, "apply may only change chapter four's optional settings, preserving all prose metadata, outlines, events, scenes and other chapter settings");
  assert.equal(await page.getByRole("link", { name: "打开章节4的人工调整", exact: true }).getAttribute("href"), "/novels/n1/chapters/n1-c4");
  await page.reload();
  await page.getByRole("button", { name: "选择第4章", exact: true }).waitFor();
  await selectChapter(4);
  await page.locator("summary").filter({ hasText: "已应用的后续要求" }).click();
  await page.locator(".ba-inspector").getByText("叙述节奏：75", { exact: true }).waitFor();
  await page.locator(".ba-inspector").getByText("启用可选要求", { exact: true }).waitFor();
  assert.deepEqual(canonicalData(), expectedAfterApply);
  await screenshot("07-applied-requirements-after-reload");
  checks.push("applying the selected chapter returns success and a chapter-editor link; only chapter four's optional settings change and its pace 75 remains visible after reload");
  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow();
  await page.locator(".book-arrangement-scroll").focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  assert.ok(await page.locator(".book-arrangement-scroll").evaluate(element => element.scrollLeft) > 0, "keyboard arrows must move the shared horizontal scroller");
  await assertAligned(workspaces.n1.chapters.slice(0, 10).map(c => c.id));
  await screenshot("05-narrow-common-scroll");
  checks.push("390px viewport contains a keyboard-reachable shared chapter scroller with aligned tracks");
  assert.deepEqual(errors, []);
  const result = { checks, apiRequestCount: requests.length, pageErrors: errors, artifacts, browser: browser.version(), source: "real BookArrangementPage + fixture APIs; no production data or models" };
  await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await screenshot("failed").catch(() => {});
  await fs.writeFile(path.join(artifacts, "failure.json"), JSON.stringify({ checks, requests, errors, error: String(error) }, null, 2));
  console.error(`QA artifacts: ${artifacts}`); throw error;
} finally { await browser.close(); await server.close(); }
