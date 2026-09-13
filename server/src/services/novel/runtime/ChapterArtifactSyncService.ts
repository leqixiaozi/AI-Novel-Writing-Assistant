import type { RagOwnerType } from "../../rag/types";
import type { Prisma } from "@prisma/client";
import { assertAdjustmentWrite } from "../../../modules/novel/adjustments";
import { prisma } from "../../../db/prisma";
import { withSqliteRetry } from "../../../db/sqliteRetry";
import { ragServices } from "../../rag";
import { briefSummary, extractFacts } from "../novelP0Utils";
import { chapterArtifactBackgroundSyncService } from "./ChapterArtifactBackgroundSyncService";
import type { ArtifactSyncMode } from "../novelCoreShared";
import { buildContentHash } from "./ChapterArtifactDeltaService";
import {
  ChapterArtifactContentVersionError,
  mergeChapterArtifactSyncResults,
  type ChapterArtifactSyncResult,
} from "./artifactSync/ChapterArtifactSyncResult";
import type { ContentProvenance } from "@ai-novel/shared/types/canonicalState";
import {
  chapterLifecycleService,
  type ChapterLifecycleService,
} from "./lifecycle";

export type ChapterArtifactLocalStage = "legacy_summary_and_facts" | "character_timeline";

export interface ChapterArtifactSyncOptions {
  scheduleBackgroundSync?: boolean;
  artifactSyncMode?: ArtifactSyncMode;
  syncArtifacts?: boolean;
  awaitArtifactDelta?: boolean;
  skipLegacySummaryAndFacts?: boolean;
  provider?: string;
  model?: string;
  temperature?: number;
  contentProvenance?: ContentProvenance;
  /** Optional outbox retry checkpoints, valid only for this exact content hash. */
  completedLocalStages?: ChapterArtifactLocalStage[];
  /** Persist the stage marker in the SAME transaction as its artifact writes. */
  onLocalStageCompleted?: (stage: ChapterArtifactLocalStage, tx: Prisma.TransactionClient) => Promise<void>;
}

export class ChapterArtifactSyncService {
  constructor(
    private readonly lifecycleService: Pick<ChapterLifecycleService, "saveWorkingContent"> = chapterLifecycleService,
  ) {}

  async saveDraftAndArtifacts(
    novelId: string,
    chapterId: string,
    content: string,
    generationState: "drafted" | "repaired",
    options: ChapterArtifactSyncOptions = {},
  ): Promise<void> {
    const safeContent = await this.lifecycleService.saveWorkingContent({
      novelId,
      chapterId,
      content,
      generationState,
    });
    if (options.syncArtifacts === false) {
      return;
    }
    await this.syncChapterArtifacts(novelId, chapterId, safeContent, options);
  }

  async syncChapterArtifacts(
    novelId: string,
    chapterId: string,
    content: string,
    options: ChapterArtifactSyncOptions = {},
  ): Promise<ChapterArtifactSyncResult> {
    const contentHash = buildContentHash(content);
    const completedArtifacts: string[] = [];
    if (!options.skipLegacySummaryAndFacts && !options.completedLocalStages?.includes("legacy_summary_and_facts")) {
      const facts = extractFacts(content);
      const summary = briefSummary(content, facts);

      await withSqliteRetry(
        () => prisma.$transaction(async (tx) => {
          await assertAdjustmentWrite(novelId, chapterId, tx);
          const current = await tx.chapter.findFirst({
            where: { id: chapterId, novelId },
            select: { content: true },
          });
          if (!current || buildContentHash(current.content ?? "") !== contentHash) {
            throw new ChapterArtifactContentVersionError("章节正文版本已变化，已拒绝写入过期基础资产。");
          }
          await tx.chapterSummary.upsert({
            where: { chapterId },
            update: {
              summary,
              keyEvents: facts.map((item) => item.content).slice(0, 3).join(""),
              characterStates: facts.filter((item) => item.category === "character").map((item) => item.content).slice(0, 3).join(""),
            },
            create: {
              novelId,
              chapterId,
              summary,
              keyEvents: facts.map((item) => item.content).slice(0, 3).join(""),
              characterStates: facts.filter((item) => item.category === "character").map((item) => item.content).slice(0, 3).join(""),
            },
          });

          await tx.consistencyFact.deleteMany({ where: { novelId, chapterId } });
          if (facts.length > 0) {
            await tx.consistencyFact.createMany({
              data: facts.map((item) => ({
                novelId,
                chapterId,
                category: item.category,
                content: item.content,
                source: "chapter_auto_extract",
              })),
            });
          }
          await options.onLocalStageCompleted?.("legacy_summary_and_facts", tx);
        }),
        { label: "chapterArtifactSync.summaryAndFacts" },
      );
      completedArtifacts.push("legacy_summary_and_facts");
    } else if (options.completedLocalStages?.includes("legacy_summary_and_facts")) {
      completedArtifacts.push("legacy_summary_and_facts");
    }

    if (!options.completedLocalStages?.includes("character_timeline")) {
      await this.syncCharacterTimelineForChapter(novelId, chapterId, content, options.onLocalStageCompleted);
    }
    completedArtifacts.push("character_timeline");
    let deltaResult: ChapterArtifactSyncResult | null = null;
    if (options.scheduleBackgroundSync !== false) {
      const artifactSyncMode = options.artifactSyncMode ?? "adaptive";
      if (options.awaitArtifactDelta || artifactSyncMode === "strict") {
        deltaResult = await chapterArtifactBackgroundSyncService.runChapterSyncNow(novelId, chapterId, content, {
          artifactSyncMode,
          provider: options.provider,
          model: options.model,
          temperature: options.temperature,
          contentProvenance: options.contentProvenance,
        });
      } else {
        chapterArtifactBackgroundSyncService.scheduleChapterSync(novelId, chapterId, content, {
          artifactSyncMode,
          provider: options.provider,
          model: options.model,
          temperature: options.temperature,
          contentProvenance: options.contentProvenance,
        });
        deltaResult = {
          status: "pending",
          contentHash,
          completedArtifacts: [],
          reason: "章节资产已进入后台同步队列。",
        };
      }
    }
    this.queueRagUpsert("chapter", chapterId);
    this.queueRagUpsert("chapter_summary", chapterId);
    this.queueRagUpsert("novel", novelId);

    const factRows = await prisma.consistencyFact.findMany({
      where: { novelId, chapterId },
      select: { id: true },
    });
    for (const fact of factRows) {
      this.queueRagUpsert("consistency_fact", fact.id);
    }

    const localResult: ChapterArtifactSyncResult = {
      status: "completed",
      contentHash,
      completedArtifacts,
    };
    return deltaResult
      ? mergeChapterArtifactSyncResults(contentHash, localResult, deltaResult)
      : localResult;
  }

  private async syncCharacterTimelineForChapter(
    novelId: string,
    chapterId: string,
    content: string,
    onStageCompleted?: ChapterArtifactSyncOptions["onLocalStageCompleted"],
  ): Promise<void> {
    const [chapter, characters] = await Promise.all([
      prisma.chapter.findFirst({
        where: { id: chapterId, novelId },
        select: { order: true, title: true },
      }),
      prisma.character.findMany({
        where: { novelId },
        select: { id: true, name: true },
      }),
    ]);

    if (!chapter) {
      if (onStageCompleted) throw new ChapterArtifactContentVersionError("章节不存在，无法完成角色时间线同步。");
      return;
    }
    if (characters.length === 0 && !onStageCompleted) return;

    const events: Array<{
      novelId: string;
      characterId: string;
      chapterId: string;
      chapterOrder: number;
      title: string;
      content: string;
      source: string;
    }> = [];

    for (const character of characters) {
      const lines = content
        .split(/[\n。！？!?]/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 8 && item.includes(character.name))
        .slice(0, 3);
      for (const line of lines) {
        events.push({
          novelId,
          characterId: character.id,
          chapterId,
          chapterOrder: chapter.order,
          title: `${chapter.order} - ${chapter.title}`,
          content: line,
          source: "chapter_extract",
        });
      }
    }

    await withSqliteRetry(
      () => prisma.$transaction(async (tx) => {
        await assertAdjustmentWrite(novelId, chapterId, tx);
        const current = await tx.chapter.findFirst({
          where: { id: chapterId, novelId },
          select: { content: true },
        });
        if (!current || buildContentHash(current.content ?? "") !== buildContentHash(content)) {
          throw new ChapterArtifactContentVersionError("章节正文版本已变化，已拒绝写入过期角色时间线。");
        }
        await tx.characterTimeline.deleteMany({
          where: {
            novelId,
            chapterId,
            source: "chapter_extract",
          },
        });
        if (events.length > 0) {
          await tx.characterTimeline.createMany({ data: events });
        }
        await onStageCompleted?.("character_timeline", tx);
      }),
      { label: "chapterArtifactSync.characterTimeline" },
    );

    const timelines = await prisma.characterTimeline.findMany({
      where: {
        novelId,
        chapterId,
        source: "chapter_extract",
      },
      select: { id: true },
    });
    for (const timeline of timelines) {
      this.queueRagUpsert("character_timeline", timeline.id);
    }
  }

  private queueRagUpsert(ownerType: RagOwnerType, ownerId: string): void {
    void ragServices.ragIndexService.enqueueUpsert(ownerType, ownerId).catch(() => {});
  }
}
