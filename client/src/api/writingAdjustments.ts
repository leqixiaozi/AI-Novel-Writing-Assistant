import type { ApiResponse } from "@ai-novel/shared/types/api";
import type { ManualWritingSession, ResolvedWritingRequirements, WritingAcceptanceReceipt, WritingAdjustmentScope, WritingAdjustmentWorkspace, WritingControls, WritingEditVersion, WritingEvidenceResponse, WritingReview, WritingSettingsPayload, WritingSettingsResponse } from "@ai-novel/shared/types/writingAdjustments";
import { apiClient } from "./client";

export interface WritingPlanPreview {
  id: string;
  changes: Array<{ chapterId: string; before: string; after: string }>;
  impact: string[];
  baseRevisions: Record<string, string>;
}

export interface WritingLineEvent {
  id: string;
  title: string;
  summary: string;
  revision: string;
  chapterId: string | null;
  chapterOrder: number | null;
  storyDayIndex: number | null;
  storyTimeLabel: string | null;
  participantIds: string[];
  status: string;
  visibility: string;
}
export interface WritingLineWorkspace {
  events: WritingLineEvent[];
  characters: Array<{ id: string; name: string }>;
  chapters: Array<{ id: string; title: string; order: number }>;
}
export interface WritingLinePatch {
  title?: string;
  summary?: string;
  storyDayIndex?: number | null;
  storyTimeLabel?: string | null;
  participantIds?: string[];
}
export interface WritingLinePreview {
  id: string;
  eventId: string;
  before: WritingLineEvent;
  after: WritingLineEvent;
  affectedChapterIds: string[];
  impact: string[];
}

/** Each caller retains a key until the logical operation has a confirmed response. */
export function createWritingAdjustmentApi(novelId: string) {
  const base = `/novels/${encodeURIComponent(novelId)}`;
  const chapter = (chapterId: string) => `${base}/chapters/${encodeURIComponent(chapterId)}`;
  async function read<T>(url: string, params?: object): Promise<T> {
    const { data } = await apiClient.get<ApiResponse<T>>(url, { params });
    if (data.data === undefined || data.data === null) throw new Error(data.message ?? "未能读取调整资料。");
    return data.data;
  }
  async function write<T>(method: "post" | "put", url: string, body: unknown, key: string): Promise<T> {
    const { data } = await apiClient.request<ApiResponse<T>>({ method, url, data: body, timeout: 300000, headers: { "Idempotency-Key": key } });
    if (data.data === undefined || data.data === null) throw new Error(data.message ?? "未能确认操作结果，请重试同一操作。");
    return data.data;
  }
  return {
    workspace: () => read<WritingAdjustmentWorkspace>(`${base}/writing-adjustments/workspace`),
    lines: (params: { chapterId?: string; characterId?: string }) => read<WritingLineWorkspace>(`${base}/writing-adjustments/lines`, params),
    previewLine: (eventId: string, body: { expectedRevision: string; patch: WritingLinePatch }, key: string) => write<WritingLinePreview>("post", `${base}/writing-adjustments/lines/${encodeURIComponent(eventId)}/preview`, body, key),
    acceptLine: (candidateId: string, key: string) => write<{ id: string; status: string; affectedChapterIds: string[] }>("post", `${base}/writing-adjustments/lines/${encodeURIComponent(candidateId)}/accept`, {}, key),
    settings: (chapterId?: string) => read<WritingSettingsResponse>(`${base}/writing-settings`, { chapterId }),
    saveSettings: (body: { scope: WritingAdjustmentScope; expectedRevision: number; settings: WritingSettingsPayload }, key: string) => write<WritingSettingsResponse>("put", `${base}/writing-settings`, body, key),
    savePreset: (body: { name: string; settings: WritingSettingsPayload }, key: string) => write<unknown>("post", `${base}/writing-presets`, body, key),
    resolve: (body: { scope: WritingAdjustmentScope; overrides: WritingControls; preserve: string[]; expectedSettingsRevision?: number }, key: string) => write<ResolvedWritingRequirements>("post", `${base}/writing-requirements/resolve`, body, key),
    preview: (id: string, body: { requirementsId: string; operation: "write" | "rewrite"; content?: string; instruction?: string }, key: string) => write<WritingEditVersion[]>("post", `${chapter(id)}/editor/adjustment-preview`, body, key),
    draft: (id: string, body: { content: string; expectedRevision: string; requirementsId?: string; sourceCandidateId?: string }, key: string) => write<WritingEditVersion>("post", `${chapter(id)}/editor/drafts`, body, key),
    review: (id: string, editVersionId: string, key: string) => write<WritingReview>("post", `${chapter(id)}/editor/adjustment-review`, { editVersionId }, key),
    issue: (id: string, issueId: string, body: { reviewId: string; action: "dismissed" | "accepted_deviation"; reason: string }, key: string) => write<WritingReview>("post", `${chapter(id)}/editor/adjustment-issues/${encodeURIComponent(issueId)}`, body, key),
    accept: (id: string, body: { editVersionId: string; expectedRevision: string; reviewId?: string; acceptedDeviationIds?: string[] }, key: string) => write<WritingAcceptanceReceipt>("post", `${chapter(id)}/acceptances`, body, key),
    receipt: (id: string, receiptId: string) => read<WritingAcceptanceReceipt>(`${chapter(id)}/acceptances/${encodeURIComponent(receiptId)}`),
    retrySync: (id: string, receiptId: string, key: string) => write<WritingAcceptanceReceipt>("post", `${chapter(id)}/acceptances/${encodeURIComponent(receiptId)}/sync/retry`, {}, key),
    manual: (id: string, body: { action: "begin" | "complete"; scope?: WritingAdjustmentScope; manualEditSessionId?: string }, key: string) => write<ManualWritingSession>("post", `${chapter(id)}/runtime/manual-edit`, body, key),
    beginDirectorManual: (taskId: string, chapterIds: string[], key: string) => write<ManualWritingSession>("post", `/novels/director/tasks/${encodeURIComponent(taskId)}/commands`, { commandType: "begin_manual_edit", payload: { chapterIds } }, key),
    completeDirectorManual: (taskId: string, sessionId: string, key: string) => write<unknown>("post", `/novels/director/tasks/${encodeURIComponent(taskId)}/commands`, { commandType: "accept_manual_changes_and_continue", payload: { sessionId } }, key),
    evidence: (body: { chapterId?: string; characterIds?: string[]; sourceKinds?: string[]; query?: string; cursor?: string; limit?: number }, key: string) => write<WritingEvidenceResponse>("post", `${base}/evidence/query`, body, key),
    plan: (body: { chapterIds: string[]; instruction: string; preserve: string[] }, key: string) => write<WritingPlanPreview>("post", `${base}/writing-adjustments/plans/preview`, body, key),
    acceptPlan: (id: string, acceptedChapterIds: string[], key: string) => write<{ id: string; status: string }>("post", `${base}/writing-adjustments/plans/${encodeURIComponent(id)}/accept`, { acceptedChapterIds }, key),
    decision: (body: { category: "manual_adjustment"; content: string; adjustment: { chapterIds: string[]; preserve: string[]; status: "active" } }, key: string) => write<unknown>("post", `${base}/creative-decisions`, body, key),
    disableDecision: (id: string, adjustment: { chapterIds: string[]; preserve: string[]; status: "disabled"; expectedRevision: string }, key: string) => write<unknown>("put", `${base}/creative-decisions/${encodeURIComponent(id)}`, { adjustment }, key),
  };
}
export type WritingAdjustmentApi = ReturnType<typeof createWritingAdjustmentApi>;
