import type { CreativeHubThread } from "../../common/creativeHub";
export function CreativeHubThreadList({
  threads,
  selectedId,
  busy,
  includeArchived,
  onSelect,
  onCreate,
  onToggleArchived,
}: {
  threads: CreativeHubThread[];
  selectedId: string | null;
  busy: boolean;
  includeArchived: boolean;
  onSelect(thread: CreativeHubThread): void;
  onCreate(): void;
  onToggleArchived(): void;
}) {
  return (
    <aside className="nd-hub-thread-panel">
      <header>
        <div>
          <p className="nd-eyebrow">持续会话</p>
          <h2>诊断记录</h2>
        </div>
        <button
          type="button"
          className="nd-button"
          disabled={busy}
          onClick={onCreate}
        >
          新会话
        </button>
      </header>
      <label className="nd-hub-archive-toggle">
        <input
          type="checkbox"
          checked={includeArchived}
          disabled={busy}
          onChange={onToggleArchived}
        />
        <span>显示已归档会话</span>
      </label>
      {threads.length ? (
        <ul>
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                className={thread.id === selectedId ? "is-selected" : ""}
                aria-pressed={thread.id === selectedId}
                onClick={() => onSelect(thread)}
              >
                <strong>
                  {thread.title}
                  {thread.status === "archived" && <em>已归档</em>}
                </strong>
                <small>
                  {thread.binding.bookId ? "已绑定作品" : "未绑定作品"}
                  {thread.binding.chapterDocumentId ? " · 指定章节" : ""}
                  {thread.binding.taskId ? " · 指定任务" : ""} · 版本{" "}
                  {thread.revision}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="nd-empty-state">
          <p>{includeArchived ? "还没有创作中枢会话。" : "尚无当前会话。"}</p>
          <p>新建会话后，可绑定作品并持续保留诊断历史。</p>
        </div>
      )}
    </aside>
  );
}
