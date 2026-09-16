import type { CardTypeSummary } from "../contracts";

export type TypeWriteStep = "save" | "publish";
export interface TypeWriteFailure {
  step: TypeWriteStep;
  uncertain: boolean;
  needsReview: boolean;
  title: string;
  guidance: string;
}

export function typeWriteFailure(step: TypeWriteStep, status?: number): TypeWriteFailure {
  const uncertain = status === undefined || status >= 500;
  return {
    step, uncertain, needsReview: uncertain || status === 409,
    title: `${step === "save" ? "保存草稿" : "发布版本"}${uncertain ? "结果待核对" : "失败"}`,
    guidance: uncertain
      ? "服务器可能已完成操作。当前页面的编辑内容仍保留；请点击“核对服务器结果”，不要重复提交或刷新页面。"
      : status === 409
        ? "服务器内容与当前编辑发生冲突。当前编辑仍保留；请点击“核对服务器结果”，对比后再决定保存。"
        : "当前页面的编辑内容仍保留。请按错误说明修改对应内容，再点击下方保存或发布按钮；不要刷新页面。",
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function sameTypeDraft(a: CardTypeSummary, b: CardTypeSummary): boolean {
  return canonical([a.name, a.description, a.categoryId, a.semanticCapabilities, a.draftFields]) === canonical([b.name, b.description, b.categoryId, b.semanticCapabilities, b.draftFields]);
}

export function reconcileTypeWrite(current: CardTypeSummary, submitted: CardTypeSummary, saved: CardTypeSummary): CardTypeSummary {
  return sameTypeDraft(current, submitted) ? saved : {
    ...current, id: saved.id, revision: saved.revision, status: saved.status,
    currentVersion: saved.currentVersion, currentVersionId: saved.currentVersionId,
  };
}

// A confirmed write is never relabelled as failed because a later read failed.
export async function publishTypeDraft(input: {
  draft: CardTypeSummary;
  needsSave: boolean;
  save: (draft: CardTypeSummary) => Promise<CardTypeSummary>;
  publish: (id: string, revision: number) => Promise<CardTypeSummary>;
  confirmed: (type: CardTypeSummary, step: TypeWriteStep) => void;
  attempting: (step: TypeWriteStep, draft: CardTypeSummary) => void;
}): Promise<CardTypeSummary> {
  let current = input.draft;
  if (input.needsSave || !current.id) {
    input.attempting("save", current);
    current = await input.save(current);
    input.confirmed(current, "save");
  }
  input.attempting("publish", current);
  const published = await input.publish(current.id, current.revision);
  input.confirmed(published, "publish");
  return published;
}
