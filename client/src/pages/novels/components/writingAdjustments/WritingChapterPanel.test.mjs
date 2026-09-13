import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { recoverVersionReview, reviewMatchesDraft } from "./adjustmentState.ts";

const require = createRequire(import.meta.url);
function renderReceipts(receipts) {
  const source = readFileSync(new URL("./WritingChapterPanel.tsx", import.meta.url), "utf8");
  const module = { exports: {} };
  const dependencies = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-router-dom": { Link: ({ to, children }) => React.createElement("a", { href: to }, children) },
    "@/components/ui/button": { Button: ({ children, variant: _variant, size: _size, ...props }) => React.createElement("button", props, children) },
    "./WritingControlsForm": { adjustmentInputClass: "input" },
    "./adjustmentState": { recoverVersionReview, reviewMatchesDraft },
  };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module, exports: module.exports,
    require(id) { if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`); return dependencies[id]; },
  });
  return renderToStaticMarkup(React.createElement(module.exports.WritingChapterPanel, {
    novelId: "n1", chapterId: "c1", currentContent: "原正文", requirements: null, api: {}, busy: false,
    run: async () => { throw new Error("Rendering must not mutate"); }, reload: async () => {},
    workspace: { chapters: [{ id: "c1", order: 1, title: "第一章", content: "原正文", revision: "r1" }], versions: [], manualSessions: [], acceptances: receipts },
  }));
}

test("a superseded acceptance explains the replacement without retrying its old sync or exposing stale errors", () => {
  const html = renderReceipts([{ id: "old", chapterId: "c1", editVersionId: "draft-old", canonicalSyncStatus: "superseded", error: "obsolete upstream failure", nextActions: ["inspect_sync"] }]);
  assert.match(html, /已由更新稿替代，无需同步此版本/u);
  assert.doesNotMatch(html, /重试剩余同步|obsolete upstream failure|待历史依据就绪/u);
});

test("the latest receipt controls the displayed sync state instead of an older failed acceptance", () => {
  const html = renderReceipts([
    { id: "new", chapterId: "c1", editVersionId: "draft-new", canonicalSyncStatus: "succeeded", nextActions: ["continue"] },
    { id: "old", chapterId: "c1", editVersionId: "draft-old", canonicalSyncStatus: "failed", error: "old failure", nextActions: [] },
  ]);
  assert.match(html, /同步完成|可以继续下一章创作/u);
  assert.doesNotMatch(html, /重试剩余同步|old failure/u);
});
