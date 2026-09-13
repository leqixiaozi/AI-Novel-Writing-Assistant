import type { BookArrangementObjectDetail, BookArrangementObjectField, BookArrangementObjectValue, BookArrangementObjectPreview } from "@ai-novel/shared/types/bookArrangement";

export function recoverObjectCandidate(candidate: BookArrangementObjectPreview, history: BookArrangementObjectPreview[]) {
  const saved = history.find(item => item.id === candidate.id && item.objectId === candidate.objectId && item.kind === candidate.kind);
  return saved?.applied ? saved : candidate;
}

export function definitivelyRejectedObjectApply(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { errorCode?: string } } }).response;
  return response?.status === 404 || (response?.status === 409 && ["REQUIREMENTS_STALE", "REVISION_CONFLICT"].includes(response.data?.errorCode ?? ""));
}

export const objectKindLabels = { event: "事件", scene: "场景", relation: "关系阶段", hook: "伏笔计划", foreshadow: "伏笔历史快照", check: "核对问题" };
export const objectRemoval = {
  event: { action: "取消事件计划", explanation: "事件记录保留，状态改为已取消。" },
  scene: { action: "删除场景", explanation: "该场景会从原规划删除，候选保留调整前内容。" },
  relation: { action: "停用关系安排", explanation: "关系记录保留，并停用其当前安排。" },
  hook: { action: "放弃线索计划", explanation: "线索记录保留，状态改为已放弃。" },
  foreshadow: { action: "历史快照只读", explanation: "历史快照不能通过此面板删除。" },
};

export function editableObjectPatch(detail: BookArrangementObjectDetail, fields: Record<string, BookArrangementObjectValue>, create: boolean) {
  return Object.fromEntries(detail.fieldDefinitions.filter(field => !field.readOnly && (create || JSON.stringify(fields[field.key]) !== JSON.stringify(detail.fields[field.key]))).map(field => [field.key, fields[field.key] ?? null]));
}

export function validateObjectFields(definitions: BookArrangementObjectField[], fields: Record<string, BookArrangementObjectValue>): string | null {
  for (const field of definitions) {
    if (field.readOnly) continue;
    const value = fields[field.key];
    if (field.required && (value == null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0))) return `请填写${field.label}。`;
    if (field.type === "number" && value != null && (typeof value !== "number" || !Number.isFinite(value))) return `${field.label}需要有效数字。`;
  }
  return null;
}

export function objectPanelError(error: unknown): string {
  const failure = error as { response?: { data?: { message?: string } }; message?: string };
  return failure.response?.data?.message || failure.message || "操作未完成，请重试。";
}
