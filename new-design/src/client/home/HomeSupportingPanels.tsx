import type { HomeBookFact } from "../../common/home";
import {
  homeBookAction,
  homeBookPriority,
  needsConfirmation,
} from "../../common/home/presentation";

const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
function reminder(
  book: HomeBookFact,
): { title: string; detail: string; href: string } | null {
  const action = homeBookAction(book);
  if (
    needsConfirmation(book) ||
    book.latestTask?.status === "failed" ||
    book.openQualityIssues > 0
  )
    return {
      title: `《${book.name}》· ${action.title}`,
      detail:
        book.openQualityIssues > 0
          ? `${action.reason} 当前还有 ${book.openQualityIssues} 项质量问题。`
          : action.reason,
      href: action.href,
    };
  return null;
}

export function HomeSupportingPanels({ books }: { books: HomeBookFact[] }) {
  const ordered = [...books].sort(
    (left, right) =>
      homeBookPriority(left) - homeBookPriority(right) ||
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      left.id.localeCompare(right.id),
  );
  const reminders = ordered
    .map(reminder)
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 5);
  const recent = [...books]
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 6);
  return (
    <section className="nd-home-support" aria-label="创作提醒与最近作品">
      <section className="nd-home-reminders">
        <header>
          <div>
            <p className="nd-kicker">需要你处理</p>
            <h2>创作提醒</h2>
          </div>
          <a href="/new-design/operations/director">查看全部进展 →</a>
        </header>
        {reminders.length ? (
          <div>
            {reminders.map((item) => (
              <a href={item.href} key={`${item.href}:${item.title}`}>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <span>处理 →</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="nd-home-clear">
            没有等待确认的事项。可以按照上方推荐继续推进作品。
          </p>
        )}
      </section>
      <section className="nd-home-recent">
        <header>
          <div>
            <p className="nd-kicker">继续创作</p>
            <h2>最近作品</h2>
          </div>
          <a href="/new-design/books">查看全部 →</a>
        </header>
        {recent.length ? (
          <div>
            {recent.map((book) => {
              const action = homeBookAction(book);
              return (
                <article key={book.id}>
                  <a
                    className="nd-home-recent-main"
                    href={`/new-design/books/${encodeURIComponent(book.id)}/overview`}
                  >
                    <strong>{book.name}</strong>
                    <span>
                      {book.writtenChapterCount} 章正文 · {book.characterCount}{" "}
                      位人物 · {dateLabel(book.updatedAt)}更新
                    </span>
                  </a>
                  <a className="nd-home-recent-action" href={action.href}>
                    {action.label} →
                  </a>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="nd-home-clear">
            建立第一本书后，这里会显示可直接继续的作品。
          </p>
        )}
      </section>
    </section>
  );
}
