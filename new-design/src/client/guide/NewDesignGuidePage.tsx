import { useEffect, useMemo, useRef, useState } from "react";
import type { HomeBookFact, HomeModelStatus, HomeSnapshot } from "../../common/home";
import { homeBookAction, homeDraftAction, selectHomeBook } from "../../common/home/presentation";
import { newDesignApi } from "../api";
import "./guide.css";

type MilestoneStatus = "complete" | "pending" | "unknown";

interface GuideMilestone {
  label: string;
  detail: string;
  status: MilestoneStatus;
  href: string;
  action: string;
}

function bookPath(book: HomeBookFact, page: string) {
  return `/new-design/books/${encodeURIComponent(book.id)}/${page}`;
}

function status(known: boolean, complete: boolean): MilestoneStatus {
  return known ? complete ? "complete" : "pending" : "unknown";
}

function buildMilestones(snapshot: HomeSnapshot | null, models: HomeModelStatus | null): GuideMilestone[] {
  const book = snapshot ? selectHomeBook(snapshot.books) : null;
  const draft = snapshot?.creationDraft ?? null;
  const draftHref = draft ? homeDraftAction(draft).href : "/new-design/books/new";
  const directionReady = Boolean(book || draft?.selectedDirection);
  const productionReady = Boolean(book && (book.adoptedChapterPlanCount > 0 || book.writableChapterPlanCount > 0 || book.latestDirector));
  return [
    {
      label: "创作环境",
      detail: models ? models.configured ? `${models.tasks.filter(item => item.configured).length}/${models.tasks.length} 项模型任务可用` : "模型任务尚未配置完整" : "模型状态未读取",
      status: status(Boolean(models), Boolean(models?.configured)),
      href: "/new-design/structure/settings",
      action: "检查创作环境",
    },
    {
      label: "灵感与方向",
      detail: snapshot ? draft?.selectedDirection ? "开书方向已明确选择" : book ? "已有正式书籍方向" : draft ? "开书草稿等待选择方向" : "从灵感、题材或自动引导开始" : "开书状态未读取",
      status: status(Boolean(snapshot), directionReady),
      href: draftHref,
      action: draft ? "继续开书草稿" : "开始确定方向",
    },
    {
      label: "开书准备",
      detail: snapshot ? book ? `正式书籍《${book.name}》可继续创作` : "明确采用开书资料后建立正式书籍" : "书籍状态未读取",
      status: status(Boolean(snapshot), Boolean(book)),
      href: book ? bookPath(book, "setting") : draftHref,
      action: book ? "核对本书设定" : "完成开书准备",
    },
    {
      label: "生产方式",
      detail: snapshot ? book ? productionReady ? `${book.adoptedChapterPlanCount} 章计划已采用，可进入章节生产` : "采用卷章计划，或在全书导演中准备生产范围" : "建立正式书籍后选择生产方式" : "生产状态未读取",
      status: status(Boolean(snapshot), productionReady),
      href: book ? bookPath(book, "planning") : draftHref,
      action: book ? "准备章节生产" : "先完成开书",
    },
    {
      label: "首章成稿",
      detail: snapshot ? book?.writtenChapterCount ? `${book.writtenChapterCount} 章正文已明确采用` : "采用首章正文后完成此里程碑" : "正文状态未读取",
      status: status(Boolean(snapshot), Boolean(book?.writtenChapterCount)),
      href: book ? bookPath(book, "writing") : draftHref,
      action: book ? "进入章节创作" : "先完成开书",
    },
  ];
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
  const pending = milestones.find(item => item.status === "pending");
  const completedAction = book ? homeBookAction(book) : null;
  const recommended = pending ?? (milestones.some(item => item.status === "unknown") ? null : completedAction ? {
    label: completedAction.title,
    detail: completedAction.reason,
    href: completedAction.href,
    action: completedAction.label,
    status: "complete" as const,
  } : null);
  const retry = () => setRefresh(value => value + 1);

  return <main className="nd-shell nd-guide" aria-busy={loading}>
    <header className="nd-guide-header">
      <div><p className="nd-kicker">从准备到首章</p><h1>创作向导</h1><p>按真实创作记录判断进度。每次只推进一个明确步骤，完成后继续进入下一项。</p></div>
      <a className="nd-button nd-button-secondary" href="/new-design">返回创作首页</a>
    </header>
    {(snapshotFailed || modelsFailed) && <section className="nd-guide-alert" role="alert"><div><strong>部分创作状态暂未读取</strong><p>{snapshotFailed ? "书籍与开书进度未读取。" : ""}{modelsFailed ? "模型配置状态未读取。" : ""} 未读取不表示已经完成或需要重做。</p></div><button className="nd-button" type="button" onClick={retry} disabled={loading}>{loading ? "读取中…" : "重新读取"}</button></section>}
    <section className="nd-guide-next" aria-labelledby="guide-next-title">
      <div><p className="nd-kicker">推荐下一步</p><h2 id="guide-next-title">{loading && !snapshot && !models ? "正在读取创作进度" : recommended?.label ?? "先恢复完整创作状态"}</h2><p>{loading && !snapshot && !models ? "正在核对模型、开书资料和正式书籍。" : recommended?.detail ?? "重新读取后，向导会根据正式记录给出唯一下一步。"}</p></div>
      {recommended ? <a className="nd-button nd-button-primary" href={recommended.href}>{recommended.action}</a> : <button className="nd-button nd-button-primary" type="button" onClick={retry} disabled={loading}>{loading ? "读取中…" : "重新读取状态"}</button>}
    </section>
    <ol className="nd-guide-steps" aria-label="创作里程碑">
      {milestones.map((item, index) => <li className={`is-${item.status}`} key={item.label}>
        <span className="nd-guide-number" aria-hidden="true">{index + 1}</span>
        <div><div className="nd-guide-step-title"><h2>{item.label}</h2><small>{item.status === "complete" ? "已完成" : item.status === "pending" ? "待完成" : "未读取"}</small></div><p>{item.detail}</p></div>
        <a href={item.href}>{item.status === "complete" ? "查看" : item.action}</a>
      </li>)}
    </ol>
    <p className="nd-guide-note">完成状态只来自模型配置、开书草稿、正式书籍、采用计划和采用正文；普通说明文字不会被推断为完成。</p>
  </main>;
}
