import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { renderPlannedHookGuidance } from "../../prompting/prompts/novel/plannedHookGuidance";

/** Author plans are separate from listOpenHooks and never enter historical knowledge. */
export class TimelineHookPlanService {
  constructor(private readonly db: Pick<PrismaClient, "timelineHook" | "chapter"> = prisma) {}
  async buildForChapter(input: { novelId: string; chapterId: string }): Promise<string> {
    const chapter = await this.db.chapter.findFirst({ where: { id: input.chapterId, novelId: input.novelId }, select: { order: true } });
    if (!chapter) return "";
    const hooks = await this.db.timelineHook.findMany({ where: { novelId: input.novelId, status: "planned", OR: [{ createdInChapterId: input.chapterId }, { expectedResolveByChapterIndex: chapter.order }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return renderPlannedHookGuidance(hooks.map(hook => ({ id: hook.id, title: hook.title, description: hook.description, setup: hook.createdInChapterId === input.chapterId, payoff: hook.expectedResolveByChapterIndex === chapter.order })));
  }
}
export const timelineHookPlanService = new TimelineHookPlanService();
