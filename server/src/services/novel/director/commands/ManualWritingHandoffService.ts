import { prisma } from "../../../../db/prisma";
import { AppError } from "../../../../middleware/errorHandler";
import { adjustmentService } from "../../../../modules/novel/adjustments";

async function requireTaskNovel(taskId: string): Promise<string> {
  const task = await prisma.novelWorkflowTask.findUnique({ where: { id: taskId }, select: { novelId: true, lane: true } });
  if (!task?.novelId) throw new AppError("该任务没有关联作品，无法接管章节。", 400);
  if (task.lane !== "auto_director") throw new AppError("请选择此作品的自动导演任务。", 400);
  return task.novelId;
}

export async function beginDirectorManualWriting(taskId: string, chapterIds: string[]) {
  const novelId = await requireTaskNovel(taskId);
  // Receipt is returned only after the transactional write barrier is installed.
  return adjustmentService.beginManual(novelId, { chapterIds, taskId });
}

export async function completeDirectorManualWriting(taskId: string, sessionId: string) {
  const novelId = await requireTaskNovel(taskId);
  const session = await prisma.manualEditSession.findFirst({ where: { id: sessionId, novelId, taskId } });
  if (!session) throw new AppError("人工调整会话不属于当前任务。", 409);
  const completed = await adjustmentService.store.withDeferredResult(() => adjustmentService.completeManual(novelId, sessionId));
  const otherSessions = await prisma.manualEditSession.count({ where: { novelId, taskId, status: "active" } });
  if (otherSessions) throw new AppError("此范围已结束调整；请先完成该导演任务的其他人工调整，再继续导演。", 409);
  return completed;
}

export async function withDirectorManualOperation<T>(taskId: string, key: string | undefined, operation: string, input: unknown, action: () => Promise<T>) {
  if (!key || key.length > 200) throw new AppError("请为本次人工交接提供有效操作标识。", 400);
  const novelId = await requireTaskNovel(taskId);
  return adjustmentService.store.once(novelId, `director:${taskId}:${operation}`, key, input, action);
}
