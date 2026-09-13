import type { WritingControls, WritingEditVersion, WritingReview } from "@ai-novel/shared/types/writingAdjustments";
import type { WritingLineEvent, WritingLinePreview, WritingPlanPreview } from "@/api/writingAdjustments";

export function preserveLines(value: string): string[] {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

/** A manual workspace task or historical task alias is never a director identity. */
export function explicitDirectorTaskId(search: string): string | undefined {
  return new URLSearchParams(search).get("directorTaskId")?.trim() || undefined;
}

export function validateWritingControls(controls: WritingControls): string | null {
  for (const [key, control] of Object.entries(controls)) {
    if (!control || control.mode !== "set") continue;
    if (typeof control.value !== "number" || !Number.isFinite(control.value) || control.value < 0 || control.value > 100) return "请选择 0 至 100 之间的强度。";
    if (key === "suspicionTarget" && (!control.subjectId || !control.objectId || !control.matter?.trim())) return "请为疑点表达选择双方人物并填写怀疑事项。";
    if (key === "dialogueDirectness" && (!control.speakerId || !control.listenerId || !control.matter?.trim())) return "请为对话表达选择双方人物并填写谈论事项。";
    if (key === "characterProminence" && !control.characterId) return "请选择需要调整存在感的人物。";
  }
  return null;
}

export function reviewMatchesDraft(review: WritingReview | null, version: WritingEditVersion | null, content: string): boolean {
  return Boolean(review && version && review.editVersionId === version.id && review.contentHash === version.contentHash && content === version.content);
}

export function recoverVersionReview(version: WritingEditVersion, reviews: WritingReview[] = []): WritingReview | null {
  return reviews.find(review => review.editVersionId === version.id && review.contentHash === version.contentHash) ?? null;
}

export function recoverPlanPreview(version: WritingEditVersion): WritingPlanPreview | null {
  if (version.kind !== "plan" || version.metadata.acceptedChapterIds) return null;
  const { changes, impact, baseRevisions } = version.metadata;
  if (!Array.isArray(changes) || !changes.every(item => item && typeof item.chapterId === "string" && typeof item.before === "string" && typeof item.after === "string")) return null;
  if (!Array.isArray(impact) || !impact.every(item => typeof item === "string") || !baseRevisions || typeof baseRevisions !== "object") return null;
  if (!changes.every(item => typeof (baseRevisions as Record<string, unknown>)[item.chapterId] === "string")) return null;
  return { id: version.id, changes, impact, baseRevisions: baseRevisions as Record<string, string> };
}

export function recoverLinePreview(version: WritingEditVersion): WritingLinePreview | null {
  if (version.kind !== "line" || version.metadata.accepted) return null;
  const { eventId, affectedChapterIds, impact } = version.metadata;
  if (typeof eventId !== "string" || !Array.isArray(affectedChapterIds) || !affectedChapterIds.every(id => typeof id === "string") || !Array.isArray(impact) || !impact.every(item => typeof item === "string")) return null;
  try {
    const { before, after } = JSON.parse(version.content) as { before: WritingLineEvent; after: WritingLineEvent };
    if (![before, after].every(item => item && item.id === eventId && typeof item.title === "string" && typeof item.summary === "string" && Array.isArray(item.participantIds) && item.participantIds.every(id => typeof id === "string"))) return null;
    return { id: version.id, eventId, before, after, affectedChapterIds, impact };
  } catch { return null; }
}

/** Network retries use the same key; changed input is a new logical operation. */
export class AdjustmentOperationKeys {
  private keys = new Map<string, string>();
  get(operation: string, input: unknown): { identity: string; key: string } {
    const identity = JSON.stringify([operation, input]);
    let key = this.keys.get(identity);
    if (!key) { key = crypto.randomUUID(); this.keys.set(identity, key); }
    return { identity, key };
  }
  complete(identity: string): void { this.keys.delete(identity); }
}
