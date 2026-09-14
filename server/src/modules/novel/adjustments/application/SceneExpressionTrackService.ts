import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SceneExpressionDimensionDefinition, SceneExpressionPoint, SceneExpressionPointSaveReceipt, SceneExpressionTrackCatalog } from "@ai-novel/shared/types/sceneExpressionTracks";
import { SCENE_EXPRESSION_DIMENSION_KEYS, cloneSceneExpressionDefinitions, deserializeSceneExpressionDefinitions } from "@ai-novel/shared/types/sceneExpressionTracks";
import { AppError } from "../../../../middleware/errorHandler";
import { conflict, digest } from "../domain/contracts";
import { AdjustmentStore } from "../infrastructure/AdjustmentStore";
import { batchContextCache } from "../../../../services/novel/runtime/BatchContextCache";

const pointSchema = z.object({
  sceneId: z.string().trim().min(1).max(200),
  dimensionKey: z.string().trim().regex(/^[a-z][a-z0-9_]{2,79}$/, "请选择有效的场景表达维度。"),
  level: z.number({ error: "请选择有效的表达档位。" }).int().min(1, "表达档位只能是 L1—L5。").max(5, "表达档位只能是 L1—L5。"),
  note: z.string().trim().max(500).nullable().optional(),
}).strict();

export const sceneExpressionSaveSchema = z.object({
  expectedRevision: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
  points: z.array(pointSchema).max(10000),
}).strict();

const bandSchema = z.object({
  level: z.number().int().min(1).max(5),
  name: z.string().trim().min(1, "每一档都需要名称。").max(30),
  instruction: z.string().trim().min(1, "每一档都需要写作说明。").max(300),
}).strict();

const definitionSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{2,79}$/, "轨道标识只能使用小写字母、数字和下划线。"),
  origin: z.enum(["system", "custom"]),
  label: z.string().trim().min(1, "轨道名称不能为空。").max(30),
  description: z.string().trim().min(1, "轨道说明不能为空。").max(200),
  color: z.enum(["blue", "orange", "violet", "teal", "rose"]),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(1).max(12),
  bands: z.array(bandSchema).length(5),
  invariants: z.array(z.string().trim().min(1).max(120)).min(1, "至少需要一条内容边界。").max(6),
  promptAssetKey: z.literal("novel.scene.expression_controls"),
}).strict();

export const sceneExpressionCatalogSaveSchema = z.object({
  expectedRevision: z.number().int().min(0),
  definitions: z.array(definitionSchema).min(1).max(12),
}).strict().superRefine((value, ctx) => {
  const keys = new Set<string>();
  const labels = new Set<string>();
  const orders = new Set<number>();
  for (const [index, definition] of value.definitions.entries()) {
    if (keys.has(definition.key)) ctx.addIssue({ code: "custom", path: ["definitions", index, "key"], message: "轨道标识不能重复。" });
    if (labels.has(definition.label)) ctx.addIssue({ code: "custom", path: ["definitions", index, "label"], message: "轨道名称不能重复。" });
    if (orders.has(definition.sortOrder)) ctx.addIssue({ code: "custom", path: ["definitions", index, "sortOrder"], message: "轨道顺序不能重复。" });
    if (definition.bands.some((band, bandIndex) => band.level !== bandIndex + 1)) ctx.addIssue({ code: "custom", path: ["definitions", index, "bands"], message: "五档定义必须依次为 L1—L5。" });
    const system = (SCENE_EXPRESSION_DIMENSION_KEYS as readonly string[]).includes(definition.key);
    if ((!system && (definition.origin !== "custom" || !definition.key.startsWith("custom_"))) || (system && definition.origin !== "system")) ctx.addIssue({ code: "custom", path: ["definitions", index, "origin"], message: "轨道来源与标识不匹配。" });
    keys.add(definition.key); labels.add(definition.label); orders.add(definition.sortOrder);
  }
  for (const key of SCENE_EXPRESSION_DIMENSION_KEYS) {
    const definition = value.definitions.find(item => item.key === key);
    if (!definition || definition.origin !== "system") ctx.addIssue({ code: "custom", path: ["definitions"], message: "内置场景表达轨道必须保留。" });
  }
});

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

  async catalog(novelId: string): Promise<SceneExpressionTrackCatalog> {
    await this.store.novel(novelId);
    const row = await this.store.db.sceneExpressionTrackCatalog.findUnique({ where: { novelId } });
    return row
      ? { revision: row.revision, definitions: deserializeSceneExpressionDefinitions(row.definitionsJson), updatedAt: row.updatedAt.toISOString() }
      : { revision: 0, definitions: cloneSceneExpressionDefinitions(), updatedAt: null };
  }

  async saveCatalog(novelId: string, raw: unknown): Promise<SceneExpressionTrackCatalog> {
    const input = sceneExpressionCatalogSaveSchema.parse(raw);
    const definitions = [...input.definitions].sort((a, b) => a.sortOrder - b.sortOrder) as SceneExpressionDimensionDefinition[];
    try {
      const receipt = await this.store.db.$transaction(async tx => {
        const novel = await tx.novel.findUnique({ where: { id: novelId }, select: { id: true } });
        if (!novel) throw new AppError("作品不存在。", 404);
        const current = await tx.sceneExpressionTrackCatalog.findUnique({ where: { novelId } });
        if ((current?.revision ?? 0) !== input.expectedRevision) conflict("场景表达轨道字典已在其他窗口修改，请刷新后重试。", "SCENE_EXPRESSION_CATALOG_REVISION_CONFLICT");
        const keys = new Set(definitions.map(item => item.key));
        const referenced = await tx.sceneExpressionPoint.findMany({ where: { novelId }, select: { dimensionKey: true }, distinct: ["dimensionKey"] });
        if (referenced.some(point => !keys.has(point.dimensionKey))) throw new AppError("已有场景点仍在使用被移除的轨道，请先停用该轨道。", 400);
        const data = { definitionsJson: JSON.stringify(definitions) };
        const saved = current
          ? await tx.sceneExpressionTrackCatalog.update({ where: { novelId }, data: { ...data, revision: { increment: 1 } } })
          : await tx.sceneExpressionTrackCatalog.create({ data: { novelId, ...data } });
        return { revision: saved.revision, definitions, updatedAt: saved.updatedAt.toISOString() };
      }, { isolationLevel: "Serializable", timeout: 30_000 });
      batchContextCache.invalidate(novelId);
      return receipt;
    } catch (error) {
      if (["P2002", "P2034"].includes((error as { code?: string }).code ?? "")) conflict("场景表达轨道字典在保存时发生并发修改，请刷新后重试。", "SCENE_EXPRESSION_CATALOG_REVISION_CONFLICT");
      throw error;
    }
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
        const catalog = await tx.sceneExpressionTrackCatalog.findUnique({ where: { novelId }, select: { definitionsJson: true } });
        const definitions = deserializeSceneExpressionDefinitions(catalog?.definitionsJson);
        const validKeys = new Set(definitions.map(item => item.key));
        if (input.points.some(point => !validKeys.has(point.dimensionKey))) throw new AppError("表达点使用了不存在的场景表达维度。", 400);
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
