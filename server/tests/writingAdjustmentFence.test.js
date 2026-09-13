const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadRuntimeSource } = require("./novelProduction/sourceHarness.cjs");
const source = (name) => path.resolve(__dirname, "../src", name);
const errors = loadRuntimeSource(source("middleware/errorHandler.ts"), { zod: require("zod") });
const contracts = loadRuntimeSource(source("modules/novel/adjustments/domain/contracts.ts"), {
  "node:crypto": require("node:crypto"), zod: require("zod"), "../../../../middleware/errorHandler": errors,
});

function harness(options = {}) {
  const rows = new Map();
  const calls = [];
  const delegate = {
    async findFirst() { calls.push("probe"); if (options.probeError) throw options.probeError; return null; },
    async findUnique({ where }) { calls.push("read"); return rows.get(where.chapterId) ?? null; },
    async updateMany({ where }) {
      calls.push("cas");
      const row = rows.get(where.chapterId);
      return { count: !options.loseCas && row && row.epoch === where.epoch && row.manualSessionId === where.manualSessionId ? 1 : 0 };
    },
    async create() { throw new Error("capture must not create guards"); },
    async upsert() { throw new Error("capture must not upsert guards"); },
  };
  const db = { chapterAdjustmentGuard: delegate, async $executeRaw() { calls.push("lock-chapter"); return 1; } };
  const fence = loadRuntimeSource(source("modules/novel/adjustments/infrastructure/fence.ts"), {
    "node:async_hooks": require("node:async_hooks"), "../../../../db/prisma": { prisma: db }, "../domain/contracts": contracts,
  });
  return { rows, calls, db, fence };
}
const conflict = (error) => error.statusCode === 409;

test("disabled-path fence capture is read-only and does not materialize guards", async () => {
  const { fence, db, calls, rows } = harness();
  assert.deepEqual(await fence.captureAdjustmentFence("novel", ["chapter"]), { chapter: 0 });
  assert.deepEqual(calls, ["probe", "read"]);
  await fence.runWithCapturedAdjustmentFence({ chapter: 0 }, () => fence.assertAdjustmentWrite("novel", "chapter", db));
  assert.equal(rows.size, 0);
  assert.equal(calls.includes("cas"), false);
  assert.deepEqual(calls.slice(-2), ["lock-chapter", "read"]);
});

test("takeover and completion permanently invalidate the old automatic writer", async () => {
  const { fence, db, rows } = harness();
  const old = await fence.captureAdjustmentFence("novel", ["chapter"]);
  rows.set("chapter", { novelId: "novel", chapterId: "chapter", epoch: 1, manualSessionId: "manual-1" });
  await assert.rejects(fence.runWithCapturedAdjustmentFence(old, () => fence.assertAdjustmentWrite("novel", "chapter", db)), conflict);
  await fence.runWithCapturedAdjustmentFence({ chapter: 1 }, () => fence.runWithAuthorizedManualSession("manual-1", () => fence.assertAdjustmentWrite("novel", "chapter", db)));
  await assert.rejects(fence.runWithCapturedAdjustmentFence({ chapter: 1 }, () => fence.runWithAuthorizedManualSession("other-session", () => fence.assertAdjustmentWrite("novel", "chapter", db))), conflict);
  rows.set("chapter", { novelId: "novel", chapterId: "chapter", epoch: 2, manualSessionId: null });
  await assert.rejects(fence.runWithCapturedAdjustmentFence(old, () => fence.assertAdjustmentWrite("novel", "chapter", db)), conflict);
  await fence.runWithCapturedAdjustmentFence({ chapter: 2 }, () => fence.assertAdjustmentWrite("novel", "chapter", db));
});

test("a second acceptance in the same manual session rejects older sync epochs", async () => {
  const { fence, db, rows } = harness();
  rows.set("chapter", { novelId: "novel", chapterId: "chapter", epoch: 3, manualSessionId: "manual-1" });
  await assert.rejects(fence.runWithCapturedAdjustmentFence({ chapter: 2 }, () => fence.runWithAuthorizedManualSession("manual-1", () => fence.assertAdjustmentWrite("novel", "chapter", db))), conflict);
  await fence.runWithCapturedAdjustmentFence({ chapter: 3 }, () => fence.runWithAuthorizedManualSession("manual-1", () => fence.assertAdjustmentWrite("novel", "chapter", db)));
});

test("schema compatibility probe occurs outside supplied transaction and only missing table is tolerated", async () => {
  const unavailable = harness({ probeError: Object.assign(new Error("missing table"), { code: "P2021" }) });
  const tx = { chapterAdjustmentGuard: { findUnique() { throw new Error("must not query absent table inside transaction"); } } };
  assert.deepEqual(await unavailable.fence.captureAdjustmentFence("novel", ["chapter"]), { chapter: 0 });
  await unavailable.fence.assertAdjustmentWrite("novel", "chapter", tx);
  assert.equal(unavailable.calls.filter(c => c === "probe").length, 1);
  const broken = harness({ probeError: Object.assign(new Error("connection failed"), { code: "P1001" }) });
  await assert.rejects(broken.fence.captureAdjustmentFence("novel", ["chapter"]), /connection failed/);
});

test("transaction CAS loss and a chapter from another novel fail closed", async () => {
  const { fence, rows, db } = harness({ loseCas: true });
  rows.set("chapter", { novelId: "novel", chapterId: "chapter", epoch: 1, manualSessionId: null });
  await assert.rejects(fence.runWithCapturedAdjustmentFence({ chapter: 1 }, () => fence.assertAdjustmentWrite("novel", "chapter", db)), conflict);
  await assert.rejects(fence.captureAdjustmentFence("other-novel", ["chapter"]), conflict);
});
