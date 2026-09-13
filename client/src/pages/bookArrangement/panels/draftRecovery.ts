import type { BookArrangementDraftPayload, BookArrangementDraftRecord, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";

/** Source refresh must not silently grant an old local draft a newer writer's CAS revision. */
export function refreshArrangementDraft(current: { draft: BookArrangementDraftPayload; saved: BookArrangementDraftRecord }, next: Pick<BookArrangementWorkspace, "draft" | "baseRevision">, discard = false) {
  const keep = !discard && JSON.stringify(current.draft) !== JSON.stringify(current.saved.payload);
  const conflict = keep && current.saved.revision !== next.draft.revision;
  return { keep, conflict, saved: conflict ? current.saved : next.draft, draft: { ...(keep ? current.draft : next.draft.payload), baseRevision: next.baseRevision } };
}
