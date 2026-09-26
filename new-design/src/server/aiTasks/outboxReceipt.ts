import type { BackgroundJob } from "../../common/contracts";
import type { PoolClient } from "pg";
import type { RegisteredBackgroundHandlerResult, RegisteredBackgroundHandlers } from "../database/outbox";
import { getNewDesignPool } from "../database/runtime";
import { NewDesignError } from "../domain/errors";

type ReceiptJob = Pick<BackgroundJob, "specializedRequestId" | "bookId" | "executionGeneration">;
type ReceiptRow = {
  task_id: string;
  book_id: string | null;
  task_status: string;
  step_status: string | null;
  attempt_status: string | null;
  result_kind: string | null;
  result_stable_id: string | null;
  result_version_id: string | null;
  result_hash: string | null;
  artifact_id: string | null;
  artifact_document_id: string | null;
  artifact_hash: string | null;
  error_category?: string | null;
};

/** This handler only acknowledges an already terminal professional ledger. It never starts AI work. */
export function resolveTerminalAiTaskReceipt(job: ReceiptJob, rows: ReceiptRow[]): RegisteredBackgroundHandlerResult {
  if (rows.length !== 1) throw new NewDesignError("AI 任务步骤未能唯一核对，保留原作业待检查。", 409);
  const row = rows[0];
  if (row.task_id !== job.specializedRequestId || row.book_id !== job.bookId) {
    throw new NewDesignError("AI 任务与后台作业的书籍或请求不一致。", 409);
  }
  const idempotencyKey = `ai-task-ledger:${row.task_id}:generation:${job.executionGeneration}`;
  if (row.task_status === "failed" && row.step_status === "failed" && row.attempt_status === "failed") {
    return {
      outcome: "business_rejected",
      resultMetadata: { taskId: row.task_id, sourceStatus: "failed", errorCategory: row.error_category ?? "unknown" },
      idempotencyKey,
    };
  }
  if (row.task_status === "succeeded" && row.step_status === "succeeded" && row.attempt_status === "succeeded"
      && row.result_kind === "chapter_body_version" && row.result_version_id && row.result_stable_id && row.result_hash
      && row.artifact_id === row.result_version_id && row.artifact_document_id === row.result_stable_id
      && row.artifact_hash === row.result_hash) {
    return {
      outcome: "applied",
      specializedResultKind: "chapter_body_version",
      specializedResultId: row.result_version_id,
      resultHash: row.result_hash,
      resultMetadata: { taskId: row.task_id, sourceStatus: "succeeded" },
      idempotencyKey,
    };
  }
  throw new NewDesignError("AI 任务尚未结束，或原候选版本与回执不一致；不会重新调用模型。", 409);
}

export async function readTerminalAiTaskReceipt(job: ReceiptJob, client: Pick<PoolClient, "query">): Promise<RegisteredBackgroundHandlerResult> {
  const rows = (await client.query<ReceiptRow>(`
    SELECT task.id AS task_id, task.book_id, task.status AS task_status,
           step.status AS step_status, attempt.status AS attempt_status,
           attempt.result_kind, attempt.result_stable_id, attempt.result_version_id,
           attempt.result_hash, attempt.error_category,
           body.id AS artifact_id, body.chapter_document_id AS artifact_document_id,
           body.content_hash AS artifact_hash
      FROM new_design.ai_tasks task
      LEFT JOIN new_design.ai_task_steps step ON step.task_id = task.id
      LEFT JOIN new_design.ai_task_attempts attempt ON attempt.id = step.current_attempt_id
      LEFT JOIN new_design.chapter_body_versions body ON body.id = attempt.result_version_id
     WHERE task.id = $1`, [job.specializedRequestId])).rows;
  return resolveTerminalAiTaskReceipt(job, rows);
}

export function createAiTaskReceiptBackgroundHandlers(): RegisteredBackgroundHandlers {
  return {
    "ai.task": async ({ job, heartbeat }) => {
      await heartbeat();
      const pool = await getNewDesignPool();
      return readTerminalAiTaskReceipt(job, pool);
    },
  };
}
