import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthorTaskRecord } from "../../common/authorTasks";
import type {
  BookshelfSnapshot,
  ShelfBookDetail,
} from "../../common/bookshelf";
import type { ChapterDocumentSummary } from "../../common/contracts";
import {
  creativeHubBindingSchema,
  type CreativeHubBinding,
  type CreativeHubCapability,
  type CreativeHubState,
  type CreativeHubThread,
  type CreativeHubTurn,
} from "../../common/creativeHub";
import type { CreativeHubApi } from "./api";
import { CreativeHubContextPanel } from "./CreativeHubContextPanel";
import { CreativeHubConversation } from "./CreativeHubConversation";
import { CreativeHubThreadList } from "./CreativeHubThreadList";
import {
  areCreativeHubBindingsEqual,
  creativeHubHref,
  readCreativeHubLocation,
} from "./location";
import "./creative-hub.css";

interface PendingQuestion {
  threadId: string;
  requestKey: string;
  question: string;
  expectedThreadRevision: number;
}
interface CreativeHubPageProps {
  api: CreativeHubApi;
  getBookshelf(): Promise<BookshelfSnapshot>;
  getShelfBookDetail(bookId: string): Promise<ShelfBookDetail>;
  listChapterDocuments(bookId: string): Promise<ChapterDocumentSummary[]>;
}
const PENDING_KEY = "new-design:creative-hub:pending-question:";
const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;
function readPending(threadId: string): PendingQuestion | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(PENDING_KEY + threadId) ?? "null",
    ) as PendingQuestion | null;
    return value?.threadId === threadId ? value : null;
  } catch {
    return null;
  }
}
function savePending(threadId: string, value: PendingQuestion | null) {
  try {
    if (value)
      sessionStorage.setItem(PENDING_KEY + threadId, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_KEY + threadId);
  } catch {
    /* Database receipts remain canonical. */
  }
}
function replaceThread(items: CreativeHubThread[], next: CreativeHubThread) {
  return items
    .map((item) => (item.id === next.id ? next : item))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
const taskValue = (binding: CreativeHubBinding) =>
  binding.taskKind && binding.taskId
    ? `${binding.taskKind}|${binding.taskId}`
    : "";
const bindingTitle = (
  binding: CreativeHubBinding,
  bookshelf: BookshelfSnapshot | null,
) => {
  const book = bookshelf?.books.find((item) => item.id === binding.bookId);
  return book ? `《${book.name}》创作诊断` : "新的创作诊断";
};

export default function CreativeHubPage({
  api,
  getBookshelf,
  getShelfBookDetail,
  listChapterDocuments,
}: CreativeHubPageProps) {
  const initial =
    typeof window === "undefined"
      ? {
          threadId: null,
          binding: {},
          explicit: false,
          bindingExplicit: false,
          error: null,
        }
      : readCreativeHubLocation(window.location.search);
  const [location, setLocation] = useState(initial),
    [capability, setCapability] = useState<CreativeHubCapability | null>(null),
    [threads, setThreads] = useState<CreativeHubThread[]>([]),
    [selected, setSelected] = useState<CreativeHubThread | null>(null),
    [state, setState] = useState<CreativeHubState | null>(null),
    [turns, setTurns] = useState<CreativeHubTurn[]>([]),
    [bookshelf, setBookshelf] = useState<BookshelfSnapshot | null>(null);
  const [chapters, setChapters] = useState<ChapterDocumentSummary[]>([]),
    [tasks, setTasks] = useState<AuthorTaskRecord[]>([]),
    [includeArchived, setIncludeArchived] = useState(false);
  const [busy, setBusy] = useState(true),
    [detailBusy, setDetailBusy] = useState(false),
    [bindingBusy, setBindingBusy] = useState(false),
    [mutating, setMutating] = useState(false),
    [failure, setFailure] = useState(initial.error ?? ""),
    [detailFailure, setDetailFailure] = useState("");
  const [creating, setCreating] = useState(false),
    [createTitle, setCreateTitle] = useState("新的创作诊断"),
    [createBookId, setCreateBookId] = useState(initial.binding.bookId ?? ""),
    [title, setTitle] = useState(""),
    [bindingBookId, setBindingBookId] = useState(""),
    [bindingChapterId, setBindingChapterId] = useState(""),
    [bindingTask, setBindingTask] = useState(""),
    [question, setQuestion] = useState("");
  const loadGeneration = useRef(0),
    bindingGeneration = useRef(0),
    autoCreateKey = useRef("");

  const navigate = useCallback(
    (thread: CreativeHubThread | null, replace = false) => {
      const next = {
        threadId: thread?.id ?? null,
        binding: thread?.binding ?? {},
        explicit: Boolean(thread),
        bindingExplicit: Boolean(thread && Object.keys(thread.binding).length),
        error: null,
      };
      setLocation((current) =>
        current.threadId === next.threadId &&
        current.error === null &&
        areCreativeHubBindingsEqual(current.binding, next.binding)
          ? current
          : next,
      );
      if (typeof window !== "undefined")
        window.history[replace ? "replaceState" : "pushState"](
          {},
          "",
          creativeHubHref(thread?.id, thread?.binding),
        );
    },
    [],
  );
  useEffect(() => {
    const pop = () =>
      setLocation(readCreativeHubLocation(window.location.search));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  const loadIndex = useCallback(async () => {
    setBusy(true);
    setFailure(location.error ?? "");
    try {
      const [gate, shelf] = await Promise.all([
        api.capability(),
        getBookshelf().catch(() => null),
      ]);
      setCapability(gate);
      setBookshelf(shelf);
      if (!gate.installed) {
        setThreads([]);
        setSelected(null);
        return;
      }
      let items = await api.list(includeArchived);
      if (
        location.threadId &&
        !items.some((item) => item.id === location.threadId)
      ) {
        const includingArchived = await api.list(true);
        if (includingArchived.some((item) => item.id === location.threadId)) {
          items = includingArchived;
        }
      }
      setThreads(items);
      if (location.error) {
        setSelected(null);
        return;
      }
      if (location.threadId) {
        const exact = items.find((item) => item.id === location.threadId);
        if (!exact) {
          setSelected(null);
          setFailure("指定会话不存在；未自动切换到其他会话。");
        } else {
          setSelected(exact);
          if (exact.status === "archived") setIncludeArchived(true);
        }
        return;
      }
      if (location.bindingExplicit) {
        const exact = items.find(
          (item) =>
            item.status === "active" &&
            areCreativeHubBindingsEqual(item.binding, location.binding),
        );
        if (exact) {
          setSelected(exact);
          navigate(exact, true);
          return;
        }
        const key = JSON.stringify(location.binding);
        if (gate.operational && autoCreateKey.current !== key) {
          autoCreateKey.current = key;
          const created = await api.create({
            title: bindingTitle(location.binding, shelf),
            binding: location.binding,
          });
          items = [created, ...items];
          setThreads(items);
          setSelected(created);
          navigate(created, true);
          return;
        }
        setSelected(null);
        setCreateBookId(location.binding.bookId ?? "");
        setCreateTitle(bindingTitle(location.binding, shelf));
        setCreating(true);
        return;
      }
      const first =
        items.find((item) => item.status === "active") ?? items[0] ?? null;
      setSelected(first);
      if (first) navigate(first, true);
    } catch (error) {
      setFailure(
        message(error, "创作中枢目录读取失败；原会话不会被重建或覆盖。"),
      );
    } finally {
      setBusy(false);
    }
  }, [api, getBookshelf, includeArchived, location, navigate]);
  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);

  const loadDetail = useCallback(
    async (thread: CreativeHubThread) => {
      const generation = ++loadGeneration.current;
      setDetailBusy(true);
      setDetailFailure("");
      try {
        const [nextState, nextTurns] = await Promise.all([
          api.state(thread.id),
          api.history(thread.id),
        ]);
        if (generation !== loadGeneration.current) return;
        setState(nextState);
        setTurns(nextTurns);
        setTitle(thread.title);
        setBindingBookId(thread.binding.bookId ?? "");
        setBindingChapterId(thread.binding.chapterDocumentId ?? "");
        setBindingTask(taskValue(thread.binding));
        setQuestion(readPending(thread.id)?.question ?? "");
      } catch (error) {
        if (generation === loadGeneration.current)
          setDetailFailure(
            message(
              error,
              "原会话状态未读取；已显示的历史保留，不会自动改选其他会话。",
            ),
          );
      } finally {
        if (generation === loadGeneration.current) setDetailBusy(false);
      }
    },
    [api],
  );
  useEffect(() => {
    if (selected) void loadDetail(selected);
    else {
      loadGeneration.current++;
      setState(null);
      setTurns([]);
      setTitle("");
      setBindingBookId("");
      setBindingChapterId("");
      setBindingTask("");
      setQuestion("");
    }
  }, [selected, loadDetail]);
  useEffect(() => {
    const generation = ++bindingGeneration.current;
    if (!bindingBookId) {
      setChapters([]);
      setTasks([]);
      setBindingChapterId("");
      setBindingTask("");
      return;
    }
    setBindingBusy(true);
    void Promise.all([
      listChapterDocuments(bindingBookId),
      getShelfBookDetail(bindingBookId),
    ])
      .then(([documents, detail]) => {
        if (generation !== bindingGeneration.current) return;
        setChapters(documents.filter((item) => item.status === "active"));
        setTasks(detail.records.items);
      })
      .catch((error) => {
        if (generation === bindingGeneration.current) {
          setChapters([]);
          setTasks([]);
          setDetailFailure(message(error, "作品的章节与任务范围未读取。"));
        }
      })
      .finally(() => {
        if (generation === bindingGeneration.current) setBindingBusy(false);
      });
  }, [bindingBookId, getShelfBookDetail, listChapterDocuments]);

  const selectThread = (thread: CreativeHubThread) => {
    setFailure("");
    setSelected(thread);
    navigate(thread);
  };
  const create = async () => {
    if (!capability?.operational || !createTitle.trim()) return;
    setMutating(true);
    setFailure("");
    try {
      const binding: CreativeHubBinding = createBookId
        ? { bookId: createBookId }
        : {};
      const created = await api.create({ title: createTitle.trim(), binding });
      setThreads((current) => [created, ...current]);
      setSelected(created);
      setCreating(false);
      setCreateTitle("新的创作诊断");
      setCreateBookId("");
      navigate(created);
    } catch (error) {
      setFailure(message(error, "新会话未创建；请核对能力门禁后重试。"));
    } finally {
      setMutating(false);
    }
  };
  const saveBinding = async () => {
    if (!selected || selected.status === "archived" || !capability?.operational)
      return;
    setMutating(true);
    setDetailFailure("");
    try {
      const [taskKind, taskId] = bindingTask.split("|");
      const binding: CreativeHubBinding = creativeHubBindingSchema.parse(bindingBookId
        ? {
            bookId: bindingBookId,
            ...(bindingChapterId
              ? { chapterDocumentId: bindingChapterId }
              : {}),
            ...(taskKind && taskId ? { taskKind, taskId } : {}),
          }
        : {});
      const next = await api.update(selected.id, {
        title: title.trim() || selected.title,
        binding,
        expectedRevision: selected.revision,
      });
      setSelected(next);
      setThreads((current) => replaceThread(current, next));
      navigate(next, true);
      setState(await api.state(next.id));
    } catch (error) {
      setDetailFailure(message(error, "会话绑定未保存；原绑定和历史仍保留。"));
    } finally {
      setMutating(false);
    }
  };
  const archive = async () => {
    if (
      !selected ||
      selected.status === "archived" ||
      !capability?.operational ||
      !window.confirm(`归档会话“${selected.title}”？历史会保留，可随时恢复。`)
    )
      return;
    setMutating(true);
    try {
      const archived = await api.archive(selected.id, selected.revision);
      if (includeArchived) {
        setSelected(archived);
        setThreads((current) => replaceThread(current, archived));
        navigate(archived, true);
      } else {
        const remaining = threads.filter(
          (item) => item.id !== selected.id && item.status === "active",
        );
        setThreads(remaining);
        setSelected(remaining[0] ?? null);
        navigate(remaining[0] ?? null, true);
      }
    } catch (error) {
      setDetailFailure(message(error, "会话未归档；请读取最新版本后再决定。"));
    } finally {
      setMutating(false);
    }
  };
  const restore = async () => {
    if (!selected || selected.status !== "archived" || !capability?.operational)
      return;
    setMutating(true);
    try {
      const restored = await api.restore(selected.id, selected.revision);
      setSelected(restored);
      setThreads((current) => replaceThread(current, restored));
      navigate(restored, true);
    } catch (error) {
      setDetailFailure(message(error, "会话未恢复；请重新读取后再试。"));
    } finally {
      setMutating(false);
    }
  };
  const submit = async () => {
    if (
      !selected ||
      selected.status === "archived" ||
      !capability?.operational ||
      !question.trim()
    )
      return;
    const previous = readPending(selected.id),
      pending =
        previous &&
        previous.question === question.trim() &&
        previous.expectedThreadRevision === selected.revision
          ? previous
          : {
              threadId: selected.id,
              requestKey: crypto.randomUUID(),
              question: question.trim(),
              expectedThreadRevision: selected.revision,
            };
    savePending(selected.id, pending);
    setMutating(true);
    setDetailFailure("");
    try {
      await api.start(selected.id, {
        requestKey: pending.requestKey,
        question: pending.question,
        expectedThreadRevision: pending.expectedThreadRevision,
      });
      savePending(selected.id, null);
      setQuestion("");
      await loadDetail(selected);
    } catch (error) {
      setDetailFailure(
        `${message(error, "诊断回执尚未确认。")} 原问题与请求凭证已在本次会话保留；再次发送会使用同一凭证。`,
      );
      await api
        .history(selected.id)
        .then(setTurns)
        .catch(() => undefined);
    } finally {
      setMutating(false);
    }
  };
  const resume = async (turn: CreativeHubTurn) => {
    if (
      !selected ||
      turn.threadId !== selected.id ||
      selected.status === "archived" ||
      !capability?.operational
    )
      return;
    setMutating(true);
    setDetailFailure("");
    try {
      await api.resume(selected.id, turn.id);
      await loadDetail(selected);
    } catch (error) {
      setDetailFailure(
        message(error, "原诊断不能安全重试；未知结果不会重新发送。"),
      );
      await api
        .history(selected.id)
        .then(setTurns)
        .catch(() => undefined);
    } finally {
      setMutating(false);
    }
  };

  const gateDisabled = !capability?.operational;
  return (
    <div className="nd-shell nd-creative-hub">
      <header className="nd-page-header">
        <div>
          <p className="nd-eyebrow">新设计／只读创作诊断</p>
          <h1>创作中枢</h1>
          <p>
            持续询问作品进度、失败原因和修改影响，并回到正式来源页面处理。中枢不直接改写正文、规划或任务状态。
          </p>
        </div>
        <button
          type="button"
          className="nd-button"
          disabled={busy}
          onClick={() => void loadIndex()}
        >
          只读刷新
        </button>
      </header>
      {capability && !capability.operational && (
        <section className="nd-message is-warning" role="alert">
          <strong>创作中枢写入门禁未就绪</strong>
          <p>{capability.reason}</p>
          <p>会话与诊断暂时锁定；已有作品、任务和创作内容不受影响。</p>
          <a href="/new-design/structure/maintenance">打开运行维护</a>
        </section>
      )}
      {failure && (
        <p className="nd-message is-error" role="alert">
          {failure}
        </p>
      )}
      {creating && (
        <section className="nd-hub-create">
          <h2>新建持续会话</h2>
          <label>
            会话名称
            <input
              maxLength={120}
              value={createTitle}
              onChange={(event) => setCreateTitle(event.target.value)}
            />
          </label>
          <label>
            绑定作品（可选）
            <select
              value={createBookId}
              onChange={(event) => setCreateBookId(event.target.value)}
            >
              <option value="">暂不绑定</option>
              {bookshelf?.books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button
              className="nd-button nd-button-primary"
              type="button"
              disabled={gateDisabled || mutating || !createTitle.trim()}
              onClick={() => void create()}
            >
              创建会话
            </button>
            <button
              className="nd-button"
              type="button"
              onClick={() => setCreating(false)}
            >
              取消
            </button>
          </div>
        </section>
      )}
      <main className="nd-hub-layout">
        <CreativeHubThreadList
          threads={threads}
          selectedId={selected?.id ?? null}
          busy={busy || gateDisabled}
          includeArchived={includeArchived}
          onSelect={selectThread}
          onCreate={() => setCreating(true)}
          onToggleArchived={() => {
            if (includeArchived && selected?.status === "archived") {
              setSelected(null);
              navigate(null, true);
            }
            setIncludeArchived((value) => !value);
          }}
        />
        <section className="nd-hub-main" aria-busy={detailBusy}>
          {selected ? (
            <>
              <header className="nd-hub-binding">
                <div>
                  <p className="nd-eyebrow">当前上下文</p>
                  <h2>{selected.title}</h2>
                  <p>
                    {state?.book
                      ? `已绑定《${state.book.name}》`
                      : "未绑定作品"}
                    {selected.binding.chapterDocumentId ? " · 已绑定章节" : ""}
                    {selected.binding.taskId ? " · 已绑定原任务" : ""}
                    {selected.status === "archived" ? " · 已归档" : ""}
                  </p>
                </div>
                <div className="nd-hub-binding-actions">
                  <label>
                    会话名称
                    <input
                      maxLength={120}
                      value={title}
                      disabled={selected.status === "archived"}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  <label>
                    作品范围
                    <select
                      value={bindingBookId}
                      disabled={selected.status === "archived"}
                      onChange={(event) => {
                        setBindingBookId(event.target.value);
                        setBindingChapterId("");
                        setBindingTask("");
                      }}
                    >
                      <option value="">不绑定作品</option>
                      {bookshelf?.books.map((book) => (
                        <option key={book.id} value={book.id}>
                          {book.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    章节范围
                    <select
                      value={bindingChapterId}
                      disabled={
                        !bindingBookId ||
                        bindingBusy ||
                        selected.status === "archived"
                      }
                      onChange={(event) =>
                        setBindingChapterId(event.target.value)
                      }
                    >
                      <option value="">全书</option>
                      {chapters.map((chapter) => (
                        <option key={chapter.id} value={chapter.id}>
                          {chapter.logicalOrder}. {chapter.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    原任务范围
                    <select
                      value={bindingTask}
                      disabled={
                        !bindingBookId ||
                        bindingBusy ||
                        selected.status === "archived"
                      }
                      onChange={(event) => setBindingTask(event.target.value)}
                    >
                      <option value="">不指定原任务</option>
                  {tasks.map((task) => {
                    const rawId = task.id.startsWith(`${task.kind}:`)
                      ? task.id.slice(task.kind.length + 1)
                      : task.id;
                    return (
                      <option key={task.id} value={`${task.kind}|${rawId}`}>
                        {task.title} · {task.statusLabel}
                      </option>
                    );
                  })}
                    </select>
                  </label>
                  {selected.status === "active" ? (
                    <>
                      <button
                        type="button"
                        className="nd-button"
                        disabled={
                          gateDisabled ||
                          mutating ||
                          bindingBusy ||
                          !title.trim()
                        }
                        onClick={() => void saveBinding()}
                      >
                        保存名称与绑定
                      </button>
                      <button
                        type="button"
                        className="nd-button nd-button-danger"
                        disabled={gateDisabled || mutating}
                        onClick={() => void archive()}
                      >
                        归档会话
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="nd-button nd-button-primary"
                      disabled={gateDisabled || mutating}
                      onClick={() => void restore()}
                    >
                      恢复会话
                    </button>
                  )}
                </div>
              </header>
              {detailFailure && (
                <p className="nd-message is-error" role="alert">
                  {detailFailure}
                </p>
              )}
              <div className="nd-hub-workspace">
                <CreativeHubConversation
                  turns={turns}
                  busy={mutating || detailBusy}
                  disabled={gateDisabled || selected.status === "archived"}
                  question={question}
                  onQuestionChange={setQuestion}
                  onSubmit={() => void submit()}
                  onResume={(turn) => void resume(turn)}
                />
                <CreativeHubContextPanel
                  thread={selected}
                  state={state}
                  turns={turns}
                  onPrompt={setQuestion}
                />
              </div>
            </>
          ) : (
            <div className="nd-empty-state">
              <h2>选择或新建一个会话</h2>
              <p>会话会保留作品、章节、原任务和每次诊断的冻结状态。</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
