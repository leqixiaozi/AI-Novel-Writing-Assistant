import { useEffect, useRef, useState } from "react";
import type { HomeModelStatus, HomeSnapshot } from "../../common/home";
import { homeTotals, selectHomeBook } from "../../common/home/presentation";
import { newDesignApi } from "../api";
import { HomeHero, HomeFirstBook, HomeModelNotice } from "./panels";
import "./home.css";

export default function HomePage() {
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null);
  const [models, setModels] = useState<HomeModelStatus | null>(null);
  const [failure, setFailure] = useState("");
  const [modelFailure, setModelFailure] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setLoading(true); setFailure(""); setModelFailure(false);
    void Promise.allSettled([newDesignApi.getHomeSnapshot(), newDesignApi.getHomeModels()]).then(([home, model]) => {
      if (request !== generation.current) return;
      if (home.status === "fulfilled") setSnapshot(home.value);
      else setFailure("创作进展暂未完整读取。已有作品与草稿保留，请重新读取。");
      if (model.status === "fulfilled") setModels(model.value);
      else setModelFailure(true);
      setLoading(false);
    });
    return () => { generation.current++; };
  }, [refresh]);
  const book = snapshot ? selectHomeBook(snapshot.books) : null;
  const totals = snapshot ? homeTotals(snapshot) : null;
  const retry = () => setRefresh(value => value + 1);
  return <main className="nd-shell nd-home" aria-busy={loading}>
    <header className="nd-home-heading"><div><p className="nd-kicker">你的创作工作台</p><h1>创作首页</h1></div><nav aria-label="首页常用操作"><a href="/new-design/books">我的书籍</a><a href="/new-design/books/new">＋ 开始新故事</a><a href="/new-design/books/new?method=idea&mode=automatic&form=short_story">创作短篇</a><button type="button" onClick={retry} disabled={loading}>{loading ? "读取中…" : "刷新进展"}</button></nav></header>
    <HomeModelNotice models={models} failed={modelFailure} loading={loading} retry={retry} />
    {failure && <section className="nd-home-alert" role="alert"><div><strong>暂时无法更新创作现场</strong><p>{failure}{snapshot ? "下方保留的是上次读取结果。" : ""}</p></div><button className="nd-button" onClick={retry} disabled={loading}>重新读取</button></section>}
    {!snapshot && loading ? <section className="nd-home-loading" role="status"><span className="nd-loader" /><h2>正在整理你的创作现场</h2><p>读取作品、采用正文和创作进展。</p></section> : snapshot ? <>
      <HomeFirstBook snapshot={snapshot} models={modelFailure ? null : models} />
      <HomeHero book={book} draft={snapshot.creationDraft} />
    </> : <section className="nd-home-unavailable"><p>读取创作进展后，这里会显示作品与下一步。</p><a className="nd-button" href="/new-design/books">打开我的书籍</a></section>}
      <section className="nd-home-status" aria-label="全部作品创作状态">{[
        { label: "正在创作", value: totals?.running, unit: "部", detail: "有运行或排队任务的作品", href: "/new-design/operations/director" },
        { label: "等待你确认", value: totals?.attention, unit: "部", detail: "有待确认结果、变化或暂停的作品", href: "/new-design/operations/director" },
        { label: "可进入正文准备", value: totals?.ready, unit: "部", detail: "有符合结构要求的采用章节计划", href: "/new-design/books" },
        { label: "已采用章节", value: totals?.chapters, unit: "章", detail: "明确采用且有正文内容的章节", href: "/new-design/books" },
      ].map(item => <a href={item.href} className="nd-home-stat" key={item.label}><span>{item.label}</span><strong>{item.value === undefined ? "—" : item.value.toLocaleString("zh-CN")}<small>{item.unit}</small></strong><p>{item.value === undefined ? loading ? "正在读取统计…" : "统计暂不可用，请重新读取" : item.detail}</p></a>)}</section>
      {snapshot ? <p className="nd-home-scope">统计全部 {totals!.books} 部未归档作品；同一作品在每项中只计一次。开书草稿单独显示。<time dateTime={snapshot.readAt}>更新于 {new Date(snapshot.readAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></p> : <p className="nd-home-scope" role="status">{loading ? "正在读取全部作品统计。" : "尚未取得完整统计；横线表示未读取，不代表数量为零。"}</p>}
      <section className="nd-home-assets" aria-labelledby="home-assets-title"><div className="nd-home-section-heading"><div><p className="nd-kicker">故事的积累</p><h2 id="home-assets-title">创作资产概览</h2></div><a href="/new-design/resources">管理创作资源 →</a></div><div className="nd-home-asset-rows">
        <Asset label="世界观覆盖" value={totals ? `${totals.worldBooks} / ${totals.books}` : "—"} detail={totals ? "已有正式世界设定的作品" : loading ? "正在读取统计…" : "统计暂不可用，请重新读取"} symbol="◎" />
        <Asset label="人物资产" value={totals ? `${totals.characters} 位` : "—"} detail={totals ? "各书中正在使用的正式人物" : loading ? "正在读取统计…" : "统计暂不可用，请重新读取"} symbol="♧" />
        <Asset label="章节沉淀" value={totals ? `${totals.chapters} 章` : "—"} detail={totals ? `正文已采用，其中 ${totals.stable} 章完成当前版本稳定结算` : loading ? "正在读取统计…" : "统计暂不可用，请重新读取"} symbol="▤" />
        <Asset label="必填资料填写" value={totals ? totals.required ? `${totals.filled} / ${totals.required}` : "暂无可统计项" : "—"} detail={totals ? "已有资料中已填的必填项；不表示全部写作准备度" : loading ? "正在读取统计…" : "统计暂不可用，请重新读取"} symbol="✓" />
      </div></section>
  </main>;
}
function Asset({ label, value, detail, symbol }: { label: string; value: string; detail: string; symbol: string }) {
  return <a className="nd-home-asset" href="/new-design/books"><span className="nd-home-asset-symbol" aria-hidden="true">{symbol}</span><div><strong>{label}</strong><p>{detail}</p></div><span className="nd-home-asset-value">{value}</span></a>;
}
