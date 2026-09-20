import type { HomeBookFact, HomeCreationDraft, HomeSnapshot } from "./index";
import type { VisualWorkspace } from "../visualAssets";

export interface HomeAction { title: string; reason: string; label: string; href: string; tone: "normal" | "attention" | "running"; }
const path = (book: HomeBookFact, page: string) => `/new-design/books/${encodeURIComponent(book.id)}/${page}`;
export const hasLiveWork = (book: HomeBookFact) => book.runningTasks + book.queuedTasks > 0 || (book.latestDirector?.status === "running" && !book.latestDirector.leaseExpired);
export const needsConfirmation = (book: HomeBookFact) => book.waitingTasks > 0 || book.pendingFacts + book.pendingChanges > 0 || ["paused", "waiting_recovery"].includes(book.latestDirector?.status ?? "") || Boolean(book.latestDirector?.leaseExpired);
const directorRoute = (book: HomeBookFact) => `${path(book, "director")}${book.latestDirector ? `?run=${encodeURIComponent(book.latestDirector.id)}` : ""}`;

/** Deterministic display priority over saved workflow states, not AI intent inference. */
export function homeBookPriority(book: HomeBookFact): number {
  if (book.latestDirector && (["waiting_recovery", "failed"].includes(book.latestDirector.status) || book.latestDirector.leaseExpired)) return 0;
  if (needsConfirmation(book)) return 1;
  if (book.latestDirector?.status === "ready") return 2;
  if (hasLiveWork(book)) return 3;
  if (book.writableChapterPlanCount > 0) return 4;
  if (book.latestTask?.status === "failed") return 5;
  return 6;
}

export function selectHomeBook(books: HomeBookFact[]): HomeBookFact | null {
  return [...books].sort((a, b) => homeBookPriority(a) - homeBookPriority(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id))[0] ?? null;
}

/** Only an active, readable version explicitly mounted as this book's cover may appear on home. */
export function homePrimaryCover(workspace: VisualWorkspace): { assetId: string; versionId: string } | null {
  for (const mount of workspace.mounts) {
    if (mount.status !== "active" || mount.ownerKind !== "book" || mount.ownerStableId !== workspace.bookId) continue;
    const asset = workspace.assets.find(item => item.id === mount.assetId && item.kind === "cover" && item.status === "active");
    const version = asset?.versions.find(item => item.id === mount.versionId && item.readable);
    if (asset && version) return { assetId: asset.id, versionId: version.id };
  }
  return null;
}

export function homeBookAction(book: HomeBookFact): HomeAction {
  const director = book.latestDirector;
  if (director && (["waiting_recovery", "failed"].includes(director.status) || director.leaseExpired)) return {
    title: "核对原章节结果，继续你的故事", reason: "已保存的正文与候选保留。到本书导演页核对原结果，再决定恢复方式。", label: "核对并继续创作", href: directorRoute(book), tone: "attention",
  };
  if (director?.status === "paused") return { title: "确认后继续章节创作", reason: "本次创作已暂停。打开原章节范围，查看停在哪里，再决定下一步。", label: "打开暂停的创作", href: directorRoute(book), tone: "attention" };
  if (book.pendingChanges + book.pendingFacts > 0) return { title: "确认本次创作留下的变化", reason: "正文带来的设定变化仍需确认，确认后的事实才能成为后续创作依据。", label: "审阅章节与变化", href: path(book, "writing"), tone: "attention" };
  if (book.waitingTasks > 0) return { title: "查看等待确认的创作结果", reason: "查看本书运行记录和原来源，再确认候选或阶段结果。", label: "查看本书待办", href: path(book, "overview"), tone: "attention" };
  if (director?.status === "ready") return { title: "章节范围已准备好", reason: "到全书导演核对章节范围、采用计划和写作要求，再明确开始。", label: "核对章节范围", href: directorRoute(book), tone: "normal" };
  if (hasLiveWork(book)) return { title: "查看正在推进的故事", reason: "本书有正在运行或等待执行的任务，可以查看进展与已保存结果。", label: "查看创作进展", href: director?.status === "running" ? directorRoute(book) : path(book, "overview"), tone: "running" };
  if (book.writableChapterPlanCount > 0) return { title: "从采用的章节计划开始写", reason: "已有可进入正文准备的章节计划。生成前仍会核对上下文、前章状态与本次范围。", label: "进入正文创作", href: path(book, "writing"), tone: "normal" };
  if (book.latestTask?.status === "failed") return { title: "查看本书未完成的任务", reason: "原任务未完成，已有创作内容保留。打开本书概览，再返回对应来源处理。", label: "查看本书任务", href: path(book, "overview"), tone: "attention" };
  if (book.writtenChapterCount > 0) return { title: "继续打磨已经写下的章节", reason: "阅读采用正文，核对设定与章节变化，再继续下一段故事。", label: "打开正文工作台", href: path(book, "writing"), tone: "normal" };
  return { title: "把故事方向落实为章节计划", reason: "完善本书的故事、人物与世界，采用卷章计划，为正文创作建立依据。", label: "继续准备故事", href: path(book, "planning"), tone: "normal" };
}

export function homeDraftAction(draft: HomeCreationDraft): HomeAction {
  const waiting = draft.status === "waiting_direction" || draft.status === "review";
  return { title: draft.status === "failed" ? "回到原草稿核对准备结果" : waiting ? "审阅开书方向与资料" : draft.status === "generating" ? "查看开书资料准备进展" : "继续准备这本书",
    reason: "开书草稿和已保存候选保留在同一表单中。明确采用后才建立正式书籍。", label: waiting ? "继续审阅开书资料" : "打开原开书草稿", href: `/new-design/books/new?session=${encodeURIComponent(draft.id)}`, tone: draft.status === "failed" || waiting ? "attention" : draft.status === "generating" ? "running" : "normal" };
}

export function homeTotals(snapshot: HomeSnapshot) {
  const books = snapshot.books;
  return {
    books: books.length,
    running: books.filter(hasLiveWork).length,
    attention: books.filter(needsConfirmation).length,
    ready: books.filter(book => book.writableChapterPlanCount > 0).length,
    chapters: books.reduce((sum, book) => sum + book.writtenChapterCount, 0),
    worldBooks: books.filter(book => book.worldCount > 0).length,
    characters: books.reduce((sum, book) => sum + book.characterCount, 0),
    stable: books.reduce((sum, book) => sum + book.stableChapterCount, 0),
    required: books.reduce((sum, book) => sum + book.requiredFieldCount, 0),
    filled: books.reduce((sum, book) => sum + book.filledRequiredFieldCount, 0),
  };
}

export function homeStages(book: HomeBookFact) {
  return [
    { label: "项目设定", detail: "正式书籍已建立", evidenced: true, href: path(book, "setting") },
    { label: "故事规划", detail: book.storyPlanCount ? "故事方向已采用" : "待采用故事方向", evidenced: book.storyPlanCount > 0, href: path(book, "planning") },
    { label: "世界与角色", detail: `${book.worldCount} 份世界设定 · ${book.characterCount} 位人物`, evidenced: book.worldCount > 0 && book.characterCount > 0, href: path(book, "world") },
    { label: "卷与章节", detail: `${book.volumePlanCount} 卷 · ${book.adoptedChapterPlanCount} 章计划已采用`, evidenced: book.volumePlanCount > 0 && book.adoptedChapterPlanCount > 0, href: path(book, "planning") },
    { label: "正文创作", detail: `${book.writtenChapterCount} 章正文已采用`, evidenced: book.writtenChapterCount > 0, href: path(book, "writing") },
    { label: "质量完善", detail: `${book.stableChapterCount} 章已稳定 · ${book.openQualityIssues} 项待处理`, evidenced: book.stableChapterCount > 0, href: path(book, "views/quality") },
  ];
}
