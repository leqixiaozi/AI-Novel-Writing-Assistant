import type { BookArrangementClue, BookArrangementHookNode, BookArrangementHookStage, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";

export const hookStages: Array<{ value: BookArrangementHookStage; label: string; color: string }> = [
  { value: "setup", label: "建立", color: "#3b82f6" }, { value: "reinforce", label: "强化", color: "#16a394" },
  { value: "misdirect", label: "误导", color: "#e59a32" }, { value: "reveal", label: "揭示", color: "#8b5cf6" },
  { value: "payoff", label: "回收", color: "#e4505f" }, { value: "aftermath", label: "余波", color: "#64748b" },
];
export const hookStageLabel = (stage: string) => hookStages.find(item => item.value === stage)?.label ?? stage;

export interface HookLifecycleEntry {
  id: string; sourceId: string | null; chapterId: string; stage: BookArrangementHookStage;
  basis: "plan" | "record"; note: string; evidenceStatus: BookArrangementHookNode["evidenceStatus"];
  relatedEventId: string | null; relatedSceneId: string | null; editable: boolean;
}

export function lifecycleEntries(workspace: BookArrangementWorkspace, clue: BookArrangementClue | undefined): HookLifecycleEntry[] {
  if (!clue) return [];
  const entries: HookLifecycleEntry[] = (workspace.hookNodes ?? []).filter(node => node.hookId === clue.sourceId).map(node => ({ id: node.id, sourceId: node.sourceId, chapterId: node.chapterId, stage: node.stage, basis: node.nodeBasis, note: node.note, evidenceStatus: node.evidenceStatus, relatedEventId: node.relatedEventId, relatedSceneId: node.relatedSceneId, editable: true }));
  if (clue.setupChapterId && !entries.some(entry => entry.stage === "setup" && entry.chapterId === clue.setupChapterId)) entries.push({ id: `${clue.id}:setup`, sourceId: null, chapterId: clue.setupChapterId, stage: "setup", basis: clue.basis === "plan" ? "plan" : "record", note: "线索原始设置位置", evidenceStatus: clue.basis === "plan" ? "planned" : "matched", relatedEventId: null, relatedSceneId: null, editable: false });
  const expected = workspace.chapters.find(chapter => chapter.order === clue.expectedPayoffChapterOrder);
  if (expected && !entries.some(entry => entry.stage === "payoff" && entry.chapterId === expected.id)) entries.push({ id: `${clue.id}:expected`, sourceId: null, chapterId: expected.id, stage: "payoff", basis: "plan", note: "原计划回收位置", evidenceStatus: "planned", relatedEventId: null, relatedSceneId: null, editable: false });
  if (clue.payoffChapterId && !entries.some(entry => entry.stage === "payoff" && entry.chapterId === clue.payoffChapterId && entry.basis === "record")) entries.push({ id: `${clue.id}:payoff`, sourceId: null, chapterId: clue.payoffChapterId, stage: "payoff", basis: "record", note: "线索原记录回收位置", evidenceStatus: "matched", relatedEventId: null, relatedSceneId: null, editable: false });
  const order = new Map(workspace.chapters.map(chapter => [chapter.id, chapter.order]));
  return entries.sort((left, right) => (order.get(left.chapterId) ?? 0) - (order.get(right.chapterId) ?? 0) || hookStages.findIndex(item => item.value === left.stage) - hookStages.findIndex(item => item.value === right.stage));
}

export function hookLifecycleRisks(workspace: BookArrangementWorkspace, clue: BookArrangementClue | undefined, entries = lifecycleEntries(workspace, clue)): string[] {
  if (!clue) return [];
  const risks: string[] = [];
  const chapterOrder = new Map(workspace.chapters.map(chapter => [chapter.id, chapter.order]));
  const setupOrder = clue.setupChapterId ? chapterOrder.get(clue.setupChapterId) : undefined;
  const payoffOrders = entries.filter(entry => entry.stage === "payoff").map(entry => chapterOrder.get(entry.chapterId) ?? 0);
  if (!clue.expectedPayoffChapterOrder && !payoffOrders.length) risks.push("尚未安排回收章节，长线索容易在后续写作中失踪。");
  if (setupOrder != null && payoffOrders.some(order => order < setupOrder)) risks.push("回收节点早于建立节点，请核对章节顺序。");
  if (setupOrder != null && payoffOrders.some(order => order - setupOrder >= 6) && !entries.some(entry => ["reinforce", "misdirect", "reveal"].includes(entry.stage))) risks.push("建立与回收间隔较长，中段缺少强化、误导或揭示节点。");
  for (const entry of entries.filter(item => item.basis === "record" && item.editable && item.evidenceStatus !== "matched")) risks.push(entry.evidenceStatus === "missing" ? `第${chapterOrder.get(entry.chapterId) ?? "—"}章的${hookStageLabel(entry.stage)}记录缺少正文证据。` : `第${chapterOrder.get(entry.chapterId) ?? "—"}章的${hookStageLabel(entry.stage)}证据未在正文精确定位。`);
  for (const entry of entries.filter(item => item.basis === "plan" && item.editable)) if (workspace.chapters.find(chapter => chapter.id === entry.chapterId)?.hasContent) risks.push(`第${chapterOrder.get(entry.chapterId) ?? "—"}章已有正文，但仍保留计划节点，请核对是否已经发生。`);
  for (const entry of entries) {
    if (entry.relatedEventId && !workspace.events.some(event => event.id === entry.relatedEventId)) risks.push(`${hookStageLabel(entry.stage)}节点关联的事件已无法定位。`);
    if (entry.relatedSceneId && !workspace.scenes.some(scene => scene.id === entry.relatedSceneId)) risks.push(`${hookStageLabel(entry.stage)}节点关联的场景已无法定位。`);
  }
  return [...new Set(risks)];
}

export function canMoveHookNode(workspace: BookArrangementWorkspace, entry: HookLifecycleEntry, chapterId: string) {
  return entry.editable && entry.basis === "plan" && Boolean(workspace.chapters.find(chapter => chapter.id === chapterId && !chapter.hasContent));
}
