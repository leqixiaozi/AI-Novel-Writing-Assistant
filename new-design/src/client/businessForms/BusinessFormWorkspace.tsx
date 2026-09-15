import { useEffect, useMemo, useState } from "react";
import type {
  BookSummary,
  BookViewWorkspace,
  CardGroupFormSummary,
  CardGroupFormVersion,
  CardSummary,
  CardTypeSummary,
  CardTypeVersion,
  CardVersion,
  FieldDefinition,
} from "../../common/contracts";
import { ApiError, newDesignApi } from "../api";
import DynamicForm from "../DynamicForm";
import {
  SCOPE_COPY,
  cardsForType,
  defaultValues,
  resolveBusinessForm,
  typesForScope,
  type BusinessFormScope,
} from "./model";
import "./business-form.css";

interface Props {
  book: BookSummary;
  cardTypes: CardTypeSummary[];
  scope: BusinessFormScope;
}

interface ConflictState {
  localTitle: string;
  localValues: Record<string, unknown>;
  latest: CardSummary | null;
}

function historySource(source: CardVersion["source"]): string {
  return { create: "首次创建", edit: "作者修改", archive: "归档", restore: "恢复使用" }[source];
}

function displayValue(value: unknown, field?: FieldDefinition): string {
  if (value === null || value === undefined || value === "") return "未填写";
  if (Array.isArray(value)) return value.map((item) => field?.options.find((option) => option.value === item)?.label ?? String(item)).join("、") || "未填写";
  if (typeof value === "boolean") return value ? "是" : "否";
  return field?.options.find((option) => option.value === value)?.label ?? String(value);
}

function changedKeys(local: Record<string, unknown>, latest: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(local), ...Object.keys(latest)])].filter((key) => JSON.stringify(local[key]) !== JSON.stringify(latest[key]));
}

export default function BusinessFormWorkspace({ book, cardTypes, scope }: Props) {
  const availableTypes = useMemo(() => typesForScope(cardTypes, scope), [cardTypes, scope]);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [workspace, setWorkspace] = useState<BookViewWorkspace | null>(null);
  const [forms, setForms] = useState<CardGroupFormSummary[]>([]);
  const [formVersions, setFormVersions] = useState<Map<string, CardGroupFormVersion[]>>(new Map());
  const [typeVersions, setTypeVersions] = useState<CardTypeVersion[]>([]);
  const [editing, setEditing] = useState<CardSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<CardVersion[] | null>(null);
  const [historyTitle, setHistoryTitle] = useState("");
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  const selectedType = availableTypes.find((type) => type.id === selectedTypeId) ?? availableTypes[0] ?? null;
  const currentTypeVersion = typeVersions.find((version) => version.id === selectedType?.currentVersionId) ?? typeVersions[0] ?? null;
  const resolution = selectedType && currentTypeVersion
    ? resolveBusinessForm(selectedType, currentTypeVersion.fields, forms, formVersions)
    : null;
  const cards = selectedType && workspace ? cardsForType(workspace.cards, selectedType) : [];
  const copy = SCOPE_COPY[scope];

  const loadWorkspace = async () => {
    const [nextWorkspace, nextForms] = await Promise.all([
      newDesignApi.getBookViewWorkspace(book.id),
      newDesignApi.listCardGroupForms(book.spaceId),
    ]);
    const versionPairs = await Promise.all(nextForms.filter((form) => form.status === "published" && form.currentVersionId).map(async (form) => [form.id, await newDesignApi.listCardGroupFormVersions(form.id)] as const));
    setWorkspace(nextWorkspace);
    setForms(nextForms);
    setFormVersions(new Map(versionPairs));
  };

  useEffect(() => {
    setWorkspace(null);
    setError("");
    setNotice("");
    void loadWorkspace().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "本书资料暂时无法读取。"));
  }, [book.id, book.spaceId]);

  useEffect(() => {
    const nextTypeId = availableTypes.some((type) => type.id === selectedTypeId) ? selectedTypeId : availableTypes[0]?.id ?? "";
    if (nextTypeId !== selectedTypeId) setSelectedTypeId(nextTypeId);
  }, [availableTypes, selectedTypeId]);

  useEffect(() => {
    setTypeVersions([]);
    setEditing(null);
    setCreating(false);
    setConflict(null);
    setIssues({});
    setError("");
    setNotice("");
    if (!selectedType) return;
    void newDesignApi.listCardTypeVersions(selectedType.id)
      .then(setTypeVersions)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "内容规格暂时无法读取。"));
  }, [selectedType?.id]);

  useEffect(() => {
    if (creating || editing || !resolution) return;
    const first = cards[0];
    if (first) {
      setEditing(first);
      setTitle(first.title);
      setValues(first.values);
    }
  }, [cards, creating, editing, resolution]);

  const selectType = (typeId: string) => {
    setSelectedTypeId(typeId);
    setEditing(null);
    setCreating(false);
  };

  const selectCard = (card: CardSummary) => {
    setEditing(card);
    setCreating(false);
    setTitle(card.title);
    setValues(card.values);
    setIssues({});
    setError("");
    setNotice("");
    setConflict(null);
  };

  const beginCreate = () => {
    if (!resolution) return;
    setEditing(null);
    setCreating(true);
    setTitle("");
    setValues(defaultValues(resolution.fields));
    setIssues({});
    setError("");
    setNotice("");
    setConflict(null);
  };

  const save = async () => {
    if (!selectedType || !resolution) return;
    setBusy(true);
    setIssues({});
    setError("");
    setNotice("");
    setConflict(null);
    try {
      const resolvedFormVersionId = resolution.formId
        ? forms.find((form) => form.id === resolution.formId)?.currentVersionId ?? null
        : null;
      const saved = editing
        ? await newDesignApi.updateCard({ ...editing, title, values, formVersionId:resolvedFormVersionId, formResolutionKind:resolution.source })
        : await newDesignApi.createCard({ cardTypeId: selectedType.id, title, values, spaceId: book.spaceId, formVersionId:resolvedFormVersionId, formResolutionKind:resolution.source });
      await loadWorkspace();
      setEditing(saved);
      setCreating(false);
      setTitle(saved.title);
      setValues(saved.values);
      setNotice(`已保存，当前为修订 ${saved.revision}。`);
    } catch (saveError) {
      if (saveError instanceof ApiError) {
        setIssues(saveError.issues);
        setError(saveError.message);
        if (saveError.status === 409 && editing) setConflict({ localTitle: title, localValues: values, latest: null });
      } else setError("保存失败，请稍后重试。当前填写内容仍保留在页面中。");
    } finally {
      setBusy(false);
    }
  };

  const compareLatest = async () => {
    if (!editing || !conflict) return;
    setBusy(true);
    try {
      const latest = await newDesignApi.getCard(editing.id);
      setConflict({ ...conflict, latest });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "最新修订暂时无法读取。");
    } finally {
      setBusy(false);
    }
  };

  const useLatest = () => {
    if (!conflict?.latest) return;
    setEditing(conflict.latest);
    setTitle(conflict.latest.title);
    setValues(conflict.latest.values);
    setConflict(null);
    setError("");
    setNotice(`已载入服务器上的修订 ${conflict.latest.revision}，请确认后再保存。`);
  };

  const keepLocalOnLatestRevision = () => {
    if (!conflict?.latest) return;
    setEditing(conflict.latest);
    setTitle(conflict.localTitle);
    setValues(conflict.localValues);
    setConflict(null);
    setError("");
    setNotice(`已保留你的填写，并以服务器修订 ${conflict.latest.revision} 作为新基线。再次保存前请确认差异。`);
  };

  const openHistory = async (card: CardSummary) => {
    setBusy(true);
    setError("");
    try {
      setHistory(await newDesignApi.listCardVersions(card.id));
      setHistoryTitle(card.title);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "修改记录暂时无法读取。");
    } finally {
      setBusy(false);
    }
  };

  const relatedItems = useMemo(() => {
    if (!editing || !workspace) return [];
    const cardName = (id: string) => workspace.cards.find((card) => card.id === id)?.title ?? "已移除资料";
    const result: Array<{ label: string; value: string }> = [];
    workspace.characterRelations.filter((item) => item.sourceCardId === editing.id || item.targetCardId === editing.id).forEach((item) => {
      const outgoing = item.sourceCardId === editing.id;
      result.push({ label: outgoing ? item.sourceLabel || "人物关系" : item.inverseLabel || "人物关系", value: cardName(outgoing ? item.targetCardId : item.sourceCardId) });
    });
    workspace.storyTimePositions.filter((item) => item.cardId === editing.id).forEach((item) => result.push({ label: "故事时间", value: [item.startLabel, item.endLabel].filter(Boolean).join(" — ") || "已设置顺序" }));
    workspace.narrativePlacements.filter((item) => item.subjectCardId === editing.id).forEach((item) => result.push({ label: "叙事位置", value: cardName(item.chapterCardId) }));
    workspace.textAnchors.filter((item) => item.subjectCardId === editing.id).forEach((item) => result.push({ label: "正文锚点", value: `${cardName(item.chapterCardId)}${item.anchorLabel ? ` · ${item.anchorLabel}` : ""}` }));
    return result;
  }, [editing, workspace]);

  if (!workspace && !error) return <div className="nd-loading-screen" aria-live="polite"><div className="nd-loader"/><strong>正在整理{copy.title}</strong><span>正在读取本书资料和已发布的填写规格。</span></div>;
  if (!workspace) return <div className="nd-fatal"><h2>暂时无法打开填写页面</h2><p>{error}</p><button className="nd-button nd-button-primary" type="button" onClick={() => { setError(""); void loadWorkspace().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "本书资料暂时无法读取。")); }}>重新读取</button></div>;
  if (availableTypes.length === 0) return <div className="nd-empty nd-empty-page"><strong>这个栏目还没有可填写的内容</strong><span>本书需要先安装并发布对应的内容规格。</span></div>;

  return <div className="nd-business-form-workspace">
    <header className="nd-business-form-header">
      <div><p className="nd-kicker">{copy.eyebrow}</p><h2>{copy.title}</h2><p>{copy.description}</p></div>
      <button className="nd-button nd-button-primary" type="button" disabled={!resolution} onClick={beginCreate}>＋ 新建{selectedType?.name ?? "资料"}</button>
    </header>

    <div className="nd-business-form-layout">
      <aside className="nd-business-form-browser" aria-label={`${copy.title}内容类型与资料`}>
        <div className="nd-business-type-list">
          {availableTypes.map((type) => <button className={type.id === selectedType?.id ? "is-selected" : ""} type="button" key={type.id} onClick={() => selectType(type.id)}><strong>{type.name}</strong><small>{workspace.cards.filter((card) => card.cardTypeId === type.id && card.status === "active").length} 条资料</small></button>)}
        </div>
        <div className="nd-business-card-list">
          <div><strong>{selectedType?.name}</strong><span>{cards.length} 条</span></div>
          {cards.length === 0 ? <p>还没有内容，可以从空白表单开始填写。</p> : cards.map((card) => <button className={editing?.id === card.id ? "is-selected" : ""} type="button" key={card.id} onClick={() => selectCard(card)}><strong>{card.title}</strong><small>修订 {card.revision} · 内容规格 v{card.typeVersion}</small></button>)}
        </div>
      </aside>

      <section className="nd-business-form-editor" aria-label={`${selectedType?.name ?? "资料"}填写表单`}>
        {!resolution ? <div className="nd-empty nd-empty-page"><strong>没有可用的已发布填写规格</strong><span>发布内容规格后即可在这里填写，不会生成另一份配置。</span></div> : !creating && !editing ? <div className="nd-empty nd-empty-page"><strong>选择一条资料，或新建内容</strong><span>空白填写、模板生成和 AI 提案进入本书后，都使用同一套编辑页面。</span></div> : <>
          <div className="nd-business-editor-heading">
            <div><p className="nd-kicker">{creating ? "新建内容" : `修订 ${editing?.revision}`}</p><h2>{resolution.title}</h2><p>{selectedType?.description}</p></div>
            <div className="nd-form-provenance" aria-label="当前填写规格"><span>{resolution.sourceLabel}</span><small>内容规格 v{resolution.typeVersion}</small>{editing && <button className="nd-text-button" type="button" onClick={() => void openHistory(editing)}>查看修改记录</button>}</div>
          </div>
          <label className={`nd-control${issues.title ? " has-error" : ""}`}>
            <span>资料标题 <b aria-label="必填">*</b></span>
            <small>用于列表、搜索和关联引用，不会替代正文中的正式名称。</small>
            <input value={title} placeholder={`输入${selectedType?.name ?? "资料"}标题`} aria-invalid={Boolean(issues.title)} onChange={(event) => setTitle(event.target.value)} />
            {issues.title && <em>{issues.title}</em>}
          </label>
          <DynamicForm fields={resolution.fields} values={values} issues={issues} onChange={setValues}/>

          <section className="nd-readonly-relations" aria-labelledby="nd-relation-summary-title">
            <div><h3 id="nd-relation-summary-title">关联资料</h3><span>只读</span></div>
            {relatedItems.length ? <dl>{relatedItems.map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : <p>暂未找到已建立的关联。关联编辑将在后续功能中提供。</p>}
          </section>

          {conflict && <section className="nd-revision-conflict" role="alert"><strong>检测到新的服务器修订</strong><p>你的未保存内容仍保留。先读取并比较最新修订，再决定采用哪一份。</p><button className="nd-button nd-button-secondary" type="button" disabled={busy} onClick={() => void compareLatest()}>{conflict.latest ? "重新比较" : "读取最新修订并比较"}</button>{conflict.latest && <div className="nd-conflict-comparison"><div><strong>你的填写</strong><span>{conflict.localTitle}</span></div><div><strong>服务器修订 {conflict.latest.revision}</strong><span>{conflict.latest.title}</span></div>{changedKeys(conflict.localValues, conflict.latest.values).map((key) => <article key={key}><strong>{resolution.fields.find((field) => field.key === key)?.name ?? key}</strong><p>{displayValue(conflict.localValues[key], resolution.fields.find((field) => field.key === key))}</p><p>{displayValue(conflict.latest?.values[key], resolution.fields.find((field) => field.key === key))}</p></article>)}<div className="nd-conflict-actions"><button className="nd-button nd-button-secondary" type="button" onClick={keepLocalOnLatestRevision}>保留我的填写</button><button className="nd-button nd-button-secondary" type="button" onClick={useLatest}>采用服务器最新内容</button></div></div>}</section>}
          <div aria-live="polite">{error && <p className="nd-message is-error">{error}</p>}{notice && <p className="nd-message is-success">{notice}</p>}</div>
          <div className="nd-editor-actions"><button className="nd-button nd-button-secondary" type="button" disabled={busy} onClick={() => { setCreating(false); setEditing(null); setConflict(null); setError(""); setNotice(""); }}>取消</button><button className="nd-button nd-button-primary" type="button" disabled={busy || !title.trim() || Boolean(conflict)} onClick={() => void save()}>{busy ? "保存中…" : "保存资料"}</button></div>
        </>}
      </section>
    </div>

    {history && <div className="nd-dialog-backdrop" role="presentation" onMouseDown={() => setHistory(null)}><section className="nd-history-dialog" role="dialog" aria-modal="true" aria-labelledby="nd-business-history-title" onMouseDown={(event) => event.stopPropagation()}><div className="nd-section-heading"><div><p className="nd-kicker">只读修改记录</p><h2 id="nd-business-history-title">{historyTitle}</h2></div><button className="nd-dialog-close" type="button" aria-label="关闭修改记录" onClick={() => setHistory(null)}>×</button></div><div className="nd-history-list">{history.map((version) => <article key={version.id}><div><strong>修订 {version.revision}</strong><span>{historySource(version.source)} · 内容规格 v{version.typeVersion}{version.formVersion ? ` · 创作表单 v${version.formVersion}` : ""}</span></div><time>{new Date(version.createdAt).toLocaleString("zh-CN")}</time><h3>{version.title}</h3><dl>{Object.entries(version.values).map(([key, value]) => <div key={key}><dt>{resolution?.fields.find((field) => field.key === key)?.name ?? key}</dt><dd>{displayValue(value, resolution?.fields.find((field) => field.key === key))}</dd></div>)}</dl></article>)}</div></section></div>}
  </div>;
}
