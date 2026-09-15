import { useEffect, useMemo, useState } from "react";
import type { CardSummary, CardTypeSummary, CardTypeVersion, CardVersion } from "../common/contracts";
import { ApiError, newDesignApi } from "./api";
import DynamicForm from "./DynamicForm";

interface CardWorkspaceProps {
  cardTypes: CardTypeSummary[];
}

function sourceLabel(source: CardVersion["source"]): string {
  return { create: "创建", edit: "编辑", archive: "归档", restore: "恢复" }[source];
}

export default function CardWorkspace({ cardTypes }: CardWorkspaceProps) {
  const publishedTypes = cardTypes.filter((item) => item.status === "published" && item.currentVersionId);
  const [cardTypeId, setCardTypeId] = useState("");
  const [typeVersions, setTypeVersions] = useState<CardTypeVersion[]>([]);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<CardSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<CardVersion[] | null>(null);

  useEffect(() => {
    if (!cardTypeId && publishedTypes[0]) setCardTypeId(publishedTypes[0].id);
  }, [cardTypeId, publishedTypes]);

  const selectedType = publishedTypes.find((item) => item.id === cardTypeId) ?? null;
  const fields = typeVersions[0]?.fields ?? [];

  const reloadCards = async () => {
    if (!cardTypeId) { setCards([]); return; }
    setCards(await newDesignApi.listCards(cardTypeId, archived));
  };

  useEffect(() => {
    setEditing(null);
    setCreating(false);
    setMessage("");
    if (!cardTypeId) { setTypeVersions([]); setCards([]); return; }
    void Promise.all([newDesignApi.listCardTypeVersions(cardTypeId), newDesignApi.listCards(cardTypeId, archived)])
      .then(([versions, nextCards]) => {
        setTypeVersions(versions);
        setCards(nextCards);
        const firstCard = nextCards[0];
        if (firstCard) {
          setEditing(firstCard);
          setTitle(firstCard.title);
          setValues(firstCard.values);
          setIssues({});
        }
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "卡片加载失败。"));
  }, [cardTypeId, archived]);

  const beginCreate = () => {
    setCreating(true); setEditing(null); setTitle(""); setValues({}); setIssues({}); setMessage("");
  };
  const beginEdit = (card: CardSummary) => {
    setCreating(false); setEditing(card); setTitle(card.title); setValues(card.values); setIssues({}); setMessage("");
  };
  const save = async () => {
    if (!selectedType) return;
    setBusy(true); setIssues({}); setMessage("");
    try {
      const saved = editing
        ? await newDesignApi.updateCard({ ...editing, title, values })
        : await newDesignApi.createCard({ cardTypeId: selectedType.id, title, values });
      setEditing(saved); setCreating(false); setTitle(saved.title); setValues(saved.values);
      await reloadCards();
      setMessage(`“${saved.title}”已保存为修订 ${saved.revision}。`);
    } catch (error) {
      if (error instanceof ApiError) { setIssues(error.issues); setMessage(error.message); }
      else setMessage("卡片保存失败。");
    } finally { setBusy(false); }
  };
  const changeArchiveState = async (card: CardSummary) => {
    setBusy(true); setMessage("");
    try {
      if (card.status === "archived") await newDesignApi.restoreCard(card.id, card.revision);
      else await newDesignApi.archiveCard(card.id, card.revision);
      if (editing?.id === card.id) setEditing(null);
      await reloadCards();
      setMessage(card.status === "archived" ? "卡片已恢复。" : "卡片已归档，内容和版本仍然保留。 ");
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败。"); }
    finally { setBusy(false); }
  };
  const showHistory = async (card: CardSummary) => {
    setBusy(true);
    try { setHistory(await newDesignApi.listCardVersions(card.id)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "版本历史加载失败。"); }
    finally { setBusy(false); }
  };

  const editorVisible = creating || editing;
  const cardCountLabel = useMemo(() => `${cards.length} 张${archived ? "已归档" : "使用中"}卡片`, [cards.length, archived]);

  if (publishedTypes.length === 0) {
    return <div className="nd-empty nd-empty-page"><strong>先发布一个元卡片类型</strong><span>发布后，卡片库会按它的字段自动生成创建表单。</span></div>;
  }

  return (
    <div className="nd-card-workspace">
      <section className="nd-card-list-pane">
        <div className="nd-section-heading">
          <div><p className="nd-kicker">卡片库</p><h1>{selectedType?.name ?? "选择类型"}</h1></div>
          <button className="nd-button nd-button-primary" type="button" onClick={beginCreate}>＋ 新建卡片</button>
        </div>
        <div className="nd-card-toolbar">
          <label className="nd-control">
            <span>元卡片类型</span>
            <select value={cardTypeId} onChange={(event) => setCardTypeId(event.target.value)}>
              {publishedTypes.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.currentVersion}</option>)}
            </select>
          </label>
          <div className="nd-segmented" aria-label="卡片状态">
            <button className={!archived ? "is-active" : ""} type="button" onClick={() => setArchived(false)}>使用中</button>
            <button className={archived ? "is-active" : ""} type="button" onClick={() => setArchived(true)}>已归档</button>
          </div>
        </div>
        <p className="nd-count">{cardCountLabel}</p>
        <div className="nd-card-list">
          {cards.length === 0 ? (
            <div className="nd-empty nd-empty-compact">这里还没有卡片。</div>
          ) : cards.map((card) => (
            <article className={`nd-card-list-item${editing?.id === card.id ? " is-selected" : ""}`} key={card.id}>
              <button className="nd-card-open" type="button" onClick={() => beginEdit(card)}>
                <strong>{card.title}</strong>
                <span>修订 {card.revision} · 类型 v{card.typeVersion}</span>
              </button>
              <div className="nd-row-actions">
                <button type="button" onClick={() => void showHistory(card)}>版本</button>
                <button type="button" disabled={busy} onClick={() => void changeArchiveState(card)}>{card.status === "archived" ? "恢复" : "归档"}</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="nd-card-editor-pane">
        {!editorVisible ? (
          <div className="nd-empty nd-empty-page"><strong>选择一张卡片继续编辑</strong><span>也可以新建一张{selectedType?.name}卡片。</span></div>
        ) : (
          <>
            <div className="nd-section-heading">
              <div><p className="nd-kicker">{editing ? `修订 ${editing.revision}` : "新卡片"}</p><h2>{editing ? editing.title : `新建${selectedType?.name ?? "卡片"}`}</h2></div>
              {editing && <button className="nd-text-button" type="button" onClick={() => void showHistory(editing)}>查看版本</button>}
            </div>
            <label className={`nd-control${issues.title ? " has-error" : ""}`}>
              <span>卡片标题 <b>*</b></span>
              <input value={title} placeholder={`输入${selectedType?.name ?? "卡片"}标题`} onChange={(event) => setTitle(event.target.value)} />
              {issues.title && <em>{issues.title}</em>}
            </label>
            <DynamicForm fields={fields} values={values} issues={issues} onChange={setValues} />
            {message && <p className={`nd-message${Object.keys(issues).length ? " is-error" : " is-success"}`}>{message}</p>}
            <div className="nd-editor-actions">
              <button className="nd-button nd-button-secondary" type="button" onClick={() => { setEditing(null); setCreating(false); }}>取消</button>
              <button className="nd-button nd-button-primary" type="button" disabled={busy || !title.trim()} onClick={() => void save()}>{busy ? "保存中…" : "保存卡片"}</button>
            </div>
          </>
        )}
      </section>

      {history && (
        <div className="nd-dialog-backdrop" role="presentation" onMouseDown={() => setHistory(null)}>
          <section className="nd-history-dialog" role="dialog" aria-modal="true" aria-labelledby="nd-history-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="nd-section-heading"><div><p className="nd-kicker">只读快照</p><h2 id="nd-history-title">版本历史</h2></div><button className="nd-dialog-close" type="button" onClick={() => setHistory(null)}>×</button></div>
            <div className="nd-history-list">
              {history.map((version) => (
                <article key={version.id}>
                  <div><strong>修订 {version.revision}</strong><span>{sourceLabel(version.source)} · 类型 v{version.typeVersion}</span></div>
                  <time>{new Date(version.createdAt).toLocaleString("zh-CN")}</time>
                  <h3>{version.title}</h3>
                  <dl>{Object.entries(version.values).map(([key, value]) => <div key={key}><dt>{fields.find((field) => field.key === key)?.name ?? key}</dt><dd>{Array.isArray(value) ? value.join("、") : String(value)}</dd></div>)}</dl>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
