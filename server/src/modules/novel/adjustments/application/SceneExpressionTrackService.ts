import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SceneExpressionPoint, SceneExpressionPointSaveReceipt } from "@ai-novel/shared/types/sceneExpressionTracks";
import { SCENE_EXPRESSION_DIMENSION_KEYS } from "@ai-novel/shared/types/sceneExpressionTracks";
import { AppError } from "../../../../middleware/errorHandler";
import { conflict, digest } from "../domain/contracts";
import { AdjustmentStore } from "../infrastructure/AdjustmentStore";
import { batchContextCache } from "../../../../services/novel/runtime/BatchContextCache";

const pointSchema = z.object({
  sceneId: z.string().trim().min(1).max(200),
  dimensionKey: z.enum(SCENE_EXPRESSION_DIMENSION_KEYS, { error: "请选择有效的场景表达维度。" }),
  level: z.number({ error: "请选择有效的表达档位。" }).int().min(1, "表达档位只能是 L1—L5。").max(5, "表达档位只能是 L1—L5。"),
  note: z.string().trim().max(500).nullable().optional(),
}).strict();

export const sceneExpressionSaveSchema = z.object({
  expectedRevision: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
  points: z.array(pointSchema).max(10000),
}).strict();

type PointRow = Awaited<ReturnType<SceneExpressionTrackService["rows"]>>[number];

export class SceneExpressionTrackService {
  constructor(readonly store: AdjustmentStore) {}

  private rows(novelId: string) {
    return this.store.db.sceneExpressionPoint.findMany({
      where: { novelId },
      orderBy: [{ sceneId: "asc" }, { dimensionKey: "asc" }],
    });
  }

  private revision(rows: PointRow[], enabled: boolean) {
    return digest([enabled, rows.map(row => [row.id, row.sceneId, row.dimensionKey, row.level, row.note, row.revision, row.updatedAt.toISOString()])]);
  }

  private map(row: PointRow): SceneExpressionPoint {
    return { ...row, dimensionKey: row.dimensionKey as SceneExpressionPoint["dimensionKey"], level: row.level as SceneExpressionPoint["level"], createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  async list(novelId: string): Promise<SceneExpressionPointSaveReceipt> {
    const [novel, rows] = await Promise.all([this.store.novel(novelId), this.rows(novelId)]);
    return { enabled: novel.sceneExpressionTracksEnabled, revision: this.revision(rows, novel.sceneExpressionTracksEnabled), points: rows.map(row => this.map(row)) };
  }

  async save(novelId: string, raw: unknown): Promise<SceneExpressionPointSaveReceipt> {
    const input = sceneExpressionSaveSchema.parse(raw);
    const bindings = new Set<string>();
    for (const point of input.points) {
      const binding = `${point.sceneId}:${point.dimensionKey}`;
      if (bindings.has(binding)) throw new AppError("同一场景的同一表达维度只能保存一个档位。", 400);
      bindings.add(binding);
    }
    const sceneIds = [...new Set(input.points.map(point => point.sceneId))];

    try {
      const receipt = await this.store.db.$transaction(async tx => {
        const novel = await tx.novel.findUnique({ where: { id: novelId }, select: { id: true, sceneExpressionTracksEnabled: true } });
        if (!novel) throw new AppError("作品不存在。", 404);
        if (sceneIds.length) {
          const owned = await tx.chapterPlanScene.findMany({ where: { id: { in: sceneIds }, plan: { novelId, chapterId: { not: null } } }, select: { id: true } });
          if (owned.length !== sceneIds.length) throw new AppError("表达点中的场景不存在或不属于当前作品。", 400);
        }
        const current = await tx.sceneExpressionPoint.findMany({ where: { novelId }, orderBy: [{ sceneId: "asc" }, { dimensionKey: "asc" }] });
        if (this.revision(current, novel.sceneExpressionTracksEnabled) !== input.expectedRevision) conflict("场景表达轨道已在其他窗口修改，请刷新后重试。", "SCENE_EXPRESSION_REVISION_CONFLICT");
        await tx.novel.update({ where: { id: novelId }, data: { sceneExpressionTracksEnabled: input.enabled } });
        const keep = new Set(input.points.map(point => `${point.sceneId}:${point.dimensionKey}`));
        const removeIds = current.filter(row => !keep.has(`${row.sceneId}:${row.dimensionKey}`)).map(row => row.id);
        if (removeIds.length) await tx.sceneExpressionPoint.deleteMany({ where: { id: { in: removeIds } } });
        for (const point of input.points) {
          await tx.sceneExpressionPoint.upsert({
            where: { novelId_sceneId_dimensionKey: { novelId, sceneId: point.sceneId, dimensionKey: point.dimensionKey } },
            create: { id: randomUUID(), novelId, sceneId: point.sceneId, dimensionKey: point.dimensionKey, level: point.level, note: point.note || null },
            update: { level: point.level, note: point.note || null, revision: { increment: 1 } },
          });
        }
        const saved = await tx.sceneExpressionPoint.findMany({ where: { novelId }, orderBy: [{ sceneId: "asc" }, { dimensionKey: "asc" }] });
        return { enabled: input.enabled, revision: this.revision(saved, input.enabled), points: saved.map(row => this.map(row)) };
      }, { isolationLevel: "Serializable", timeout: 30_000 });
      batchContextCache.invalidate(novelId);
      return receipt;
    } catch (error) {
      if ((error as { code?: string }).code === "P2034") conflict("场景表达轨道在保存时发生并发修改，请刷新后重试。", "SCENE_EXPRESSION_REVISION_CONFLICT");
      throw error;
    }
  }
}
