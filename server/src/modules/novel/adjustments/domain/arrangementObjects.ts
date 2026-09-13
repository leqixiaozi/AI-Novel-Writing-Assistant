import { z } from "zod";
import type { BookArrangementObjectDetail, BookArrangementObjectField, BookArrangementObjectKind } from "@ai-novel/shared/types/bookArrangement";
import { digest, parseJson } from "./contracts";

const id = z.string().trim().min(1).max(200);
const text = z.string().max(10000), title = z.string().trim().min(1).max(500), nullableText = text.nullable();
const ids = z.array(id).max(2000).refine(values => new Set(values).size === values.length, "引用不能重复。");
export const arrangementObjectKindSchema = z.enum(["event", "scene", "relation", "hook", "foreshadow"]);
export const arrangementObjectPreviewSchema = z.object({ kind: arrangementObjectKindSchema, action: z.enum(["create", "update", "delete"]), objectId: id.optional(), expectedRevision: id.optional(), patch: z.record(z.string(), z.unknown()) }).strict();
export const objectPatchSchemas = {
  event: z.object({ title, summary: text, chapterId: id.nullable(), eventOrder: z.number().int().min(0).max(100000), type: title, visibility: z.enum(["reader_known", "protagonist_known", "character_known", "hidden_truth", "author"]), storyDayIndex: z.number().int().nullable(), storyTimeLabel: nullableText, participantIds: ids, prerequisiteIds: ids, consequenceIds: ids }).partial().strict(),
  scene: z.object({ title, chapterId: id, sortOrder: z.number().int().min(0).max(10000), objective: nullableText, conflict: nullableText, reveal: nullableText, emotionBeat: nullableText }).partial().strict(),
  relation: z.object({ sourceCharacterId: id, targetCharacterId: id, chapterId: id.nullable(), volumeId: id.nullable(), stageLabel: title, stageSummary: text, nextTurnPoint: nullableText }).partial().strict(),
  hook: z.object({ title, description: text, chapterId: id, expectedResolveByChapterIndex: z.number().int().min(1).nullable(), resolveMode: title, blocking: z.boolean(), priority: title, relatedEventIds: ids, participantIds: ids }).partial().strict(),
  foreshadow: z.object({}).strict(),
};
const field = (key: string, label: string, type: BookArrangementObjectField["type"] = "text", required = false): BookArrangementObjectField => ({ key, label, type, required });
const choice = (key: string, label: string, options: Array<[string, string]>): BookArrangementObjectField => ({ key, label, type: "select", required: true, options: options.map(([value, label]) => ({ value, label })) });
export const objectFieldDefinitions: Record<BookArrangementObjectKind, BookArrangementObjectField[]> = {
  event: [field("title", "事件标题", "text", true), field("summary", "事件描述", "textarea"), field("chapterId", "所在章节", "chapter"), field("eventOrder", "事件顺序", "number", true), choice("type", "事件类型", [["plot", "剧情"], ["relationship", "关系"], ["conflict", "冲突"], ["reveal", "揭示"], ["battle", "战斗"], ["decision", "决定"], ["setup", "铺垫"], ["payoff", "兑现"], ["transition", "过渡"], ["background", "背景"], ["world_state", "世界状态"]]), choice("visibility", "可见范围", [["reader_known", "读者已知"], ["protagonist_known", "主角已知"], ["character_known", "相关人物已知"], ["hidden_truth", "隐藏真相"], ["author", "作者资料（旧记录）"]]), field("storyDayIndex", "故事发生日", "number"), field("storyTimeLabel", "发生时间说明"), field("participantIds", "参与人物", "characters"), field("prerequisiteIds", "前置事件", "events"), field("consequenceIds", "后续事件", "events")],
  scene: [field("title", "场景标题", "text", true), field("chapterId", "所在章节", "chapter", true), field("sortOrder", "章内场景位置", "number", true), field("objective", "场景目标", "textarea"), field("conflict", "场景冲突", "textarea"), field("reveal", "揭示信息", "textarea"), field("emotionBeat", "情绪变化", "textarea")],
  relation: [field("stageLabel", "关系阶段", "text", true), field("stageSummary", "关系安排", "textarea"), field("sourceCharacterId", "起点人物", "character", true), field("targetCharacterId", "关联人物", "character", true), field("chapterId", "所指章节", "chapter"), field("volumeId", "所指卷段", "volume"), field("nextTurnPoint", "下一转折目标", "textarea")],
  hook: [field("title", "线索标题", "text", true), field("description", "线索说明", "textarea"), field("chapterId", "设置章节", "chapter", true), field("expectedResolveByChapterIndex", "预期回收章序（计划）", "number"), choice("resolveMode", "回收模式", [["immediate", "即时回收"], ["short_arc", "短线回收"], ["long_arc", "长线回收"]]), field("blocking", "关键约束", "boolean"), choice("priority", "优先级", [["low", "低"], ["medium", "中"], ["high", "高"], ["critical", "关键"]]), field("relatedEventIds", "关联事件", "events"), field("participantIds", "相关人物", "characters")],
  foreshadow: [field("title", "伏笔标题"), field("summary", "快照说明", "textarea"), field("status", "原快照状态"), field("setupChapterId", "原设置章节", "chapter"), field("payoffChapterId", "原回收位置", "chapter")].map(field => ({ ...field, readOnly: true })),
};
export const objectEntities = { event: "StoryTimelineEvent", scene: "ChapterPlanScene", relation: "CharacterRelationStage", hook: "TimelineHook", foreshadow: "ForeshadowState" };
export function newObjectFields(kind: BookArrangementObjectKind, chapterId: string | null) {
  const defaults: Record<BookArrangementObjectKind, BookArrangementObjectDetail["fields"]> = {
    event: { title: "", summary: "", chapterId, eventOrder: 1, type: "plot", visibility: "hidden_truth", storyDayIndex: null, storyTimeLabel: null, participantIds: [], prerequisiteIds: [], consequenceIds: [] },
    scene: { title: "", chapterId, sortOrder: 1, objective: "", conflict: "", reveal: "", emotionBeat: "" },
    relation: { stageLabel: "", stageSummary: "", sourceCharacterId: "", targetCharacterId: "", chapterId, volumeId: null, nextTurnPoint: "" },
    hook: { title: "", description: "", chapterId, expectedResolveByChapterIndex: null, resolveMode: "long_arc", blocking: false, priority: "medium", relatedEventIds: [], participantIds: [] },
    foreshadow: {},
  };
  return defaults[kind];
}

/** Maps stored structured fields only; a declared plan never becomes historical evidence. */
export function objectDetail(kind: BookArrangementObjectKind, row: Record<string, any> | null, defaultChapterId: string | null = null): BookArrangementObjectDetail {
  const fields = row ? Object.fromEntries(objectFieldDefinitions[kind].map(field => [field.key, row[field.key] ?? null])) : newObjectFields(kind, defaultChapterId);
  if (row && kind === "event") for (const key of ["participantIds", "prerequisiteIds", "consequenceIds"]) fields[key] = parseJson<string[]>(row[`${key}Json`], []);
  if (row && kind === "scene") fields.chapterId = row.plan.chapterId;
  if (row && kind === "hook") { fields.chapterId = row.createdInChapterId; for (const key of ["relatedEventIds", "participantIds"]) fields[key] = parseJson<string[]>(row[`${key}Json`], []); }
  const basis = kind === "scene" || !row || row.status === "planned" ? "plan" : kind === "relation" ? ["volume_projection", "cast_option_projection", "rebuild_projection", "arrangement_plan"].includes(row.sourceType) ? "plan" : row.sourceType === "manual_override" ? "setting" : row.sourceType === "chapter_draft_extract" ? "record" : "unknown" : "record";
  const staleScene = kind === "scene" && row?.plan?.status === "stale";
  const editable = kind !== "foreshadow" && !staleScene && !(kind === "relation" && row && row.sourceType === "chapter_draft_extract");
  const rawIds = kind === "foreshadow" ? [fields.setupChapterId, fields.payoffChapterId] : kind === "hook" ? [fields.chapterId, row?.resolvedInChapterId] : [fields.chapterId];
  const chapterIds = [...new Set(rawIds.filter((value): value is string => typeof value === "string" && Boolean(value)))];
  return { kind, id: row?.id ?? "new", sourceEntity: objectEntities[kind], revision: row ? digest(row) : "new", title: String(fields.title ?? fields.stageLabel ?? ""), chapterIds, basis, fields, fieldDefinitions: objectFieldDefinitions[kind].map(field => ({ ...field, readOnly: !editable || field.readOnly })), editable, deletable: editable && !(kind === "hook" && row?.resolvedInChapterId), evidenceLabel: kind === "foreshadow" ? "原故事快照，只读历史记录；修改计划请建立线索安排，不能改写快照补造事实。" : staleScene ? "历史场景计划，只读；请调整当前章节计划中的场景。" : !editable ? "章节提取的关系记录，只读；可另建作者关系安排。" : kind === "hook" ? "已存线索安排；预期回收为计划，不代表原文已经铺垫或回收。" : basis === "record" ? "已有历史记录；人工修订仅调整此资料，不改正文，也不自动证明新描述已经发生。" : "作者计划或设定；应用不表示事件发生、人物知情或伏笔已经回收。", record: row ? JSON.parse(JSON.stringify(row)) : {} };
}
