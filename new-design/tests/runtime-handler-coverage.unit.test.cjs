const test = require("node:test");
const assert = require("node:assert/strict");
const { getUnloadedBackgroundHandlers } = require("../dist/server/database/developmentRuntime.js");

test("runtime diagnostics identify active consumers without loaded handlers", () => {
  assert.deepEqual(
    getUnloadedBackgroundHandlers(["ai.task", "graph.project", "publication.export"], ["publication.export"]),
    ["ai.task", "graph.project"],
  );
});
