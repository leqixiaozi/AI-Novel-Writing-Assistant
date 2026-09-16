import { useEffect, useState } from "react";
import type { BookResearchAdoptionItem, CardTypeSummary, FieldDefinition } from "../../common/contracts";
import { publishedProposalFields, unknownProposalFieldCount } from "../../common/presentation";
import { ApiError, newDesignApi } from "../api";
import DynamicForm from "../DynamicForm";
import "./research-adoption.css";

interface Props {
  bookId: string;
  item: BookResearchAdoptionItem;
  busy: boolean;
  onDraftDirty?: (itemId:string,dirty:boolean)=>void;
  onSave: (item: BookResearchAdoptionItem, input: {title: string; values: Record<string, unknown>; decision: BookResearchAdoptionItem["decision"]}) => Promise<void>;
}

export default function AdoptionItemEditor({bookId, item, busy, onSave,onDraftDirty}: Props) {
  const [title, setTitle] = useState(item.title);
  const [values, setValues] = useState<Record<string, unknown>>(item.values);
  const [type, setType] = useState<CardTypeSummary | null>(null);
  const [fields, setFields] = useState<FieldDefinition[] | null>(null);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const dirty=JSON.stringify({title,values})!==JSON.stringify({title:item.title,values:item.values});
  useEffect(()=>{onDraftDirty?.(item.id,dirty);},[item.id,dirty,onDraftDirty]);
  const editValues=(next:Record<string,unknown>)=>{onDraftDirty?.(item.id,JSON.stringify({title,values:next})!==JSON.stringify({title:item.title,values:item.values}));setValues(next);};

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFields(null);
    setType(null);
    void (async () => {
      const book = await newDesignApi.getBook(bookId);
      const [local, shared] = await Promise.all([newDesignApi.listCardTypes(book.spaceId), newDesignApi.listCardTypes()]);
      const current = [...local, ...shared].find(candidate => candidate.key === item.targetTypeKey && candidate.status === "published") ?? null;
      const versions = current ? await newDesignApi.listCardTypeVersions(current.id) : [];
      if (!active) return;
      setType(current);
      setFields(publishedProposalFields(current, versions));
    })().catch(caught => {if (active) setError(caught instanceof Error ? caught.message : "内容表单加载失败。");})
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [bookId, item.targetTypeKey]);

  const locked = busy || saving || item.targetCardId !== null;
  const unknownCount = fields ? unknownProposalFieldCount(fields, values) : 0;
  const save = async (decision: BookResearchAdoptionItem["decision"]) => {
    setSaving(true);
    setError("");
    setIssues({});
    try {await onSave(item, {title, values, decision});}
    catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，当前填写内容保留。");
      if (caught instanceof ApiError) setIssues(caught.issues);
    } finally {setSaving(false);}
  };

  return <article className={`nd-research-adoption-item is-${item.decision}`}>
    <div className="nd-form-grid">
      <label className="nd-control"><span>资料名称</span><input value={title} onChange={event => {onDraftDirty?.(item.id,JSON.stringify({title:event.target.value,values})!==JSON.stringify({title:item.title,values:item.values}));setTitle(event.target.value);}} disabled={locked}/></label>
      <label className="nd-control"><span>内容类型</span><input value={loading ? "读取中…" : type?.name ?? "本书未安装此类型"} readOnly/></label>
    </div>
    {loading ? <p role="status">正在读取已发布内容表单…</p> : fields ? <DynamicForm fields={fields} values={values} issues={issues} disabled={locked} onChange={editValues}/> :
      <p className="nd-message">请先到本书设置安装并发布相应内容类型，当前提案保留。<a href={`/new-design/books/${bookId}/fields`}>打开本书设置</a></p>}
    {unknownCount > 0 && <p className="nd-message">有 {unknownCount} 项来源内容不属于当前表单。请先调整内容类型；采用前不会静默删除这些内容。</p>}
    <footer><span>{item.targetCardId ? "已写入本书资料" : item.decision === "adopt" ? "准备采用" : item.decision === "reject" ? "本批次忽略" : "待选择"}</span>
      {!item.targetCardId && <><button type="button" disabled={locked} onClick={() => void save("reject")}>忽略</button>
        <button className="nd-button-primary" type="button" disabled={locked || !bookId || fields === null || unknownCount > 0} onClick={() => void save("adopt")}>选择并保存</button></>}
    </footer>
    {error && <p className="nd-message is-error" role="alert">{error}</p>}
  </article>;
}
