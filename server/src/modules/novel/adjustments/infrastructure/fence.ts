import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../../../db/prisma";
import { conflict } from "../domain/contracts";

type Db = Prisma.TransactionClient | PrismaClient;
interface FenceContext { epochs: Record<string, number>; manualSessionId?: string }
const context = new AsyncLocalStorage<FenceContext>();
let readiness: { ready: boolean; checkedAt: number } | undefined;
function schemaUnavailable(error: unknown): boolean {
  return !!error && typeof error === "object" && ("code" in error && error.code === "P2021");
}
async function schemaReady(): Promise<boolean> {
  if (readiness?.ready || (readiness && Date.now() - readiness.checkedAt < 5000)) return readiness.ready;
  try {
    // Always probe outside the caller transaction: a missing PG relation aborts its transaction.
    await prisma.chapterAdjustmentGuard.findFirst({ select: { chapterId: true } });
    readiness = { ready: true, checkedAt: Date.now() };
  } catch (error) {
    if (!schemaUnavailable(error)) throw error;
    readiness = { ready: false, checkedAt: Date.now() };
  }
  return readiness.ready;
}
/** Legacy databases can continue operating before the additive optional migration. */
export async function captureAdjustmentFence(novelId: string, chapterIds: string[]): Promise<Record<string, number>> {
  const epochs: Record<string, number> = Object.fromEntries(chapterIds.map(id => [id, 0]));
  if (!await schemaReady()) return epochs;
  try {
    for (const chapterId of chapterIds) {
      const guard = await prisma.chapterAdjustmentGuard.findUnique({ where: { chapterId } });
      if (guard && guard.novelId !== novelId) conflict("章节所属作品不匹配。");
      epochs[chapterId] = guard?.epoch ?? 0;
    }
  } catch (error) { if (!schemaUnavailable(error)) throw error; }
  return epochs;
}
export function runWithCapturedAdjustmentFence<T>(epochs: Record<string, number>, fn: () => T): T {
  return context.run({ epochs, manualSessionId: context.getStore()?.manualSessionId }, fn);
}
export async function runWithAdjustmentFence<T>(novelId: string, chapterIds: string[], fn: () => Promise<T>): Promise<T> {
  if (context.getStore()) return fn();
  return runWithCapturedAdjustmentFence(await captureAdjustmentFence(novelId, chapterIds), fn);
}
export function runWithAuthorizedManualSession<T>(manualSessionId: string, fn: () => T): T {
  return context.run({ epochs: context.getStore()?.epochs ?? {}, manualSessionId }, fn);
}
/** Call with the transaction doing the content/state write: the no-op CAS holds the same row lock as takeover. */
export async function assertAdjustmentWrite(novelId: string, chapterId: string, db: Db = prisma): Promise<void> {
  if (!await schemaReady()) return;
  // Lock an existing common row even before the first guard exists. The same
  // lock is acquired by takeover, so PostgreSQL cannot interleave that gap.
  // Raw SQL deliberately preserves updatedAt and every original data value.
  await db.$executeRaw`UPDATE "Chapter" SET "id" = "id" WHERE "id" = ${chapterId} AND "novelId" = ${novelId}`;
  let guard;
  try { guard = await db.chapterAdjustmentGuard.findUnique({ where: { chapterId } }); }
  catch (error) { if (schemaUnavailable(error)) return; throw error; }
  if (!guard) return;
  if (guard.novelId !== novelId) conflict("章节所属作品不匹配。");
  const token = context.getStore();
  if (guard.manualSessionId && guard.manualSessionId !== token?.manualSessionId) conflict("当前范围由作者接管，请完成调整后继续。", "MANUAL_EDIT_REQUIRED");
  if (token?.epochs[chapterId] !== undefined && token.epochs[chapterId] !== guard.epoch) conflict("该运行的写入许可已失效，结果不能覆盖当前稿。", "REVISION_CONFLICT");
  const result = await db.chapterAdjustmentGuard.updateMany({ where: { chapterId, epoch: guard.epoch, manualSessionId: guard.manualSessionId }, data: { epoch: guard.epoch } });
  if (result.count !== 1) conflict("编辑权限已变化，请刷新当前状态。");
}
