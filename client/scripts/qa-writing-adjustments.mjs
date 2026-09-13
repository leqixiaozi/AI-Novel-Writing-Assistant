import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// Real components and browser; every API is an in-memory fixture, never the running application.
const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.dirname(clientRoot);
process.chdir(clientRoot);
const require = createRequire(import.meta.url);
const cacheRoot = process.env.AI_NOVEL_QA_CACHE ?? "D:/cache/Node/ai-novel-writing-adjustments";
await fs.mkdir(cacheRoot, { recursive: true });
const artifacts = await fs.mkdtemp(path.join(cacheRoot, "browser-"));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "D:/cache/Node/playwright";
const packages = await fs.readdir(path.join(repoRoot, "node_modules/.pnpm"));
const playwrightPackage = packages.find(name => /^playwright@\d/.test(name));
if (!playwrightPackage) throw new Error("Reuse an existing Playwright installation to run this check.");
const { chromium } = require(path.join(repoRoot, "node_modules/.pnpm", playwrightPackage, "node_modules/playwright"));

const original = "林舟来到柜台。他问起寄信人。王掌柜没有回答。";
const selected = "他问起寄信人。";
const virtualId = "virtual:writing-adjustment-qa";
const server = await createServer({
  root: clientRoot, configFile: false, cacheDir: path.join(artifacts, "vite"),
  plugins: [react(), {
    name: "writing-adjustment-qa-only",
    resolveId(id) { if (id === virtualId) return `\0${id}`; },
    load(id) {
      if (id !== `\0${virtualId}`) return;
      return `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';
        import{WritingAdjustmentPanel}from'/src/pages/novels/components/writingAdjustments/WritingAdjustmentPanel.tsx';import'/src/index.css';
        function App(){const[selection,setSelection]=React.useState(null);return React.createElement(MemoryRouter,{initialEntries:['/novels/n1/chapters/c1'+window.location.search]},
        React.createElement('main',{style:{maxWidth:1120,margin:'24px auto',padding:16}},React.createElement('h1',null,'可选人工调整验收'),
        React.createElement('button',{onClick:()=>setSelection({from:${original.indexOf(selected)},to:${original.indexOf(selected) + selected.length},text:${JSON.stringify(selected)}})},'选择测试片段'),
        React.createElement('textarea',{'aria-label':'原编辑器正文',value:${JSON.stringify(original)},readOnly:true,style:{display:'block',width:'100%',minHeight:70,marginBottom:16}}),
        React.createElement(WritingAdjustmentPanel,{novelId:'n1',chapterId:'c1',currentContent:${JSON.stringify(original)},selection})));}
        createRoot(document.getElementById('root')).render(React.createElement(App));`;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (new URL(req.url ?? "/", "http://127.0.0.1").pathname !== "/qa") return next();
        const html = await vite.transformIndexHtml("/qa", `<html lang="zh"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/__x00__${virtualId}"></script></body></html>`);
        res.setHeader("Content-Type", "text/html;charset=utf-8"); res.end(html);
      });
    },
  }],
  resolve: { alias: { "@": path.join(clientRoot, "src"), "@ai-novel/shared": path.join(repoRoot, "shared") }, dedupe: ["react", "react-dom"] },
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify("qa"), "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/api") },
  server: { host: "127.0.0.1", port: 0, strictPort: true, fs: { allow: [repoRoot] } }, logLevel: "warn",
});
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const cachedBrowsers = (await fs.readdir(process.env.PLAYWRIGHT_BROWSERS_PATH))
  .filter(name => /^chromium_headless_shell-\d+$/.test(name)).sort((a, b) => Number(b.split("-").at(-1)) - Number(a.split("-").at(-1)));
const executablePath = process.env.AI_NOVEL_QA_BROWSER ?? (cachedBrowsers[0]
  ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, cachedBrowsers[0], "chrome-headless-shell-win64/chrome-headless-shell.exe") : undefined);
const browser = await chromium.launch({ headless: true, executablePath }).catch(async error => { await server.close(); throw error; });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const requests = [], errors = [], checks = [];
let failure = false, counter = 0, requirements;
const now = new Date().toISOString();
const workspace = {
  chapters: [{ id: "c1", title: "问询", order: 3, revision: "rev-1", content: original, expectation: "询问未果" }, { id: "c2", title: "回访", order: 4, revision: "rev-2", content: "次日回访。", expectation: "再次问询" }],
  characters: [{ id: "p1", name: "林舟" }, { id: "p2", name: "王掌柜" }], versions: [], reviews: [], manualSessions: [], acceptances: [], decisions: [],
  scenes: [{ id: "scene-c1-counter", chapterId: "c1", title: "柜台问询", sortOrder: 1 }, { id: "scene-c2-return", chapterId: "c2", title: "次日回访", sortOrder: 1 }],
};
const settings = { revision: 0, scopeKey: "chapter:c1", settings: { enabled: false, controls: {}, preserve: [] }, effective: { enabled: false, controls: {}, preserve: [] }, sources: {}, definitions: [], presets: [] };
let event = { id: "event-1", title: "柜台问询", summary: "林舟询问寄信人，掌柜没有回答。", revision: "event-rev-1", chapterId: "c1", chapterOrder: 3, storyDayIndex: 3, storyTimeLabel: "上午", participantIds: ["p1"], status: "occurred", visibility: "reader_known" };
let linePreview;
const version = (kind, content, requirementsId = requirements?.id ?? null) => ({ id: `${kind}-${++counter}`, sessionId: "session-version", chapterId: "c1", kind, baseRevision: "rev-1", content, contentHash: `hash-${counter}`, requirementsId, metadata: {}, createdAt: now });
page.on("pageerror", error => errors.push(error.message));
page.on("dialog", dialog => dialog.accept());
await page.route(url => url.pathname.startsWith("/api/"), async route => {
  const req = route.request(), url = new URL(req.url()), body = req.postDataJSON();
  requests.push({ path: url.pathname, method: req.method(), body, key: req.headers()["idempotency-key"] });
  const reply = data => route.fulfill({ json: { success: true, data } });
  if (url.pathname.endsWith("/writing-adjustments/workspace")) return reply(workspace);
  if (url.pathname.endsWith("/writing-settings")) return reply(settings);
  if (url.pathname.endsWith("/writing-requirements/resolve")) {
    requirements = { id: `requirements-${++counter}`, novelId: "n1", chapterIds: ["c1"], scope: body.scope, controls: body.overrides, preserve: body.preserve, summary: "本次要求已冻结：保留事实，调整指定片段。", definitionVersion: "1", baseRevisions: { c1: "rev-1" }, dependencyRevision: "dep-1", createdAt: now, expiresAt: "2099-01-01T00:00:00Z" };
    return reply(requirements);
  }
  if (url.pathname.endsWith("/editor/adjustment-preview")) {
    if (failure) { failure = false; return route.fulfill({ status: 503, json: { success: false, error: "模拟服务暂不可用" } }); }
    const candidate = version("candidate", original.replace(selected, "他低声问起寄信人的名字。"));
    workspace.versions.unshift(candidate); return reply([candidate]);
  }
  if (url.pathname.endsWith("/editor/drafts")) { const draft = version("draft", body.content, body.requirementsId); workspace.versions.unshift(draft); return reply(draft); }
  if (url.pathname.endsWith("/editor/adjustment-review")) {
    const draft = workspace.versions.find(v => v.id === body.editVersionId);
    const review = { id: `review-${++counter}`, editVersionId: draft.id, contentHash: draft.contentHash, dependencyRevision: "dep-1", summary: "当前稿已核对，未发现事实冲突。", issues: [] };
    workspace.reviews.unshift(review); return reply(review);
  }
  if (url.pathname.endsWith("/runtime/manual-edit")) {
    const session = body.action === "begin" ? { id: "manual-1", chapterIds: ["c1"], status: "active" } : { ...workspace.manualSessions[0], status: "completed" };
    workspace.manualSessions = [session]; return reply(session);
  }
  if (url.pathname === "/api/novels/director/tasks/director-1/commands") {
    if (body.commandType === "begin_manual_edit") {
      const session = { id: "director-manual-1", taskId: "director-1", chapterIds: body.payload.chapterIds, status: "active" };
      workspace.manualSessions = [session]; return reply(session);
    }
    if (body.commandType === "accept_manual_changes_and_continue" && body.payload.sessionId === "director-manual-1") {
      workspace.manualSessions = workspace.manualSessions.map(session => session.id === body.payload.sessionId ? { ...session, status: "completed" } : session);
      return reply({ commandId: "director-continue-1", status: "accepted" });
    }
    return route.fulfill({ status: 400, json: { success: false, error: "Unexpected director fixture command" } });
  }
  if (url.pathname.endsWith("/acceptances")) {
    const receipt = { id: "accept-1", chapterId: "c1", editVersionId: body.editVersionId, acceptedRevision: "rev-3", reviewState: "checked", canonicalSyncStatus: "pending", nextActions: ["inspect_sync"] };
    workspace.acceptances = [receipt]; return reply(receipt);
  }
  if (url.pathname.endsWith("/writing-adjustments/lines")) return reply({ events: [event], characters: workspace.characters, chapters: workspace.chapters });
  if (url.pathname.endsWith("/lines/event-1/preview")) {
    linePreview = { id: "line-candidate-1", eventId: event.id, before: event, after: { ...event, ...body.patch }, affectedChapterIds: ["c1", "c2"], impact: ["第3章事件时间改变，第4章需要复核。"] }; return reply(linePreview);
  }
  if (url.pathname.endsWith("/lines/line-candidate-1/accept")) { event = { ...linePreview.after, revision: "event-rev-2" }; return reply({ id: linePreview.id, status: "accepted", affectedChapterIds: ["c1", "c2"] }); }
  return route.fulfill({ status: 500, json: { success: false, error: `Unexpected mock endpoint: ${url.pathname}` } });
});

const screenshot = async name => { await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: true }); };
const ready = () => page.getByLabel("本章调整稿正文").waitFor();
const open = async () => { await page.locator("summary").filter({ hasText: "人工调整（可选）" }).click(); await ready(); };
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "viewport has horizontal overflow");
try {
  await page.goto(`${origin}/qa`);
  await page.locator("summary").filter({ hasText: "人工调整（可选）" }).waitFor();
  await page.waitForTimeout(350);
  assert.equal(requests.length, 0);
  checks.push("closed panel makes no API requests");
  await screenshot("01-closed-wide");
  const entry = page.locator("summary").filter({ hasText: "人工调整（可选）" });
  await entry.focus(); await page.keyboard.press("Enter"); await ready();
  assert.equal(requests.filter(r => r.method !== "GET").length, 0);
  checks.push("keyboard opens panel; opening performs only reads");
  await noOverflow(); await screenshot("02-open-wide");
  await page.getByLabel("必须保留的内容").fill("保留第8章结盟");
  const readCount = requests.length;
  await entry.click(); await entry.click();
  assert.equal(await page.getByLabel("必须保留的内容").inputValue(), "保留第8章结盟");
  assert.equal(requests.length, readCount);
  checks.push("close/reopen keeps local input and issues no duplicate reads");
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(); await screenshot("03-open-narrow");
  checks.push("wide and 390px narrow layouts have no horizontal overflow");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole("button", { name: "选择测试片段", exact: true }).click();
  await page.getByLabel("本次作用范围").selectOption("selection");
  await page.getByLabel("叙述节奏设置方式").selectOption("set");
  await page.getByLabel("叙述节奏档位").selectOption("0");
  await page.getByRole("button", { name: "预览本次要求", exact: true }).click();
  await page.getByText("本次要求已冻结：保留事实，调整指定片段。", { exact: true }).waitFor();
  assert.equal(requirements.scope.kind, "selection"); assert.equal(requirements.scope.selection.text, selected); assert.equal(requirements.controls.pace.value, 0);
  checks.push("selection scope and legitimate zero control are transmitted");
  await page.getByLabel("本次润色目标").fill("保留事件，只调整表达");
  failure = true;
  await page.getByRole("button", { name: "生成润色候选", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "模拟服务暂不可用" }).waitFor();
  assert.equal(await page.getByLabel("本次润色目标").inputValue(), "保留事件，只调整表达");
  await screenshot("04-request-failure");
  await page.getByRole("button", { name: "生成润色候选", exact: true }).click();
  await page.locator("summary").filter({ hasText: "比较候选与已保存调整稿" }).waitFor();
  const previews = requests.filter(r => r.path.endsWith("/editor/adjustment-preview"));
  assert.equal(previews.length, 2); assert.equal(previews[0].key, previews[1].key);
  checks.push("failed generation preserves input; retry reuses idempotency key");
  await page.locator("summary").filter({ hasText: "比较候选与已保存调整稿" }).click();
  await page.getByRole("button", { name: "载入此版本", exact: true }).first().click();
  assert.equal(await page.getByLabel("原编辑器正文").inputValue(), original);
  assert.notEqual(await page.getByLabel("本章调整稿正文").inputValue(), original);
  await page.getByRole("button", { name: "保存调整稿", exact: true }).click();
  await page.getByRole("button", { name: "核对已保存稿", exact: true }).click();
  await page.getByText("当前稿已核对，未发现事实冲突。", { exact: true }).waitFor();
  await page.getByText("当前稿已核对，未发现事实冲突。", { exact: true }).scrollIntoViewIfNeeded();
  await screenshot("05-reviewed-candidate");
  checks.push("candidate/draft/review flow leaves original editor content unchanged");
  await page.reload(); await open();
  await page.getByRole("button", { name: "恢复最近调整稿及核对", exact: true }).click();
  await page.getByText("当前稿已核对，未发现事实冲突。", { exact: true }).waitFor();
  checks.push("reload restores saved draft and version-matched review");
  await page.getByRole("button", { name: "接管本章调整", exact: true }).click();
  await page.getByText("人工接管中", { exact: true }).waitFor();
  await page.getByRole("button", { name: "结束交接", exact: true }).click();
  await page.getByRole("button", { name: "接管本章调整", exact: true }).waitFor();
  checks.push("manual begin/complete reflects confirmed session receipts");
  await page.locator("summary").filter({ hasText: "调整事件时间与参与人物" }).click();
  await page.getByRole("button", { name: "载入可调整事件", exact: true }).click();
  await page.getByRole("button", { name: "编辑此事件", exact: true }).click();
  await page.getByLabel("故事发生日").fill("0");
  await page.getByLabel("事件时间说明").fill("序章当天");
  await page.getByRole("checkbox", { name: "王掌柜", exact: true }).check();
  await page.getByRole("button", { name: "预览事件调整影响", exact: true }).click();
  await page.getByText("事件修改预览", { exact: true }).waitFor();
  assert.equal(linePreview.after.storyDayIndex, 0); assert.deepEqual(linePreview.after.participantIds, ["p1", "p2"]);
  assert.equal(event.storyDayIndex, 3);
  await page.getByRole("button", { name: "采纳事件调整", exact: true }).scrollIntoViewIfNeeded();
  await screenshot("06-event-impact");
  await page.getByRole("button", { name: "采纳事件调整", exact: true }).click();
  await page.getByText("事件修改已采纳", { exact: true }).waitFor();
  assert.equal(event.storyDayIndex, 0); assert.equal(await page.getByLabel("原编辑器正文").inputValue(), original);
  checks.push("P3 event preview/accept uses existing event id, supports day zero, and leaves prose untouched");
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow();
  await page.getByText("事件修改已采纳", { exact: true }).scrollIntoViewIfNeeded();
  await screenshot("07-event-narrow");

  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByLabel("本次作用范围").selectOption("scene");
  const sceneSelect = page.getByLabel("选择本章场景");
  assert.equal(await sceneSelect.locator("option[value='scene-c2-return']").count(), 0);
  assert.equal(await page.getByRole("button", { name: "预览本次要求", exact: true }).isDisabled(), true);
  await sceneSelect.selectOption("scene-c1-counter");
  const sceneInput = await page.getByLabel("本章调整稿正文").inputValue();
  await page.getByRole("button", { name: "预览本次要求", exact: true }).click();
  await page.getByRole("button", { name: "调整所选场景", exact: true }).waitFor();
  assert.deepEqual(requirements.scope, { kind: "scene", chapterId: "c1", sceneId: "scene-c1-counter" });
  await page.getByRole("button", { name: "调整所选场景", exact: true }).click();
  await page.getByText("生成调整候选完成。", { exact: true }).waitFor();
  const sceneRequest = requests.filter(request => request.path.endsWith("/editor/adjustment-preview")).at(-1);
  assert.equal(sceneRequest.body.requirementsId, requirements.id);
  assert.equal(sceneRequest.body.content, sceneInput);
  assert.equal(await page.getByLabel("原编辑器正文").inputValue(), original);
  await page.getByRole("button", { name: "调整所选场景", exact: true }).scrollIntoViewIfNeeded();
  await screenshot("08-scene-scope");
  checks.push("scene selector offers only current chapter scenes; stable sceneId and actual edited content reach scoped generation");

  await page.goto(`${origin}/qa?directorTaskId=director-1&workspaceTaskId=workspace-ignored`);
  await open();
  const directorStart = requests.length;
  await page.getByRole("button", { name: "接管导演中的本章", exact: true }).click();
  await page.getByRole("button", { name: "结束调整并继续导演", exact: true }).waitFor();
  const begin = requests.slice(directorStart).find(request => request.path.endsWith("/director/tasks/director-1/commands"));
  assert.deepEqual(begin?.body, { commandType: "begin_manual_edit", payload: { chapterIds: ["c1"] } });
  assert.equal(typeof begin.key, "string");
  assert.equal(workspace.manualSessions[0].taskId, "director-1");
  await screenshot("09-director-manual-session");
  await page.getByRole("button", { name: "结束调整并继续导演", exact: true }).click();
  await page.getByRole("link", { name: "查看导演进度", exact: true }).waitFor();
  const commands = requests.slice(directorStart).filter(request => request.path.endsWith("/director/tasks/director-1/commands"));
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[1].body, { commandType: "accept_manual_changes_and_continue", payload: { sessionId: "director-manual-1" } });
  assert.equal(requests.slice(directorStart).filter(request => request.path.endsWith("/runtime/manual-edit")).length, 0);
  assert.equal(workspace.manualSessions[0].status, "completed");
  checks.push("explicit directorTaskId uses original director begin/complete commands and binds the same confirmed session");

  await page.goto(`${origin}/qa?workspaceTaskId=workspace-only&taskId=legacy-alias`);
  await open();
  assert.equal(await page.getByRole("button", { name: "接管导演中的本章", exact: true }).count(), 0);
  const independentStart = requests.length;
  await page.getByRole("button", { name: "接管本章调整", exact: true }).click();
  await page.getByRole("button", { name: "结束交接", exact: true }).waitFor();
  await page.getByRole("button", { name: "结束交接", exact: true }).click();
  await page.getByRole("button", { name: "接管本章调整", exact: true }).waitFor();
  assert.equal(requests.slice(independentStart).filter(request => request.path.includes("/director/tasks/")).length, 0);
  const independent = requests.slice(independentStart).filter(request => request.path.endsWith("/runtime/manual-edit"));
  assert.equal(independent.length, 2);
  assert.equal(independent[0].body.action, "begin");
  assert.equal(independent[1].body.action, "complete");
  assert.equal(await page.getByLabel("原编辑器正文").inputValue(), original);
  await screenshot("10-independent-task-context");
  checks.push("workspaceTaskId and legacy taskId never activate director commands; independent handoff remains intact");
  assert.deepEqual(errors, []);
  const result = { checks, apiRequestCount: requests.length, pageErrors: errors, artifacts, browser: browser.version(), source: "real React components + fixture APIs; no production data or models" };
  await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await screenshot("failed").catch(() => {});
  await fs.writeFile(path.join(artifacts, "failure.json"), JSON.stringify({ checks, requests, errors, error: String(error) }, null, 2));
  console.error(`QA artifacts: ${artifacts}`); throw error;
} finally { await browser.close(); await server.close(); }
