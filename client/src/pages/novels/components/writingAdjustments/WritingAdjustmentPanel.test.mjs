import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function loadPanel(react = React) {
  let apiInitializations = 0;
  const source = readFileSync(new URL("./WritingAdjustmentPanel.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const dependencies = {
    react,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-router-dom": {},
    "@/api/writingAdjustments": { createWritingAdjustmentApi() { apiInitializations += 1; throw new Error("Closed panel must not initialize its workspace"); } },
    "@/components/ui/button": { Button: () => null },
    "./adjustmentState": {},
    "./WritingControlsForm": {},
    "./WritingChapterPanel": {},
    "./WritingEvidencePanel": {},
    "./WritingPlanPanel": {},
    "./WritingLinesPanel": {},
  };
  vm.runInNewContext(code, { module, exports: module.exports, require(id) {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
    return dependencies[id];
  } });
  return { Panel: module.exports.WritingAdjustmentPanel, apiInitializations: () => apiInitializations };
}

test("an untouched chapter renders a closed optional entry without mounting its data workspace", () => {
  const { Panel, apiInitializations } = loadPanel();
  const html = renderToStaticMarkup(React.createElement(Panel, { novelId: "n1", chapterId: "c1", currentContent: "现有正文" }));
  assert.match(html, /人工调整（可选）/u);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:\s|=|>)/u);
  assert.doesNotMatch(html, /textarea|input|select|button/u);
  assert.equal(apiInitializations(), 0);
});

test("closing the entry does not initiate workspace loading; the explicit open does", () => {
  const transitions = [];
  const { Panel, apiInitializations } = loadPanel({ ...React, useState: () => [false, (value) => transitions.push(value)] });
  const tree = Panel({ novelId: "n1" });
  tree.props.onToggle({ currentTarget: { open: false } });
  assert.deepEqual(transitions, []);
  tree.props.onToggle({ currentTarget: { open: true } });
  assert.deepEqual(transitions, [true]);
  assert.equal(apiInitializations(), 0);
});
