import type { NovelSideEffectJob } from "@prisma/client";
import { z } from "zod";
import { getSharedNovelServices } from "../../services/novel/application/sharedNovelServices";
import { characterDynamicsService } from "../../services/novel/dynamics/CharacterDynamicsService";
import { payoffLedgerSyncService } from "../../services/payoff/PayoffLedgerSyncService";
import { prisma } from "../../db/prisma";
import {
  type BookContractPayoffSyncPayload,
  NOVEL_SIDE_EFFECT_PAYLOAD_VERSION,
  type CharacterPostDraftEnrichmentPayload,
  type CharacterVolumeRebuildPayload,
  type PipelineSnapshotPayload,
  type WritingAdjustmentSyncPayload,
} from "./NovelSideEffectJobTypes";

const writingAdjustmentSyncPayloadSchema = z.object({
  novelId: z.string().min(1), chapterId: z.string().min(1), acceptanceId: z.string().min(1),
  contentHash: z.string().min(1), epochs: z.record(z.string(), z.number().int().nonnegative()),
  manualSessionId: z.string().min(1).nullable().optional(),
}).refine((value) => Object.hasOwn(value.epochs, value.chapterId), "同步任务缺少章节写入许可。");

export class UnsupportedNovelSideEffectPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedNovelSideEffectPayloadError";
  }
}

function parsePayload<T>(job: NovelSideEffectJob): T {
  if (job.payloadVersion !== NOVEL_SIDE_EFFECT_PAYLOAD_VERSION) {
    throw new UnsupportedNovelSideEffectPayloadError(
      `Unsupported novel side effect payload version ${job.payloadVersion}.`,
    );
  }
  const parsed = JSON.parse(job.payloadJson) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UnsupportedNovelSideEffectPayloadError("Novel side effect payload must be an object.");
  }
  return parsed as T;
}

export class NovelSideEffectJobHandlers {
  constructor(
    private readonly dependencies: {
      syncPayoffLedger?: (novelId: string) => Promise<unknown>;
      syncWritingAdjustment?: (payload: WritingAdjustmentSyncPayload) => Promise<unknown>;
    } = {},
  ) {}

  async execute(job: NovelSideEffectJob): Promise<void> {
    switch (job.jobType) {
      case "writing.adjustmentSync": {
        const payload = writingAdjustmentSyncPayloadSchema.parse(parsePayload<WritingAdjustmentSyncPayload>(job));
        if (job.novelId !== payload.novelId) throw new UnsupportedNovelSideEffectPayloadError("同步任务的作品归属不一致。");
        const synchronize = this.dependencies.syncWritingAdjustment ?? (async (input: WritingAdjustmentSyncPayload) => {
          const { adjustmentService } = await import("../../modules/novel/adjustments");
          return adjustmentService.synchronize(input);
        });
        await synchronize(payload);
        return;
      }
      case "character.volumeRebuild": {
        const payload = parsePayload<CharacterVolumeRebuildPayload>(job);
        await characterDynamicsService.rebuildDynamics(payload.novelId, {
          sourceType: payload.sourceType,
        });
        return;
      }
      case "character.postDraftEnrichment": {
        const payload = parsePayload<CharacterPostDraftEnrichmentPayload>(job);
        const activeProduction = await prisma.generationJob.findFirst({
          where: {
            novelId: payload.novelId,
            status: { in: ["queued", "running"] },
          },
          select: { id: true },
        });
        if (activeProduction) {
          throw new Error("正文生产仍在运行，延迟角色增强等待低优先级重试。");
        }
        await getSharedNovelServices().runDeferredCharacterEnhancements(payload.novelId);
        return;
      }
      case "novel.pipelineSnapshot": {
        const payload = parsePayload<PipelineSnapshotPayload>(job);
        await getSharedNovelServices().createNovelSnapshot(
          payload.novelId,
          "auto_milestone",
          payload.label,
        );
        return;
      }
      case "payoff.bookContractSync": {
        const payload = parsePayload<BookContractPayoffSyncPayload>(job);
        await (this.dependencies.syncPayoffLedger ?? ((novelId: string) => (
          payoffLedgerSyncService.syncLedger(novelId)
        )))(payload.novelId);
        return;
      }
      default:
        throw new UnsupportedNovelSideEffectPayloadError(`Unsupported novel side effect job type ${job.jobType}.`);
    }
  }
}

