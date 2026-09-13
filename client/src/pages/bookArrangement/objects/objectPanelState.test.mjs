import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { definitivelyRejectedObjectApply, editableObjectPatch, objectRemoval, recoverObjectCandidate, validateObjectFields } from "./objectPanelState.ts";

const require = createRequire(import.meta.url);
const definition = [
  { key: "title", label: "名称", type: "text", required: true },
  { key: "day", label: "故事日", type: "number", required: true },
  { key: "active", label: "启用", type: "boolean", required: true },
  { key: "source", label: "证据来源", type: "text", readOnly: true },
];
const detail = { fields: { title: "旧名", day: 1, active: true, source: "source-original" }, fieldDefinitions: definition };

test("object patches preserve legal zero and false, omit readonly evidence and unknown fields", () => {
  const fields = { ...detail.fields, day: 0, active: false, source: "tampered", injected: "unknown" };
  assert.deepEqual(editableObjectPatch(detail, fields, false), { day: 0, active: false });
  assert.equal(validateObjectFields(definition, fields), null);
});
test("object creation includes only declared writable inputs while required blanks and nonfinite numbers fail", () => {
  assert.deepEqual(editableObjectPatch(detail, { title: "新增", day: 0, active: false, source: "ignored" }, true), { title: "新增", day: 0, active: false });
  assert.equal(validateObjectFields(definition, { ...detail.fields, title: "  " }), "请填写名称。");
  assert.equal(validateObjectFields(definition, { ...detail.fields, day: Infinity }), "故事日需要有效数字。");
});

test("removal labels distinguish retained records from scene deletion", () => {
  assert.equal(objectRemoval.event.action, "取消事件计划");
  assert.match(objectRemoval.event.explanation, /记录保留/);
  assert.equal(objectRemoval.hook.action, "放弃线索计划");
  assert.equal(objectRemoval.relation.action, "停用关系安排");
  assert.equal(objectRemoval.scene.action, "删除场景");
  assert.match(objectRemoval.scene.explanation, /候选保留调整前内容/);
});

test("lost-response recovery recognizes the same accepted candidate despite stale creation input", () => {
  const candidate = { id: "candidate-1", objectId: "event-1", kind: "event", action: "create", baseRevision: "old" };
  const receipt = { id: "candidate-1", objectId: "event-1", kind: "event", status: "applied" };
  const accepted = { ...candidate, applied: receipt };
  assert.equal(recoverObjectCandidate(candidate, [accepted]), accepted);
  assert.equal(recoverObjectCandidate(accepted, []), accepted);
  assert.equal(recoverObjectCandidate(candidate, [{ ...accepted, id: "candidate-2" }]), candidate);
  assert.equal(recoverObjectCandidate(candidate, [{ ...accepted, objectId: "event-2" }]), candidate);
});

test("network errors and operation leases retain uncertain apply state; actual revision rejection releases editing", () => {
  assert.equal(definitivelyRejectedObjectApply(new Error("disconnected")), false);
  assert.equal(definitivelyRejectedObjectApply({ response: { status: 500 } }), false);
  assert.equal(definitivelyRejectedObjectApply({ response: { status: 409, data: { errorCode: "OPERATION_IN_PROGRESS" } } }), false);
  assert.equal(definitivelyRejectedObjectApply({ response: { status: 409, data: { errorCode: "REQUIREMENTS_STALE" } } }), true);
});

function loadFields() {
  const source = readFileSync(new URL("./ArrangementObjectFields.tsx", import.meta.url), "utf8");
  const module = { exports: {} };
  const dependencies = { "react/jsx-runtime": require("react/jsx-runtime"), "@/pages/novels/components/writingAdjustments/WritingControlsForm": { adjustmentInputClass: "input" } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { module, exports: module.exports, require(id) { if (!(id in dependencies)) throw new Error(`Unexpected module ${id}`); return dependencies[id]; } });
  return module.exports;
}
test("object fields render stable character IDs for duplicate names, visible zero and readonly snapshots", () => {
  const { ArrangementObjectFields, objectFieldText } = loadFields();
  const workspace = { characters: [{ id: "person-a", name: "林舟" }, { id: "person-b", name: "林舟" }], chapters: [], events: [], volumes: [] };
  const object = { editable: true, fields: {}, fieldDefinitions: [{ key: "person", label: "人物", type: "character" }, { key: "day", label: "故事日", type: "number" }] };
  const html = renderToStaticMarkup(React.createElement(ArrangementObjectFields, { workspace, detail: object, fields: { person: "person-b", day: 0 }, onChange() { throw new Error("Render cannot mutate"); } }));
  assert.match(html, /value="person-b" selected=""/);
  assert.match(html, /type="number"[^>]*value="0"/);
  assert.equal(objectFieldText({ key: "day", type: "number" }, 0, workspace), "0");
  const readonly = renderToStaticMarkup(React.createElement(ArrangementObjectFields, { workspace, detail: { ...object, editable: false }, fields: { person: "person-b", day: 0 }, onChange() { throw new Error("Readonly render cannot mutate"); } }));
  assert.doesNotMatch(readonly, /<input|<select/);
  assert.match(readonly, /林舟/);
  const missing = renderToStaticMarkup(React.createElement(ArrangementObjectFields, { workspace, detail: { ...object, fieldDefinitions: [{ key: "people", label: "人物", type: "characters" }] }, fields: { people: ["deleted-id"] }, onChange() {} }));
  assert.match(missing, /移除无法定位的引用 deleted-id/);
  assert.match(missing, /取消勾选可移除/);
});
