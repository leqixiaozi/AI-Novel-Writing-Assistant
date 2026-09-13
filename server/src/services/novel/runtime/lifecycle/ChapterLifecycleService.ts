import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../db/prisma";
import { withSqliteRetry } from "../../../../db/sqliteRetry";
import {
  mergeChapterPatchForGenerationStateBump,
  type OperationalChapterStatus,
  type PipelineGenerationState,
} from "../../chapterLifecycleState";
import { assertChapterContentNotEmpty } from "../chapterEmptyContentError";
import { assertAdjustmentWrite } from "../../../../modules/novel/adjustments";

export class ChapterContentPersistenceError extends Error {
  constructor(
    readonly chapterId: string,
    message: string,
  ) {
    super(message);
    this.name = "ChapterContentPersistenceError";
  }
}

export class ChapterLifecycleService {
  async saveWorkingContent(input: {
    novelId: string;
    chapterId: string;
    content: string;
    generationState: "drafted" | "repaired";
  }): Promise<string> {
    const content = assertChapterContentNotEmpty(input.content, {
      novelId: input.novelId,
      chapterId: input.chapterId,
      source: "chapter_lifecycle_save",
    });
    try {
      await withSqliteRetry(
        () => prisma.$transaction(async (tx) => {
          await assertAdjustmentWrite(input.novelId, input.chapterId, tx);
          return tx.chapter.update({
            where: { id: input.chapterId },
            data: {
              content,
              generationState: input.generationState,
              chapterStatus: "generating",
            },
          });
        }),
        { label: "chapterLifecycle.saveWorkingContent" },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ChapterContentPersistenceError(input.chapterId, `正文保存失败：${detail}`);
    }
    return content;
  }

  async markChapterStatus(chapterId: string, chapterStatus: OperationalChapterStatus): Promise<void> {
    await withSqliteRetry(
      () => this.withChapterWrite(chapterId, (tx) => tx.chapter.update({
        where: { id: chapterId },
        data: { chapterStatus },
      })),
      { label: "chapterLifecycle.markChapterStatus" },
    );
  }

  async markGenerationState(chapterId: string, generationState: PipelineGenerationState): Promise<void> {
    await withSqliteRetry(
      () => this.withChapterWrite(chapterId, (tx) => tx.chapter.update({
        where: { id: chapterId },
        data: mergeChapterPatchForGenerationStateBump({}, generationState),
      })),
      { label: "chapterLifecycle.markGenerationState" },
    );
  }

  async applyQualityAssessmentState(input: {
    chapterId: string;
    data: Pick<Prisma.ChapterUpdateInput, "riskFlags" | "repairHistory" | "chapterStatus" | "generationState">;
  }): Promise<void> {
    await withSqliteRetry(
      () => this.withChapterWrite(input.chapterId, (tx) => tx.chapter.update({
        where: { id: input.chapterId },
        data: input.data,
      })),
      { label: "chapterLifecycle.applyQualityAssessmentState" },
    );
  }

  private async withChapterWrite<T>(chapterId: string, write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      const chapter = await tx.chapter.findUnique({ where: { id: chapterId }, select: { novelId: true } });
      if (chapter) await assertAdjustmentWrite(chapter.novelId, chapterId, tx);
      return write(tx);
    });
  }
}

export const chapterLifecycleService = new ChapterLifecycleService();
