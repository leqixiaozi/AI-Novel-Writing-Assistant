import {
  creativeHubBindingSchema,
  type CreativeHubBinding,
} from "../../common/creativeHub";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BINDING_KEYS = [
  "bookId",
  "chapterDocumentId",
  "taskKind",
  "taskId",
] as const;
export interface CreativeHubLocation {
  threadId: string | null;
  binding: CreativeHubBinding;
  explicit: boolean;
  bindingExplicit: boolean;
  error: string | null;
}
export function creativeHubHref(
  threadId?: string | null,
  binding: CreativeHubBinding = {},
): string {
  const params = new URLSearchParams();
  if (threadId) params.set("threadId", threadId);
  for (const key of BINDING_KEYS) {
    const value = binding[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return `/new-design/creative-hub${query ? `?${query}` : ""}`;
}
function single(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  if (values.length > 1) throw new Error("创作中枢地址包含重复的资源范围。");
  return values[0]?.trim() || null;
}
export function readCreativeHubLocation(search: string): CreativeHubLocation {
  const params = new URLSearchParams(search);
  try {
    const threadId = single(params, "threadId"),
      bookId = single(params, "bookId"),
      chapterDocumentId = single(params, "chapterDocumentId"),
      taskKind = single(params, "taskKind"),
      taskId = single(params, "taskId");
    if (threadId && !UUID.test(threadId))
      throw new Error("会话地址无效，请从创作中枢列表重新选择。");
    if (
      (bookId && !UUID.test(bookId)) ||
      (chapterDocumentId && !UUID.test(chapterDocumentId)) ||
      (taskId && !UUID.test(taskId))
    )
      throw new Error("绑定的资源地址无效，请从原页重新打开创作中枢。");
    if (chapterDocumentId && !bookId)
      throw new Error("章节范围必须同时指定作品。");
    if (Boolean(taskKind) !== Boolean(taskId))
      throw new Error("任务类型与任务标识必须同时提供。");
    const binding = creativeHubBindingSchema.parse({
      ...(bookId ? { bookId } : {}),
      ...(chapterDocumentId ? { chapterDocumentId } : {}),
      ...(taskKind ? { taskKind } : {}),
      ...(taskId ? { taskId } : {}),
    });
    return {
      threadId,
      binding,
      explicit: Boolean(threadId),
      bindingExplicit: BINDING_KEYS.some((key) => params.has(key)),
      error: null,
    };
  } catch (error) {
    return {
      threadId: null,
      binding: {},
      explicit: params.has("threadId"),
      bindingExplicit: BINDING_KEYS.some((key) => params.has(key)),
      error: error instanceof Error ? error.message : "创作中枢地址无效。",
    };
  }
}
export function areCreativeHubBindingsEqual(
  left: CreativeHubBinding,
  right: CreativeHubBinding,
): boolean {
  return BINDING_KEYS.every(
    (key) => (left[key] ?? null) === (right[key] ?? null),
  );
}
export function isSafeCreativeHubActionHref(value: string): boolean {
  if (
    value.length > 1200 ||
    !value.startsWith("/new-design/") ||
    /[\\\u0000-\u0020]/.test(value)
  )
    return false;
  try {
    const url = new URL(value, "http://creative-hub.invalid");
    return (
      url.origin === "http://creative-hub.invalid" &&
      url.pathname.startsWith("/new-design/") &&
      !/%(?:2f|5c|00)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}
