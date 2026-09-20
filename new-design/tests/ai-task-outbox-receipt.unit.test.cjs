const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveTerminalAiTaskReceipt } = require("../dist/server/aiTasks/outboxReceipt.js");

const job = {
  specializedRequestId: "task-1",
  bookId: "book-1",
  executionGeneration: 1,
};
const success = {
  task_id: "task-1",
  book_id: "book-1",
  task_status: "succeeded",
  step_status: "succeeded",
  attempt_status: "succeeded",
  result_kind: "chapter_body_version",
  result_stable_id: "document-1",
  result_version_id: "version-1",
  result_hash: "hash-1",
  artifact_id: "version-1",
  artifact_document_id: "document-1",
  artifact_hash: "hash-1",
};

test("terminal AI success reconciles the existing body version without model execution", () => {
  assert.deepEqual(resolveTerminalAiTaskReceipt(job, [success]), {
    outcome: "applied",
    specializedResultKind: "chapter_body_version",
    specializedResultId: "version-1",
    resultHash: "hash-1",
    resultMetadata: { taskId: "task-1", sourceStatus: "succeeded" },
    idempotencyKey: "ai-task-ledger:task-1:generation:1",
  });
});

test("terminal AI failure remains a business rejection with no retry request", () => {
  const failed = { ...success, task_status: "failed", step_status: "failed", attempt_status: "failed", result_kind: null, result_stable_id: null, result_version_id: null, result_hash: null, artifact_id: null, artifact_document_id: null, artifact_hash: null, error_category: "structure_parse" };
  assert.deepEqual(resolveTerminalAiTaskReceipt(job, [failed]), {
    outcome: "business_rejected",
    resultMetadata: { taskId: "task-1", sourceStatus: "failed", errorCategory: "structure_parse" },
    idempotencyKey: "ai-task-ledger:task-1:generation:1",
  });
});

test("nonterminal, cross-book, incomplete and changed artifacts cannot be reconciled", () => {
  for (const rows of [
    [{ ...success, task_status: "queued" }],
    [{ ...success, book_id: "other-book" }],
    [{ ...success, artifact_hash: "changed" }],
    [{ ...success, artifact_id: null }],
    [success, success],
    [],
  ]) assert.throws(() => resolveTerminalAiTaskReceipt(job, rows));
});
