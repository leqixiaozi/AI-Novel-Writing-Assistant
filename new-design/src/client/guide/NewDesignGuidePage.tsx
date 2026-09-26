import { useEffect, useMemo, useRef, useState } from "react";
import type { HomeBookFact, HomeModelStatus, HomeSnapshot } from "../../common/home";
import { homeBookAction, homeDraftAction, selectHomeBook } from "../../common/home/presentation";
import { newDesignApi } from "../api";
import "./guide.css";

type MilestoneStatus = "complete" | "current" | "pending" | "unknown";

interface GuideMilestone {
  label: string;
  description: string;
  result: string | null;
  status: MilestoneStatus;
  href: string;
  action: string;
}

function bookPath(book: HomeBookFact, page: string) {
  return `/new-design/books/${encodeURIComponent(book.id)}/${page}`;
}

export function buildMilestones(snapshot: HomeSnapshot | null, models: HomeModelStatus | null): GuideMilestone[] {
  const book = snapshot ? selectHomeBook(snapshot.books) : null;
  const draft = snapshot?.creationDraft ?? null;
  const draftHref = draft ? homeDraftAction(draft).href : "/new-design/books/new";
  const directionReady = Boolean(book || draft?.selectedDirection);
  const productionReady = Boolean(book && (book.adoptedChapterPlanCount > 0 || book.writableChapterPlanCount > 0));
  const milestones = [
    {
      label: "创作环境",
      description: "配置一个能完成规划、正文和审校的文本模型。",
      result: models ? `${models.tasks.filter(item => item.configured).length}/${models.tasks.length} 项模型任务可用` : null,
      known: Boolean(models), complete: Boolean(models?.configured),
      href: "/new-design/structure/models",
      action: "检查创作环境",
    },
    {
      label: "灵感与方向",
      description: "写下一句话灵感，并从 AI 给出的方向中选择一套。",
      result: book ? `《${book.name}》` : draft?.selectedDirection ? "开书方向已选择" : null,
      known: Boolean(snapshot), complete: directionReady,
      href: book ? bookPath(book, "overview") : draftHref,
      action: draft ? "继续开书草稿" : "开始确定方向",
    },
    {
      label: "开书准备",
      description: "准备故事、世界、角色、卷章规划和执行资源。",
      result: book ? `《${book.name}》已建立` : null,
      known: Boolean(snapshot), complete: Boolean(book),
      href: book ? bookPath(book, "setting") : draftHref,
      action: book ? "核对本书设定" : "完成开书准备",
    },
    {
      label: "生产方式",
      description: "选择 AI 持续创作，或进入可编辑的章节工作台。",
      result: productionReady && book ? `${book.adoptedChapterPlanCount} 章计划已采用` : null,
      known: Boolean(snapshot), complete: productionReady,
      href: book ? bookPath(book, "planning") : draftHref,
      action: book ? "准备章节生产" : "先完成开书",
    },
    {
      label: "首章成稿",
      description: "采用首章正文后，打开作品继续阅读和创作。",
      result: book?.writtenChapterCount ? `${book.writtenChapterCount} 章正文已采用` : null,
      known: Boolean(snapshot), complete: Boolean(book?.writtenChapterCount),
      href: book ? bookPath(book, "writing") : draftHref,
      action: book ? "进入章节创作" : "先完成开书",
    },
  ];
  const currentIndex = milestones.findIndex(item => item.known && !item.complete);
  return milestones.map((item, index) => ({
    label: item.label, description: item.description, result: item.result, href: item.href, action: item.action,
    status: !item.known ? "unknown" : item.complete ? "complete" : index === currentIndex ? "current" : "pending",
  }));
}

export default function NewDesignGuidePage() {
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null);
  const [models, setModels] = useState<HomeModelStatus | null>(null);
  const [snapshotFailed, setSnapshotFailed] = useState(false);
  const [modelsFailed, setModelsFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true);
    setSnapshotFailed(false);
    setModelsFailed(false);
    void Promise.allSettled([newDesignApi.getHomeSnapshot(), newDesignApi.getHomeModels()]).then(([home, model]) => {
      if (request !== generation.current) return;
      if (home.status === "fulfilled") setSnapshot(home.value);
      else setSnapshotFailed(true);
      if (model.status === "fulfilled") setModels(model.value);
      else setModelsFailed(true);
      setLoading(false);
    });
    return () => { generation.current++; };
  }, [refresh]);

  const milestones = useMemo(() => buildMilestones(snapshot, models), [snapshot, models]);
  const book = snapshot ? selectHomeBook(snapshot.books) : null;
  const completed = milestones.filter(item => item.status === "complete").length;
  const graduated = completed === milestones.length;
  const current = milestones.some(item => item.status === "unknown")
    ? null : milestones.find(item => item.status === "current");
  const completedAction = book ? homeBookAction(book) : null;
  const draftAction = snapshot?.creationDraft ? homeDraftAction(snapshot.creationDraft) : null;
  const activeBookAction = !snapshotFailed && !modelsFailed && current?.label !== "创作环境" && completedAction?.tone !== "normal" ? completedAction : null;
  const recommended = activeBookAction ? {
    title: activeBookAction.title, description: activeBookAction.reason,
    reason: "先到本书原页面核对当前进度和已保存结果，再继续这一步。",
    label: activeBookAction.label, href: activeBookAction.href,
  } : current ? {
    title: current.label === "创作环境" ? "先完成创作环境配置"
      : current.label === "灵感与方向" ? "用一句灵感开始第一本小说"
      : current.label === "开书准备" ? "继续准备第一本书"
      : current.label === "生产方式" ? "选择正文生产方式" : "继续完成第一章",
    description: current.description,
    reason: current.label === "首章成稿"
      ? "第一章成稿后，就跑通了从灵感到正文的完整路径。"
      : "完成这一项后，可以沿着路线继续推进。",
    label: current.action, href: current.href,
  } : milestones.some(item => item.status === "unknown") ? null : completedAction ? {
    title: graduated && completedAction.tone === "normal" ? "第一章可以阅读" : completedAction.title,
    description: graduated && completedAction.tone === "normal"
      ? "首章正文已采用，可以继续阅读、写作和完善后续章节。" : completedAction.reason,
    reason: graduated ? "第一本书路线已完成；有待处理事项时，先回到原来源核对。" : completedAction.reason,
    label: completedAction.label, href: completedAction.href,
  } : draftAction ? {
    title: draftAction.title, description: draftAction.reason,
    reason: "开书草稿与已保存结果会留在原会话中。",
    label: draftAction.label, href: draftAction.href,
  } : null;
  const retry = () => setRefresh(value => value + 1);
  const readFailure = snapshotFailed || modelsFailed;

  return <main className="nd-shell nd-guide" aria-busy={loading}>
    {readFailure && <section className="nd-guide-alert" role="alert"><div><strong>部分创作状态暂未读取</strong><p>{snapshotFailed ? "书籍与开书进度未读取。" : ""}{modelsFailed ? "模型配置状态未读取。" : ""} 未读取不表示已完成或需要重做。</p></div><button className="nd-button" type="button" onClick={retry} disabled={loading}>{loading ? "读取中…" : "重新读取"}</button></section>}
    <section className="nd-guide-hero" aria-labelledby="guide-headline">
      <div className="nd-guide-hero-main">
        <div className="nd-guide-badges"><span>创作向导</span><span>{graduated ? "首章已完成" : `第 ${Math.min(completed + 1, milestones.length)} 步 / 共 ${milestones.length} 步`}</span></div>
        <h1 id="guide-headline">{loading && !snapshot && !models ? "正在整理你的创作路线" : readFailure && !recommended ? "暂时无法读取创作进度" : recommended?.title ?? "先恢复完整创作状态"}</h1>
        <p className="nd-guide-description">{loading && !snapshot && !models ? "正在核对模型、开书资料和正式书籍。" : recommended?.description ?? "重新读取后，向导会根据正式记录推荐下一步。"}</p>
        <div className="nd-guide-reason"><strong>为什么推荐这一步</strong><p>{recommended?.reason ?? "先核对正式创作记录，保留已有作品和草稿。"}</p></div>
      </div>
      <aside className="nd-guide-hero-side">
        {recommended ? <a className="nd-button nd-button-primary" href={recommended.href}>{recommended.label} →</a> : <button className="nd-button nd-button-primary" type="button" onClick={retry} disabled={loading}>{loading ? "读取中…" : "重新读取状态"}</button>}
        {book && <div className="nd-guide-current-book"><small>当前作品</small><strong>{book.name}</strong><span>{book.writtenChapterCount > 0 ? `${book.writtenChapterCount} 章正文已采用` : "继续准备首章"}</span></div>}
        {!book && snapshot?.creationDraft && <div className="nd-guide-current-book"><small>开书草稿</small><strong>{snapshot.creationDraft.name || "未命名故事"}</strong><span>继续原草稿</span></div>}
      </aside>
    </section>
    <section className="nd-guide-route" aria-labelledby="guide-route-title">
      <header><div><h2 id="guide-route-title">第一本书路线</h2><p>进度来自正式模型配置、开书结果、章节计划和采用正文，不需要手动打勾。</p></div><strong>{readFailure ? "部分未读取" : `${completed}/${milestones.length} 完成`}</strong></header>
      <ol className="nd-guide-steps" aria-label="创作里程碑">{milestones.map((item, index) => <li className={`is-${item.status}`} key={item.label}>
        <span className="nd-guide-number" aria-hidden="true">{item.status === "complete" ? "✓" : index + 1}</span>
        <div><h3>{item.label}</h3><p>{item.description}</p></div>
        <div className="nd-guide-result">{item.result ? <span>{item.result}</span> : item.status === "current" ? <span className="nd-guide-current-label">当前步骤</span> : item.status === "unknown" ? <span>未读取</span> : null}</div>
        <a className="nd-guide-step-link" href={item.href} aria-label={`${item.label}：${item.status === "complete" ? "查看" : item.action}`}>{item.status === "complete" ? "查看" : item.action}</a>
      </li>)}</ol>
    </section>
    <section className="nd-guide-optional" aria-labelledby="guide-optional-title"><h2 id="guide-optional-title">可选增强</h2><p>这些能力可以提升长期创作，但不会阻塞你完成第一章。</p><div>
      <a href="/new-design/knowledge"><span aria-hidden="true">01</span><strong>知识库</strong><p>需要参考资料或长期设定时再启用，不影响开始创作。</p></a>
      <a href="/new-design/resources/professional?type=writing_config"><span aria-hidden="true">02</span><strong>写法配置</strong><p>有明确文风要求后再整理写法，首章创作无需等待。</p></a>
      <a href="/new-design/structure/models"><span aria-hidden="true">03</span><strong>图像能力</strong><p>需要封面或角色图时，再配置对应的图像模型。</p></a>
    </div></section>
    <section className={`nd-guide-footer ${graduated ? "is-graduated" : ""}`}><div><strong>{graduated ? "第一本书的新手路线完成" : "你不需要先学会所有功能"}</strong><p>{graduated ? "这份创作成果会继续保留；可以返回作品推进后续章节。" : "沿着上面的唯一推荐动作推进即可。世界、角色和卷章资料可以在创作过程中逐步完善。"}</p></div>{graduated && <a className="nd-button" href="/new-design/books">查看全部书籍</a>}</section>
    <a className="nd-guide-home-link" href="/new-design">返回创作首页</a>
  </main>;
}
