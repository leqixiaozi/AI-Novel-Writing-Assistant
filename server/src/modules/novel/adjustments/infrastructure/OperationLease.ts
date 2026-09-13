import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { conflict, digest, parseJson } from "../domain/contracts";

export interface OperationLeaseOptions {
  leaseDurationMs?: number;
  renewIntervalMs?: number;
  now?: () => number;
}
interface OperationClaim {
  id: string;
  token: string;
  requestHash: string;
  leaseDurationMs: number;
  now: () => number;
  lost: boolean;
}
const claims = new AsyncLocalStorage<{ claim: OperationClaim; deferred?: boolean }>();
const DEFAULT_LEASE_MS = 120_000;
const DEFAULT_RENEW_MS = 15_000;

function lostLease(): never {
  conflict("此操作的执行许可已失效，请查看已保存的结果后重试。", "OPERATION_LEASE_LOST");
}
function liveClaimWhere(claim: OperationClaim) {
  return {
    id: claim.id, status: "running", requestHash: claim.requestHash, resultJson: claim.token,
    updatedAt: { gte: new Date(claim.now() - claim.leaseDurationMs) },
  };
}
function serializeResult(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("Adjustment operations must return a JSON response.");
  return json;
}

/** Called inside the transaction that saves the final business result. */
export async function recordOperationResult<T>(tx: Prisma.TransactionClient | PrismaClient, output: T): Promise<T> {
  const scope = claims.getStore();
  if (!scope) return output;
  const claim = scope.claim;
  if (claim.lost) lostLease();
  const written = await tx.writingAdjustmentOperation.updateMany({
    where: liveClaimWhere(claim),
    data: scope.deferred
      ? { updatedAt: new Date(claim.now()) }
      : { status: "succeeded", resultJson: serializeResult(output), updatedAt: new Date(claim.now()) },
  });
  if (written.count !== 1) lostLease();
  return output;
}

/** A multi-step caller can defer the final response until its last durable step. */
export function withDeferredOperationResult<T>(fn: () => T): T {
  const scope = claims.getStore();
  return scope ? claims.run({ ...scope, deferred: true }, fn) : fn();
}

function keepLeaseAlive(db: PrismaClient, claim: OperationClaim, intervalMs: number): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renewal: Promise<void> | undefined;
  const schedule = () => {
    timer = setTimeout(() => {
      renewal = db.writingAdjustmentOperation.updateMany({
        where: liveClaimWhere(claim), data: { updatedAt: new Date(claim.now()) },
      }).then(result => { if (result.count !== 1) claim.lost = true; })
        .catch(() => { claim.lost = true; })
        .finally(() => { if (!stopped && !claim.lost) schedule(); });
    }, intervalMs);
    timer.unref?.();
  };
  schedule();
  return async () => { stopped = true; if (timer) clearTimeout(timer); await renewal; };
}

/** Reuses the existing operation table; only the owner of an unexpired claim can commit. */
export async function runOperationOnce<T>(db: PrismaClient, novelId: string, operation: string, key: string, input: unknown, action: () => Promise<T>, options: OperationLeaseOptions = {}): Promise<T> {
  const now = options.now ?? Date.now;
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_MS;
  const renewIntervalMs = options.renewIntervalMs ?? DEFAULT_RENEW_MS;
  if (!Number.isFinite(leaseDurationMs) || !Number.isFinite(renewIntervalMs) || renewIntervalMs <= 0 || leaseDurationMs <= renewIntervalMs) throw new Error("Invalid adjustment operation lease timing.");
  const requestKey = digest([novelId, operation, key]);
  const requestHash = digest(input);
  const found = await db.writingAdjustmentOperation.findUnique({ where: { requestKey } });
  if (found?.requestHash !== undefined && found.requestHash !== requestHash) conflict("此操作标识已用于不同内容。", "IDEMPOTENCY_CONFLICT");
  if (found?.status === "succeeded") return parseJson<T>(found.resultJson, null as T);
  const token = JSON.stringify({ kind: "writing-adjustment-lease", owner: randomUUID() });
  const claim: OperationClaim = { id: found?.id ?? randomUUID(), token, requestHash, leaseDurationMs, now, lost: false };
  if (found) {
    const expiredBefore = new Date(now() - leaseDurationMs);
    if (found.status !== "failed" && !(found.status === "running" && found.updatedAt <= expiredBefore)) conflict("操作正在处理，请稍后查看结果。", "OPERATION_IN_PROGRESS");
    const acquired = await db.writingAdjustmentOperation.updateMany({
      where: { id: found.id, requestHash, status: found.status, resultJson: found.resultJson, updatedAt: found.updatedAt },
      data: { status: "running", resultJson: token, updatedAt: new Date(now()) },
    });
    if (acquired.count !== 1) conflict("同一操作正在处理。", "OPERATION_IN_PROGRESS");
  } else {
    try { await db.writingAdjustmentOperation.create({ data: { id: claim.id, novelId, requestKey, requestHash, status: "running", resultJson: token, updatedAt: new Date(now()) } }); }
    catch (error) { if ((error as { code?: string }).code === "P2002") conflict("同一操作正在处理。", "OPERATION_IN_PROGRESS"); throw error; }
  }
  const stopHeartbeat = keepLeaseAlive(db, claim, renewIntervalMs);
  try {
    return await claims.run({ claim }, async () => {
      try {
        const output = await action();
        const saved = await db.writingAdjustmentOperation.findUniqueOrThrow({ where: { id: claim.id } });
        // A business transaction may already have committed the exact HTTP DTO.
        if (saved.status === "succeeded") return parseJson<T>(saved.resultJson, null as T);
        await recordOperationResult(db, output);
        return output;
      } catch (error) {
        const saved = await db.writingAdjustmentOperation.findUniqueOrThrow({ where: { id: claim.id } });
        if (saved.status === "succeeded") return parseJson<T>(saved.resultJson, null as T);
        if (saved.resultJson !== claim.token) lostLease();
        await db.writingAdjustmentOperation.updateMany({
          where: liveClaimWhere(claim), data: { status: "failed", resultJson: JSON.stringify({ error: error instanceof Error ? error.message : "操作失败" }), updatedAt: new Date(now()) },
        });
        throw error;
      }
    });
  } finally { await stopHeartbeat(); }
}
