import type { HomeBookFact, HomeCreationDraft, HomeModelStatus, HomeSnapshot } from "../../common/home";
import { homeBookAction, homeDraftAction, homeStages } from "../../common/home/presentation";

export function HomeModelNotice({ models, failed, loading, retry }: { models: HomeModelStatus | null; failed: boolean; loading: boolean; retry: () => void }) {
  if (!failed && models?.configured) return null;
  if (!models && loading) return <p className="nd-home-model-pending" role="status">正在核对 AI 创作配置…</p>;
  const missing = models?.tasks.filter(task => !task.configured) ?? [];
  return <section className="nd-home-alert" aria-labelledby="home-setup-title"><div><strong id="home-setup-title">{failed ? "AI 配置状态暂未读取" : "完成模型配置，就能使用 AI 创作"}</strong><p>{failed ? "可以继续整理作品；重新读取或打开设置核对配置。" : missing.length ? `${missing.map(task => task.label).join("、")}还需配置。人工写作不受影响。` : "选择创作模型并保存启用，再从创作页面开始。"}</p></div><div className="nd-home-actions">{failed && <button className="nd-button" onClick={retry} disabled={loading}>重新读取</button>}<a className="nd-button nd-button-primary" href="/new-design/structure/models">打开模型设置 →</a></div></section>;
}
export function HomeFirstBook({ snapshot, models }: { snapshot: HomeSnapshot; models: HomeModelStatus | null }) {
  if (models?.configured && snapshot.books.some(book => book.writtenChapterCount > 0)) return null;
  const first = [...snapshot.books].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
  const route = first ? `/new-design/books/${encodeURIComponent(first.id)}` : null;
  const stages = [
    { title: "AI 配置", complete: models?.configured === true, href: "/new-design/structure/models" },
    { title: "故事方向", complete: first ? first.storyPlanCount > 0 : Boolean(snapshot.creationDraft?.selectedDirection), href: route ? `${route}/planning` : snapshot.creationDraft ? `/new-design/books/new?session=${encodeURIComponent(snapshot.creationDraft.id)}` : "/new-design/books/new" },
    { title: "建立书籍", complete: Boolean(first), href: route ? `${route}/overview` : "/new-design/books/new" },
    { title: "章节计划", complete: Boolean(first?.adoptedChapterPlanCount), href: route ? `${route}/planning` : "/new-design/books/new" },
    { title: "采用首章", complete: Boolean(first?.writtenChapterCount), href: route ? `${route}/writing` : "/new-design/books/new" },
  ];
  const completed = stages.filter(stage => stage.complete).length;
  const next = stages.find(stage => !stage.complete) ?? stages[4];
  return <section className="nd-home-first" aria-labelledby="home-first-title"><div><strong id="home-first-title">第一本书向导 <small>{completed} / {stages.length} 步完成</small></strong><p>{next.title === "AI 配置" && !models ? "正在核对 AI 配置；人工整理作品仍可继续。" : `下一步：${next.title}。一步步把想法写成可阅读的正文。`}</p></div><div className="nd-home-milestones" aria-label="首书准备里程碑">{stages.map(stage => <a href={stage.href} key={stage.title} className={stage.complete ? "has-evidence" : ""} aria-label={`${stage.title}：${stage.complete ? "已完成" : "待完成"}`} title={`${stage.title}：${stage.complete ? "已完成" : "待完成"}`} />)}</div><a className="nd-home-first-next" href={next.href}>继续准备 →</a></section>;
}
function HomeStarter({ draft }: { draft: HomeCreationDraft | null }) {
  const action = draft ? homeDraftAction(draft) : null;
  return <section className="nd-home-hero nd-home-starter">
    <div className="nd-home-hero-main"><p className="nd-home-overline">{draft ? "继续你的开书草稿" : "开始第一本小说"}</p><h2>{draft ? draft.name || "一个正在酝酿的故事" : "把一个模糊想法，写成完整故事"}</h2><p className="nd-home-description">{action?.reason ?? "选择灵感或模板，让 AI 陪你准备整本结构；也可以从空白表单开始，亲手填写故事设定。"}</p><div className="nd-home-next"><span>{action ? "下一步" : "从一个想法开始"}</span><h3>{action?.title ?? "边准备，边审阅，再继续"}</h3><p>在开书页选择自动准备、逐步审阅或人工填写，所有结果均可明确确认。</p></div></div>
    <aside className="nd-home-starter-aside" aria-label="选择创作方式">
      {action && <a className="nd-button nd-button-primary" href={action.href}>{action.label} →</a>}
      <a className={`nd-button ${action ? "" : "nd-button-primary"}`} href="/new-design/books/new">准备长篇小说 →</a>
      <p>在开书表单中选择 AI 自动准备或逐步审阅。</p>
      <a className="nd-home-short-story" href="/new-design/books/new?method=idea&mode=automatic&form=short_story"><strong>创作一篇短篇</strong><p>准备整篇故事和正文候选。</p></a>
      <a className="nd-home-secondary-link" href="/new-design/books/new?method=blank&mode=manual">手动创建小说</a>
    </aside>
  </section>;
}
export function HomeHero({ book, draft }: { book: HomeBookFact | null; draft: HomeCreationDraft | null }) {
  const draftAction = draft ? homeDraftAction(draft) : null;
  if (!book) return <HomeStarter draft={draft} />;
  const action = homeBookAction(book);
  const route = `/new-design/books/${encodeURIComponent(book.id)}`;
  const run = book.latestDirector;
  return <>
    {draft && draftAction && <section className="nd-home-draft"><div><strong>开书草稿 · {draft.name || "未命名故事"}</strong><p>{draftAction.title}</p></div><a href={draftAction.href}>{draftAction.label} →</a></section>}
    <section className="nd-home-hero" aria-labelledby="home-book-title"><div className="nd-home-hero-main"><div className="nd-home-overline">继续你的故事 <span className={`nd-home-tag is-${action.tone}`}>{action.tone === "attention" ? "等你处理" : action.tone === "running" ? "创作进行中" : "你的作品"}</span></div><p className="nd-home-book-label">正在创作</p><h2 id="home-book-title">《{book.name}》</h2><p className="nd-home-description">{book.description || "从本书的方向、人物和世界出发，一章章写下你的故事。"}</p><div className="nd-home-next"><span>下一步</span><h3>{action.title}</h3><p>{action.reason}</p></div>
      <section className="nd-home-journey" aria-labelledby="home-journey-title"><div className="nd-home-section-heading"><h3 id="home-journey-title">整本创作旅程</h3><small>按已保存的正式内容查看</small></div><ol>{homeStages(book).map((stage, index) => <li key={stage.label}><a href={stage.href} className={stage.evidenced ? "has-evidence" : ""}><span className="nd-home-stage-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><strong>{stage.label}</strong><small>{stage.detail}</small></a></li>)}</ol></section>
    </div><aside className="nd-home-book-side"><div className="nd-home-book-cover" aria-label={`《${book.name}》书名展示`}><span>我的创作</span><strong>{book.name}</strong><small>一章一章，写成故事</small></div><a className="nd-button nd-button-primary" href={action.href}>{action.label} →</a><a className="nd-home-secondary-link" href={`${route}/overview`}>打开本书工作台</a><a className="nd-home-secondary-link" href="/new-design/operations/director">查看所有作品进展</a></aside>
    <dl className="nd-home-facts"><div><dt>已采用章节</dt><dd>{book.writtenChapterCount} 章</dd></div><div><dt>主要人物</dt><dd>{book.characterCount} 位</dd></div><div><dt>世界设定</dt><dd>{book.worldCount ? `${book.worldCount} 份` : "等待准备"}</dd></div><div><dt>最近创作</dt><dd><time dateTime={book.updatedAt}>{new Date(book.updatedAt).toLocaleDateString("zh-CN")}</time></dd></div></dl>
    {run && run.chapterCount > 0 && <div className="nd-home-run"><div><strong>本次导演范围</strong><span>{run.savedCandidateCount} / {run.chapterCount} 章候选已保存</span></div><progress aria-label="本次范围候选保存进度" value={run.savedCandidateCount} max={run.chapterCount} /><p>候选保存进度独立于正文采用和全书完成状态。</p></div>}
    </section>
  </>;
}
