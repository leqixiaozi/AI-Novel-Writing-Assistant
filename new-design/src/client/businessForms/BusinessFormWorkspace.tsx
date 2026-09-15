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
  ScopedFieldBundle,
  ScopedFieldDefinition,
  ScopedFieldVersion,
} from "../../common/contracts";
import { ApiError, newDesignApi } from "../api";
import DynamicForm from "../DynamicForm";
import AddInformationDialog from "./AddInformationDialog";
import AssociationPanel from "./AssociationPanel";
import MaterialManagementPanel from "./MaterialManagementPanel";
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

const TYPE_LABELS:Record<string,string>={short_text:"短文本",long_text:"长文本",number:"数字",boolean:"是／否",select:"单选",multi_select:"多选",date:"日期"};
function fieldSourceDetail(item:ScopedFieldDefinition){if(item.origin==="core")return "系统核心规格";if(item.origin==="template")return `随模板安装${item.sourceTemplateVersionId?` · 来源版本 ${item.sourceTemplateVersionId.slice(0,8)}`:""}`;if(item.origin==="book_extension")return `本书独立规格 · 字段版本 ${item.currentVersion.version}`;return `当前资料独立补充 · 字段版本 ${item.currentVersion.version}`;}

export default function BusinessFormWorkspace({ book, cardTypes, scope }: Props) {
  const [browserMode,setBrowserMode]=useState<"types"|"tags"|"groups"|"views">("types");
  const [liveCardTypes,setLiveCardTypes]=useState(cardTypes);
  const availableTypes = useMemo(() => typesForScope(liveCardTypes, scope), [liveCardTypes, scope]);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [workspace, setWorkspace] = useState<BookViewWorkspace | null>(null);
  const [forms, setForms] = useState<CardGroupFormSummary[]>([]);
  const [formVersions, setFormVersions] = useState<Map<string, CardGroupFormVersion[]>>(new Map());
  const [typeVersions, setTypeVersions] = useState<CardTypeVersion[]>([]);
  const [editing, setEditing] = useState<CardSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [localValues,setLocalValues]=useState<Record<string,unknown>>({});
  const [scopedFields,setScopedFields]=useState<ScopedFieldBundle>({definitions:[],values:{}});
  const [addingInformation,setAddingInformation]=useState(false);
  const [editingField,setEditingField]=useState<ScopedFieldDefinition|null>(null);
  const [fieldHistory,setFieldHistory]=useState<{definition:ScopedFieldDefinition;versions:ScopedFieldVersion[]}|null>(null);
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
  const localFieldKeys=new Set(scopedFields.definitions.filter((item)=>item.scope==="card"&&item.status==="active").map((item)=>item.fieldKey));
  const combinedFields=resolution?[...resolution.fields,...scopedFields.definitions.filter((item)=>item.scope==="card"&&item.status==="active"&&!resolution.fields.some((field)=>field.key===item.fieldKey)).map((item)=>item.currentVersion.field)]:[];
  const scopeLabelByKey=Object.fromEntries(scopedFields.definitions.map((item)=>[item.fieldKey,item.origin==="core"?"核心信息":item.origin==="template"?"模板信息":item.origin==="book_extension"?"本书新增":"仅此处补充"]));
  const cards = selectedType && workspace ? cardsForType(workspace.cards, selectedType) : [];
  const copy = SCOPE_COPY[scope];

  useEffect(()=>setLiveCardTypes(cardTypes),[cardTypes]);

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

  useEffect(()=>{
    setScopedFields({definitions:[],values:{}});setLocalValues({});
    if(!selectedType)return;
    void newDesignApi.listScopedFields(book.id,selectedType.id,editing?.id).then((bundle)=>{setScopedFields(bundle);setLocalValues(bundle.values);}).catch((loadError)=>setError(loadError instanceof Error?loadError.message:"信息来源暂时无法读取。"));
  },[book.id,selectedType?.id,editing?.id]);

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
    setLocalValues({});
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
    setLocalValues({});
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
        ? await newDesignApi.updateCard({ ...editing, title, values, localValues, formVersionId:resolvedFormVersionId, formResolutionKind:resolution.source })
        : await newDesignApi.createCard({ cardTypeId: selectedType.id, title, values, spaceId: book.spaceId, formVersionId:resolvedFormVersionId, formResolutionKind:resolution.source });
      await loadWorkspace();
      setEditing(saved);
      setCreating(false);
      setTitle(saved.title);
      setValues(saved.values);
      if(editing){const bundle=await newDesignApi.listScopedFields(book.id,selectedType.id,saved.id);setScopedFields(bundle);setLocalValues(bundle.values);}
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

  const refreshAfterFieldCreate=async()=>{
    if(!selectedType)return;
    const [nextTypes,nextWorkspace,nextVersions]=await Promise.all([newDesignApi.listCardTypes(book.spaceId),newDesignApi.getBookViewWorkspace(book.id),newDesignApi.listCardTypeVersions(selectedType.id)]);
    setLiveCardTypes(nextTypes);setWorkspace(nextWorkspace);setTypeVersions(nextVersions);
    if(editing){const latest=nextWorkspace.cards.find((card)=>card.id===editing.id)??editing;setEditing(latest);setTitle(latest.title);setValues(latest.values);const bundle=await newDesignApi.listScopedFields(book.id,selectedType.id,latest.id);setScopedFields(bundle);setLocalValues(bundle.values);}else{setScopedFields(await newDesignApi.listScopedFields(book.id,selectedType.id));}
    setNotice("信息已加入当前填写表单。");
  };

  const openFieldHistory=async(definition:ScopedFieldDefinition)=>{setBusy(true);try{setFieldHistory({definition,versions:await newDesignApi.listScopedFieldHistory(book.id,definition.id)});}catch(loadError){setError(loadError instanceof Error?loadError.message:"信息版本暂时无法读取。");}finally{setBusy(false);}};
  const archiveField=async(definition:ScopedFieldDefinition)=>{if(!selectedType)return;setBusy(true);setError("");try{await newDesignApi.archiveScopedField(book.id,definition.id,{expectedRevision:definition.revision,expectedTypeRevision:definition.scope==="book_type"?selectedType.revision:undefined,idempotencyKey:crypto.randomUUID()});await refreshAfterFieldCreate();setNotice(`“${definition.currentVersion.field.name}”已从填写表单隐藏，历史资料仍保留。`);}catch(archiveError){setError(archiveError instanceof Error?archiveError.message:"暂时无法隐藏这项信息。");}finally{setBusy(false);}};

  if (!workspace && !error) return <div className="nd-loading-screen" aria-live="polite"><div className="nd-loader"/><strong>正在整理{copy.title}</strong><span>正在读取本书资料和已发布的填写规格。</span></div>;
  if (!workspace) return <div className="nd-fatal"><h2>暂时无法打开填写页面</h2><p>{error}</p><button className="nd-button nd-button-primary" type="button" onClick={() => { setError(""); void loadWorkspace().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "本书资料暂时无法读取。")); }}>重新读取</button></div>;
  if (availableTypes.length === 0) return <div className="nd-empty nd-empty-page"><strong>这个栏目还没有可填写的内容</strong><span>本书需要先安装并发布对应的内容规格。</span></div>;

  return <div className="nd-business-form-workspace">
    <header className="nd-business-form-header">
      <div><p className="nd-kicker">{copy.eyebrow}</p><h2>{copy.title}</h2><p>{copy.description}</p></div>
      <button className="nd-button nd-button-primary" type="button" disabled={!resolution} onClick={beginCreate}>＋ 新建{selectedType?.name ?? "资料"}</button>
    </header>

    {scope==="all"&&<nav className="nd-material-mode-tabs" aria-label="本书资料查看方式">{([['types','内容类型'],['tags','标签'],['groups','分组目录'],['views','智能视图']] as const).map(([key,label])=><button className={browserMode===key?"is-selected":""} type="button" key={key} aria-pressed={browserMode===key} onClick={()=>setBrowserMode(key)}>{label}</button>)}</nav>}

    {scope==="all"&&browserMode!=="types"?<MaterialManagementPanel scope={{bookId:book.id}} mode={browserMode} cards={workspace.cards} onOpenCard={(card)=>{selectType(card.cardTypeId);selectCard(card);setBrowserMode("types");}}/>:<div className="nd-business-form-layout">
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
            <div className="nd-form-provenance" aria-label="当前填写规格"><span>{resolution.sourceLabel}</span><small>内容规格 v{resolution.typeVersion}</small><button className="nd-text-button" type="button" onClick={()=>setAddingInformation(true)}>＋ 添加信息</button>{editing && <button className="nd-text-button" type="button" onClick={() => void openHistory(editing)}>查看修改记录</button>}</div>
          </div>
          <label className={`nd-control${issues.title ? " has-error" : ""}`}>
            <span>资料标题 <b aria-label="必填">*</b></span>
            <small>用于列表、搜索和关联引用，不会替代正文中的正式名称。</small>
            <input value={title} placeholder={`输入${selectedType?.name ?? "资料"}标题`} aria-invalid={Boolean(issues.title)} onChange={(event) => setTitle(event.target.value)} />
            {issues.title && <em>{issues.title}</em>}
          </label>
          <DynamicForm fields={combinedFields} values={{...values,...localValues}} issues={issues} scopeLabelByKey={scopeLabelByKey} onChange={(next)=>{setValues(Object.fromEntries(Object.entries(next).filter(([key])=>!localFieldKeys.has(key))));setLocalValues(Object.fromEntries(Object.entries(next).filter(([key])=>localFieldKeys.has(key))));}}/>

          <details className="nd-field-source-list"><summary>查看信息来源与适用范围</summary><div>{scopedFields.definitions.filter((item)=>item.status==="active").map((item)=><article key={item.id}><span><strong>{item.currentVersion.field.name}</strong><small>{scopeLabelByKey[item.fieldKey]} · {item.scope==="book_type"?"本书所有同类资料":item.scope==="card"?"当前资料":"当前关联"} · {fieldSourceDetail(item)}</small></span><span className="nd-field-source-actions"><button className="nd-text-button" type="button" onClick={()=>void openFieldHistory(item)}>查看版本</button>{item.origin==="local_supplement"&&<button className="nd-text-button" type="button" onClick={()=>setEditingField(item)}>修改</button>}{item.origin!=="core"&&!(item.origin==="template"&&item.currentVersion.field.required)&&<button className="nd-text-button" type="button" disabled={busy} onClick={()=>void archiveField(item)}>隐藏</button>}</span></article>)}</div></details>

          {editing&&resolution.source==="installed_form"&&<AssociationPanel
            book={book}
            primary={editing}
            cardTypes={liveCardTypes}
            forms={forms}
            formVersions={formVersions}
            hasUnsavedChanges={title!==editing.title||JSON.stringify(values)!==JSON.stringify(editing.values)||JSON.stringify(localValues)!==JSON.stringify(scopedFields.values)}
            onSourcesChanged={loadWorkspace}
          />}

          {conflict && <section className="nd-revision-conflict" role="alert"><strong>检测到新的服务器修订</strong><p>你的未保存内容仍保留。先读取并比较最新修订，再决定采用哪一份。</p><button className="nd-button nd-button-secondary" type="button" disabled={busy} onClick={() => void compareLatest()}>{conflict.latest ? "重新比较" : "读取最新修订并比较"}</button>{conflict.latest && <div className="nd-conflict-comparison"><div><strong>你的填写</strong><span>{conflict.localTitle}</span></div><div><strong>服务器修订 {conflict.latest.revision}</strong><span>{conflict.latest.title}</span></div>{changedKeys(conflict.localValues, conflict.latest.values).map((key) => <article key={key}><strong>{resolution.fields.find((field) => field.key === key)?.name ?? key}</strong><p>{displayValue(conflict.localValues[key], resolution.fields.find((field) => field.key === key))}</p><p>{displayValue(conflict.latest?.values[key], resolution.fields.find((field) => field.key === key))}</p></article>)}<div className="nd-conflict-actions"><button className="nd-button nd-button-secondary" type="button" onClick={keepLocalOnLatestRevision}>保留我的填写</button><button className="nd-button nd-button-secondary" type="button" onClick={useLatest}>采用服务器最新内容</button></div></div>}</section>}
          <div aria-live="polite">{error && <p className="nd-message is-error">{error}</p>}{notice && <p className="nd-message is-success">{notice}</p>}</div>
          <div className="nd-editor-actions"><button className="nd-button nd-button-secondary" type="button" disabled={busy} onClick={() => { setCreating(false); setEditing(null); setConflict(null); setError(""); setNotice(""); }}>取消</button><button className="nd-button nd-button-primary" type="button" disabled={busy || !title.trim() || Boolean(conflict)} onClick={() => void save()}>{busy ? "保存中…" : "保存资料"}</button></div>
        </>}
      </section>
    </div>}

    {history && <div className="nd-dialog-backdrop" role="presentation" onMouseDown={() => setHistory(null)}><section className="nd-history-dialog" role="dialog" aria-modal="true" aria-labelledby="nd-business-history-title" onMouseDown={(event) => event.stopPropagation()}><div className="nd-section-heading"><div><p className="nd-kicker">只读修改记录</p><h2 id="nd-business-history-title">{historyTitle}</h2></div><button className="nd-dialog-close" type="button" aria-label="关闭修改记录" onClick={() => setHistory(null)}>×</button></div><div className="nd-history-list">{history.map((version) => <article key={version.id}><div><strong>修订 {version.revision}</strong><span>{historySource(version.source)} · 内容规格 v{version.typeVersion}{version.formVersion ? ` · 创作表单 v${version.formVersion}` : ""}</span></div><time>{new Date(version.createdAt).toLocaleString("zh-CN")}</time><h3>{version.title}</h3><dl>{Object.entries({...version.values,...version.localValues}).map(([key, value]) => <div key={key}><dt>{combinedFields.find((field) => field.key === key)?.name ?? key}</dt><dd>{displayValue(value, combinedFields.find((field) => field.key === key))}</dd></div>)}</dl></article>)}</div></section></div>}
    {addingInformation&&selectedType&&<AddInformationDialog bookId={book.id} cardType={selectedType} card={editing} onClose={()=>setAddingInformation(false)} onCreated={refreshAfterFieldCreate}/>}
    {editingField&&selectedType&&<AddInformationDialog bookId={book.id} cardType={selectedType} card={editing} definition={editingField} initialValue={localValues[editingField.fieldKey]} onClose={()=>setEditingField(null)} onCreated={refreshAfterFieldCreate}/>}
    {fieldHistory&&<div className="nd-dialog-backdrop" role="presentation" onMouseDown={()=>setFieldHistory(null)}><section className="nd-history-dialog nd-field-history-dialog" role="dialog" aria-modal="true" aria-labelledby="nd-field-history-title" onMouseDown={(event)=>event.stopPropagation()}><div className="nd-section-heading"><div><p className="nd-kicker">{scopeLabelByKey[fieldHistory.definition.fieldKey]}</p><h2 id="nd-field-history-title">{fieldHistory.definition.currentVersion.field.name}</h2><p>稳定标识 {fieldHistory.definition.fieldKey} · 改名不会改变资料身份</p></div><button className="nd-dialog-close" type="button" aria-label="关闭信息版本" onClick={()=>setFieldHistory(null)}>×</button></div><div className="nd-history-list">{fieldHistory.versions.map((version)=><article key={version.id}><div><strong>版本 {version.version}</strong><span>{version.field.group} · {TYPE_LABELS[version.field.type]??version.field.type}</span></div><time>{new Date(version.createdAt).toLocaleString("zh-CN")}</time><h3>{version.field.name}</h3><p>{version.field.description||"没有填写说明。"}</p></article>)}</div></section></div>}
  </div>;
}
