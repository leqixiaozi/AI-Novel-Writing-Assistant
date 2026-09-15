import { useEffect, useState } from "react";
import type { CardTypeSummary } from "../common/contracts";
import { newDesignApi } from "./api";
import CardWorkspace from "./CardWorkspace";
import TypeDesigner from "./TypeDesigner";
import "./new-design.css";

type WorkspaceView = "types" | "cards";

export default function NewDesignPage() {
  const [view, setView] = useState<WorkspaceView>("types");
  const [cardTypes, setCardTypes] = useState<CardTypeSummary[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [creatingType, setCreatingType] = useState(false);
  const [typeQuery, setTypeQuery] = useState("");
  const [database, setDatabase] = useState<{ mode: "bundled" | "external"; postgresVersion: string; port: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState("");

  const load = async () => {
    setLoading(true);
    setFatalError("");
    try {
      const [health, types] = await Promise.all([newDesignApi.health(), newDesignApi.listCardTypes()]);
      setDatabase(health);
      setCardTypes(types);
      if (!selectedTypeId && types[0]) setSelectedTypeId(types[0].id);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "新设计服务启动失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const selected = creatingType ? null : cardTypes.find((item) => item.id === selectedTypeId) ?? null;
  const filteredCardTypes = cardTypes.filter((item) => {
    const query = typeQuery.trim().toLocaleLowerCase("zh-CN");
    return !query || `${item.name} ${item.description} ${item.key}`.toLocaleLowerCase("zh-CN").includes(query);
  });
  const builtInCount = cardTypes.filter((item) => item.isSystem).length;
  const saveType = (saved: CardTypeSummary) => {
    setCardTypes((current) => {
      const found = current.some((item) => item.id === saved.id);
      return found ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current];
    });
    setSelectedTypeId(saved.id);
    setCreatingType(false);
  };

  if (loading) {
    return (
      <div className="nd-shell nd-loading-screen">
        <div className="nd-loader" aria-hidden="true" />
        <strong>正在准备新设计工作台</strong>
        <span>首次启动会初始化应用自带的 PostgreSQL，通常需要十几秒。</span>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="nd-shell nd-fatal">
        <p className="nd-kicker">启动检查</p>
        <h1>新设计数据库未就绪</h1>
        <p>{fatalError}</p>
        <button className="nd-button nd-button-primary" type="button" onClick={() => void load()}>重新检查</button>
      </div>
    );
  }

  return (
    <div className="nd-shell">
      <header className="nd-page-header">
        <div>
          <p className="nd-eyebrow">新系统底座 · 卡片设计中心</p>
          <h1>新设计</h1>
          <p>使用开箱即用的小说卡片，也可以扩展自己的字段和表单。</p>
          <div className="nd-header-facts" aria-label="卡片底座概览">
            <span>{builtInCount} 个内置类型</span>
            <span>{cardTypes.length - builtInCount} 个自定义类型</span>
          </div>
        </div>
        <div className="nd-db-status" title={`PostgreSQL ${database?.postgresVersion ?? ""}`}>
          <i aria-hidden="true" />
          <span>PostgreSQL {database?.mode === "bundled" ? "应用内运行" : "已连接"}</span>
          <small>端口 {database?.port}</small>
        </div>
      </header>

      <nav className="nd-view-tabs" aria-label="新设计工作区">
        <button className={view === "types" ? "is-active" : ""} type="button" onClick={() => setView("types")}><span>01</span>元卡片类型</button>
        <button className={view === "cards" ? "is-active" : ""} type="button" onClick={() => setView("cards")}><span>02</span>卡片库</button>
      </nav>

      {view === "types" ? (
        <div className="nd-types-workspace">
          <aside className="nd-type-list-pane">
            <div className="nd-list-heading">
              <div><p className="nd-kicker">结构目录</p><strong>{cardTypes.length} 种卡片</strong></div>
              <button type="button" title="新建元卡片类型" onClick={() => { setCreatingType(true); setSelectedTypeId(null); }}>＋</button>
            </div>
            <label className="nd-type-search">
              <span className="nd-visually-hidden">搜索卡片类型</span>
              <input value={typeQuery} placeholder="搜索卡片类型" onChange={(event) => setTypeQuery(event.target.value)} />
            </label>
            <div className="nd-type-list">
              {cardTypes.length === 0 ? (
                <button className="nd-empty-list-action" type="button" onClick={() => setCreatingType(true)}>创建第一个元卡片类型</button>
              ) : filteredCardTypes.length === 0 ? (
                <div className="nd-empty nd-empty-compact">没有匹配的卡片类型</div>
              ) : filteredCardTypes.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={!creatingType && selectedTypeId === item.id ? "is-selected" : ""}
                  onClick={() => { setCreatingType(false); setSelectedTypeId(item.id); }}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.isSystem ? "内置" : "自定义"} · {item.currentVersion ? `已发布 v${item.currentVersion}` : "草稿"}</small>
                  </div>
                  <b>›</b>
                </button>
              ))}
            </div>
          </aside>
          <TypeDesigner selected={selected} onSaved={saveType} />
        </div>
      ) : <CardWorkspace cardTypes={cardTypes} />}
    </div>
  );
}
