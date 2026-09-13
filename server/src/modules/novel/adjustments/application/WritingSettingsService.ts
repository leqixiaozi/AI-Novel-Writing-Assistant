import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ChapterNarrativeControls } from "../../../../prompting/prompts/novel/chapterNarrativeControls";
import { buildChapterNarrativeControlBlock } from "../../../../prompting/prompts/novel/chapterNarrativeControls";
import type { ResolvedWritingRequirements, WritingAdjustmentScope, WritingControls, WritingSettingsPayload, WritingSettingsResponse } from "@ai-novel/shared/types/writingAdjustments";
import { AppError } from "../../../../middleware/errorHandler";
import { AdjustmentStore } from "../infrastructure/AdjustmentStore";
import { chapterRevision, conflict, CONTROL_DEFINITIONS, controlsSchema, DEFINITION_VERSION, EMPTY_SETTINGS, mergeControls, parseJson, settingsSchema, validateControlObjects } from "../domain/contracts";

export class WritingSettingsService {
  constructor(readonly store: AdjustmentStore) {}
  async get(novelId: string, chapterId?: string, arrangementOverride?: WritingSettingsPayload): Promise<WritingSettingsResponse> {
    await this.store.novel(novelId);
    if (chapterId) await this.store.chapter(novelId, chapterId);
    const scopeKey = chapterId ? `chapter:${chapterId}` : "novel";
    const arrangementKey = chapterId ? `arrangement:chapter:${chapterId}` : null;
    const rows = await this.store.db.writingSetting.findMany({ where: { novelId, scopeKey: { in: ["novel", scopeKey, ...(arrangementKey ? [arrangementKey] : [])] } } });
    const book = parseJson<WritingSettingsPayload>(rows.find(r => r.scopeKey === "novel")?.payloadJson, EMPTY_SETTINGS);
    const ownRow = rows.find(r => r.scopeKey === scopeKey);
    const own = parseJson<WritingSettingsPayload>(ownRow?.payloadJson, EMPTY_SETTINGS);
    const arrangement = chapterId ? arrangementOverride ?? parseJson<WritingSettingsPayload>(rows.find(r => r.scopeKey === arrangementKey)?.payloadJson, EMPTY_SETTINGS) : EMPTY_SETTINGS;
    const layers = [book, arrangement, ...(chapterId ? [own] : [])];
    const merged = mergeControls([{ source: "本书", controls: book.enabled ? book.controls : {} }, { source: "全书编排", controls: arrangement.enabled ? arrangement.controls : {} }, ...(chapterId ? [{ source: "本章", controls: own.enabled ? own.controls : {} }] : [])]);
    const presets = await this.store.db.writingPreset.findMany({ where: { novelId }, orderBy: { updatedAt: "desc" }, take: 100 });
    return { revision: ownRow?.revision ?? 0, scopeKey, settings: own, effective: { enabled: layers.some(layer => layer.enabled), controls: merged.controls, preserve: [...new Set(layers.flatMap(layer => layer.enabled ? layer.preserve : []))] }, sources: merged.sources, definitions: CONTROL_DEFINITIONS, presets: presets.map(r => ({ id: r.id, name: r.name, revision: r.revision, settings: parseJson(r.payloadJson, EMPTY_SETTINGS) })) };
  }
  async save(novelId: string, input: { scope: WritingAdjustmentScope; expectedRevision: number; settings: WritingSettingsPayload }) {
    if (!["novel", "chapter"].includes(input.scope.kind)) throw new AppError("默认设置请选择本书或本章。", 400);
    const scopeKey = input.scope.kind === "novel" ? "novel" : `chapter:${input.scope.chapterId}`;
    if (input.scope.kind !== "novel") await this.store.chapter(novelId, input.scope.chapterId ?? "");
    await this.store.novel(novelId);
    const settings = settingsSchema.parse(input.settings);
    const characters = await this.store.db.character.findMany({ where: { novelId }, select: { id: true } });
    validateControlObjects(settings.controls, new Set(characters.map(c => c.id)));
    return this.store.db.$transaction(async tx => {
      const row = await tx.writingSetting.findUnique({ where: { novelId_scopeKey: { novelId, scopeKey } } });
      if ((row?.revision ?? 0) !== input.expectedRevision) conflict("写作设置已变化，请刷新后重试。");
      if (row) {
        const saved = await tx.writingSetting.updateMany({ where: { id: row.id, revision: input.expectedRevision }, data: { revision: { increment: 1 }, payloadJson: JSON.stringify(settings) } });
        if (!saved.count) conflict("写作设置已变化。");
      } else await tx.writingSetting.create({ data: { id: randomUUID(), novelId, scopeKey, payloadJson: JSON.stringify(settings) } });
      const response = await new WritingSettingsService(new AdjustmentStore(tx as PrismaClient)).get(novelId, input.scope.chapterId);
      return this.store.recordResult(tx, response);
    });
  }
  async preset(novelId: string, input: { name: string; settings: WritingSettingsPayload; expectedRevision?: number }, id?: string) {
    await this.store.novel(novelId);
    const settings = settingsSchema.parse(input.settings);
    const characters = await this.store.db.character.findMany({ where: { novelId }, select: { id: true } });
    validateControlObjects(settings.controls, new Set(characters.map(c => c.id)));
    const presetId = id ?? randomUUID();
    return this.store.db.$transaction(async tx => {
      if (id) {
        const result = await tx.writingPreset.updateMany({ where: { id, novelId, revision: input.expectedRevision ?? -1 }, data: { name: input.name, payloadJson: JSON.stringify(settings), revision: { increment: 1 } } });
        if (!result.count) conflict("预设已变化或不属于此作品。");
      } else await tx.writingPreset.create({ data: { id: presetId, novelId, name: input.name, payloadJson: JSON.stringify(settings) } });
      return this.store.recordResult(tx, { id: presetId });
    });
  }
  async resolve(novelId: string, input: { scope: WritingAdjustmentScope; overrides?: WritingControls; preserve?: string[]; expectedSettingsRevision?: number }): Promise<ResolvedWritingRequirements> {
    const chapters = await this.store.chapters(novelId, input.scope);
    const settings = await this.get(novelId, input.scope.chapterId);
    if (input.expectedSettingsRevision !== undefined && settings.revision !== input.expectedSettingsRevision) conflict("设置已变化，请重新读取。", "REQUIREMENTS_STALE");
    const merged = mergeControls([{ source: "默认", controls: settings.effective.controls }, { source: "本次", controls: controlsSchema.parse(input.overrides ?? {}) }]);
    const characters = await this.store.db.character.findMany({ where: { novelId }, select: { id: true } });
    validateControlObjects(merged.controls, new Set(characters.map(c => c.id)));
    const now = new Date();
    const result: ResolvedWritingRequirements = { id: randomUUID(), novelId, scope: input.scope, chapterIds: chapters.map(c => c.id), controls: merged.controls, preserve: [...new Set([...settings.effective.preserve, ...(input.preserve ?? [])])], summary: CONTROL_DEFINITIONS.filter(d => merged.controls[d.key]?.mode === "set").map(d => `${d.label}：${d.bands[Math.min(4, Math.floor((merged.controls[d.key]?.value ?? 0) / 25 + .5))]}`).join("；"), definitionVersion: DEFINITION_VERSION, baseRevisions: Object.fromEntries(chapters.map(c => [c.id, chapterRevision(c)])), dependencyRevision: await this.store.dependencies(novelId), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3600000).toISOString() };
    const decisions = await this.store.db.creativeDecision.findMany({ where: { novelId, adjustmentJson: { not: null } }, orderBy: { id: "asc" } });
    result.chapterRequirements = {};
    for (const chapter of chapters) {
      const effective = (await this.get(novelId, chapter.id)).effective;
      const chapterControls = mergeControls([{ source: "默认", controls: effective.controls }, { source: "本次", controls: input.overrides ?? {} }]).controls;
      validateControlObjects(chapterControls, new Set(characters.map(c => c.id)));
      const keep = [...new Set([...effective.preserve, ...(input.preserve ?? [])])];
      const instructions = decisions.flatMap(d => {
        const a = parseJson<{ status: string; chapterIds: string[]; preserve: string[] }>(d.adjustmentJson, null!);
        return a.status === "active" && a.chapterIds.includes(chapter.id) ? [{ content: d.content, preserve: a.preserve }] : [];
      });
      const promptText = [await this.prompt({ ...result, chapterRequirements: undefined, controls: chapterControls, preserve: keep }), instructions.length ? `本章已启用的规划干预：\n${JSON.stringify(instructions)}` : ""].filter(Boolean).join("\n\n");
      result.chapterRequirements[chapter.id] = { controls: chapterControls, preserve: keep, promptText };
    }
    return this.store.db.$transaction(async tx => {
      await tx.writingRequirement.create({ data: { id: result.id, novelId, chapterId: input.scope.chapterId, payloadJson: JSON.stringify(result), expiresAt: new Date(result.expiresAt) } });
      return this.store.recordResult(tx, result);
    });
  }
  async load(novelId: string, chapterId: string, id: string, fresh = true) {
    const row = await this.store.db.writingRequirement.findFirst({ where: { id, novelId } });
    if (!row) throw new AppError("本次要求不存在。", 404);
    const req = parseJson<ResolvedWritingRequirements>(row.payloadJson, null!);
    if (!req.chapterIds.includes(chapterId)) throw new AppError("本次要求不适用于该章。", 400);
    if (fresh && (row.expiresAt.getTime() < Date.now() || req.dependencyRevision !== await this.store.dependencies(novelId))) conflict("写作依据已变化，请重新解析本次要求。", "REQUIREMENTS_STALE");
    return req;
  }
  async prompt(req: ResolvedWritingRequirements, chapterId?: string) {
    const frozen = req.chapterRequirements?.[chapterId ?? req.scope.chapterId ?? req.chapterIds[0]];
    if (frozen) return frozen.promptText;
    const characters = await this.store.db.character.findMany({ where: { novelId: req.novelId }, select: { id: true, name: true } });
    const names = new Map(characters.map(c => [c.id, c.name]));
    const controls: ChapterNarrativeControls = {};
    for (const key of Object.keys(req.controls) as Array<keyof WritingControls>) {
      const v = req.controls[key]; if (!v || v.mode !== "set") continue;
      const value = { rawValue: v.value! };
      if (key === "pace" || key === "tension") controls[key] = value;
      else if (key === "suspicionTarget") controls[key] = { ...value, subject: names.get(v.subjectId!)!, object: names.get(v.objectId!)!, matter: v.matter! };
      else if (key === "dialogueDirectness") controls[key] = { ...value, speaker: names.get(v.speakerId!)!, listener: names.get(v.listenerId!)! };
      else controls.characterProminence = { ...value, character: names.get(v.characterId!)! };
    }
    return [buildChapterNarrativeControlBlock(controls), req.preserve.length ? `作者保留项：\n${req.preserve.join("\n")}` : ""].filter(Boolean).join("\n\n");
  }
}
