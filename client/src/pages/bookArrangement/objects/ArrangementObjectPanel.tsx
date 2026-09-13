import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { BookArrangementObjectDetail, BookArrangementObjectKind, BookArrangementObjectPreview, BookArrangementObjectPreviewRequest, BookArrangementObjectValue, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { createBookArrangementApi } from "@/api/bookArrangement";
import { Button } from "@/components/ui/button";
import type { ArrangementRun } from "../ArrangementPlanning";
import { ArrangementCheckPanel } from "./ArrangementCheckPanel";
import { ArrangementObjectFields } from "./ArrangementObjectFields";
import { ArrangementObjectPreview } from "./ArrangementObjectPreview";
import { definitivelyRejectedObjectApply, editableObjectPatch, objectKindLabels, objectPanelError, objectRemoval, recoverObjectCandidate, validateObjectFields } from "./objectPanelState";

export interface ArrangementObjectSelection { kind: BookArrangementObjectKind | "check"; id: string; chapterId?: string }
export interface ArrangementObjectPanelProps {
  workspace: BookArrangementWorkspace; selectedObject: ArrangementObjectSelection; busy: boolean; run: ArrangementRun;
  reload: () => Promise<void>; onClose?: () => void; onDirtyChange?: (dirty: boolean) => void;
}
type LocalObjectDraft = { revision: string; fields: Record<string, BookArrangementObjectValue>; preview: BookArrangementObjectPreview | null; pendingApply?: boolean };

export function ArrangementObjectPanel(props: ArrangementObjectPanelProps) {
  const { workspace, selectedObject } = props;
  return <ObjectPanelWorkspace key={`${workspace.novelId}:${selectedObject.kind}:${selectedObject.id}:${selectedObject.chapterId ?? ""}`} {...props} />;
}

function ObjectPanelWorkspace({ workspace, selectedObject, busy, run, reload, onClose, onDirtyChange }: ArrangementObjectPanelProps) {
  const api = useMemo(() => createBookArrangementApi(workspace.novelId), [workspace.novelId]);
  const [detail, setDetail] = useState<BookArrangementObjectDetail | null>(null);
  const [fields, setFields] = useState<Record<string, BookArrangementObjectValue>>({});
  const [preview, setPreview] = useState<BookArrangementObjectPreview | null>(null);
  const [applied, setApplied] = useState(false);
  const [pendingApply, setPendingApply] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [operation, setOperation] = useState("");
  const [draftRevision, setDraftRevision] = useState("");
  const [checkDirty, setCheckDirty] = useState(false);
  const mounted = useRef(true);
  const storageKey = `book-arrangement-object:${workspace.novelId}:${selectedObject.kind}:${selectedObject.id}:${selectedObject.chapterId ?? ""}`;
  const create = !selectedObject.id || selectedObject.id === "new";
  const dirty = detail != null && JSON.stringify(fields) !== JSON.stringify(detail.fields);
  const staleDraft = Boolean(detail && draftRevision !== detail.revision);
  const working = busy || Boolean(operation);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const panelRun: ArrangementRun = async (name, input, action) => {
    setError(""); setNotice(""); setOperation(name);
    try {
      const result = await run(name, input, async key => {
        try { return await action(key); } catch (failure) { if (mounted.current) setError(`${objectPanelError(failure)} 输入与候选已保留，可重试。`); throw failure; }
      });
      if (result !== undefined && mounted.current) setNotice(`${name}完成。`);
      return result;
    } finally { if (mounted.current) setOperation(""); }
  };
  const load = async () => {
    if (selectedObject.kind === "check") return;
    let saved: LocalObjectDraft | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as LocalObjectDraft | null; } catch { /* Optional local recovery. */ }
    const persisted = saved?.preview ? recoverObjectCandidate(saved.preview, workspace.objectPreviews ?? []) : (workspace.objectPreviews ?? []).find(item => item.objectId === selectedObject.id && item.kind === selectedObject.kind && item.action === "delete" && item.applied);
    if (persisted?.applied && persisted.action === "delete" && persisted.before) {
      setDetail(persisted.before); setFields(persisted.before.fields); setDraftRevision(persisted.before.revision); setPreview(persisted); setApplied(true); setPendingApply(false); setNotice("已恢复移除操作的采纳回执，原记录与调整前内容可在预览中查看。"); return;
    }
    const result = await panelRun("读取对象资料", selectedObject, () => api.object(selectedObject.kind as BookArrangementObjectKind, selectedObject.id || "new", selectedObject.chapterId));
    if (!result || !mounted.current) return;
    setDetail(result); setFields(result.fields); setDraftRevision(result.revision);
    try {
      if (saved && typeof saved.revision === "string" && saved.fields && typeof saved.fields === "object") {
        const recovered = saved.preview ? recoverObjectCandidate(saved.preview, workspace.objectPreviews ?? []) : null;
        setFields(saved.fields); setDraftRevision(saved.revision); setPreview(recovered); setApplied(Boolean(recovered?.applied)); setPendingApply(Boolean(saved.pendingApply && !recovered?.applied));
        setNotice(recovered?.applied ? "已恢复采纳回执，此安排已经应用，请勿重复新增。" : "已恢复此对象的本地编辑与候选。");
      }
    } catch { /* Missing local storage does not prevent loading canonical detail. */ }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { onDirtyChange?.((dirty && !applied) || checkDirty); return () => onDirtyChange?.(false); }, [dirty, applied, checkDirty, onDirtyChange]);
  useEffect(() => {
    if (!detail) return;
    try {
      if (!dirty && !preview) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify({ revision: draftRevision, fields, preview, pendingApply } satisfies LocalObjectDraft));
    } catch { /* Parent can still guard unsaved navigation. */ }
  }, [detail, fields, dirty, preview, applied, pendingApply, draftRevision, storageKey]);
  useEffect(() => {
    if (!preview || applied) return;
    const recovered = recoverObjectCandidate(preview, workspace.objectPreviews ?? []);
    if (recovered.applied) { setPreview(recovered); setApplied(true); setPendingApply(false); setNotice("已确认采纳回执，此安排已经应用。"); }
  }, [workspace.objectPreviews, preview, applied]);
  const reset = () => {
    if (!detail) return;
    setFields(detail.fields); setDraftRevision(detail.revision); setPreview(null); setApplied(false); setError(""); setNotice("已恢复最新载入的对象资料。");
    try { sessionStorage.removeItem(storageKey); } catch { /* Local cache unavailable. */ }
  };
  const showPreview = async (action: BookArrangementObjectPreviewRequest["action"]) => {
    if (!detail || selectedObject.kind === "check") return;
    const invalid = action === "delete" ? null : validateObjectFields(detail.fieldDefinitions, fields);
    if (invalid) { setError(invalid); return; }
    const input: BookArrangementObjectPreviewRequest = { kind: selectedObject.kind, action, ...(create ? {} : { objectId: detail.id, expectedRevision: detail.revision }), patch: action === "delete" ? {} : editableObjectPatch(detail, fields, create) };
    const result = await panelRun(action === "delete" ? `预览${objectRemoval[selectedObject.kind].action}` : "预览对象调整", input, key => api.previewObject(input, key));
    if (result) { setPreview(result); setApplied(false); }
  };
  const apply = async () => {
    if (!preview || applied) return;
    setPendingApply(true);
    try { sessionStorage.setItem(storageKey, JSON.stringify({ revision: draftRevision, fields, preview, pendingApply: true } satisfies LocalObjectDraft)); } catch { /* Same-candidate replay still recovers the server receipt. */ }
    const result = await panelRun("应用对象调整", { candidateId: preview.id }, async key => {
      try { return await api.applyObject(preview.id, key); }
      catch (failure) { if (definitivelyRejectedObjectApply(failure)) setPendingApply(false); throw failure; }
    });
    if (!result) return;
    setApplied(true); setPendingApply(false); setPreview({ ...preview, applied: result });
    await panelRun("刷新编排资料", { objectId: result.objectId }, async () => { await reload(); return true; });
  };
  const startFresh = async () => {
    if (selectedObject.kind === "check") return;
    const result = await panelRun(create ? "准备另一条安排" : "读取已应用的对象", selectedObject, () => api.object(selectedObject.kind as BookArrangementObjectKind, selectedObject.id || "new", selectedObject.chapterId));
    if (!result) return;
    setDetail(result); setFields(result.fields); setDraftRevision(result.revision); setPreview(null); setApplied(false); setPendingApply(false);
    try { sessionStorage.removeItem(storageKey); } catch { /* No local cache. */ }
  };
  const issue = selectedObject.kind === "check" ? workspace.checks?.find(item => item.id === selectedObject.id || item.sourceId === selectedObject.id) : undefined;
  const history = (workspace.objectPreviews ?? []).filter(candidate => candidate.kind === selectedObject.kind && (create ? candidate.action === "create" && (!selectedObject.chapterId || candidate.affectedChapterIds.includes(selectedObject.chapterId)) : candidate.objectId === detail?.id));
  return <section className="min-w-0 space-y-4 text-foreground" aria-label={`${objectKindLabels[selectedObject.kind]}详情`} aria-busy={working}>
    <header className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg">{issue?.title ?? detail?.title ?? `${create ? "新增" : ""}${objectKindLabels[selectedObject.kind]}`}</h2>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail.evidenceLabel}{detail.editable ? " · 预览后应用" : " · 只读资料"}</p>}</div></header>
    {operation && <p role="status" className="text-sm text-muted-foreground">{operation}…</p>}
    {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {selectedObject.kind === "check" ? issue || selectedObject.chapterId ? <ArrangementCheckPanel issue={issue} chapterId={selectedObject.chapterId} workspace={workspace} busy={working} run={panelRun} reload={reload} onDirtyChange={setCheckDirty} /> : <p>所选问题记录已不存在，请刷新后重新选择。</p> : !detail ? <Button size="sm" variant="secondary" disabled={working} onClick={() => void load()}>重新读取对象资料</Button> : <>
      {staleDraft && !applied && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">本地编辑基于较早版本。请比较原有资料，撤销本地编辑后再按最新版本调整。</p>}
      {pendingApply && <div role="status" className="space-y-2 rounded-md bg-muted p-3 text-sm"><p>上次采纳结果尚未确认。请重试同一候选以读取回执，确认前保留这份安排。</p><Button size="sm" disabled={working} onClick={() => void apply()}>重试采纳并确认回执</Button><Button size="sm" variant="outline" disabled={working} onClick={() => void panelRun("刷新采纳状态", { candidateId: preview?.id }, async () => { await reload(); return true; })}>刷新采纳状态</Button></div>}
      {history.length > 0 && <label className="block space-y-1 text-sm"><span>已保存候选</span><select aria-label="恢复对象调整候选" className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2" value="" disabled={working || dirty || applied || pendingApply} onChange={event => { const candidate = history.find(item => item.id === event.target.value); if (!candidate) return; setPreview(candidate); setFields(candidate.after?.fields ?? detail.fields); setDraftRevision(candidate.before?.revision ?? detail.revision); setApplied(Boolean(candidate.applied)); setPendingApply(false); setNotice(candidate.applied ? "已载入采纳回执，此安排已经应用。" : "已载入保存的对象候选，请核对版本与影响后应用。"); }}><option value="">选择已有候选</option>{history.map((candidate, index) => <option key={candidate.id} value={candidate.id}>{index + 1}. {candidate.applied ? "已采纳 · " : "待采纳 · "}{candidate.action === "delete" ? objectRemoval[candidate.kind].action : candidate.after?.title ?? candidate.before?.title ?? objectKindLabels[candidate.kind]}</option>)}</select></label>}
      <fieldset disabled={working || applied || pendingApply} className="min-w-0 space-y-4"><ArrangementObjectFields detail={detail} fields={fields} workspace={workspace} disabled={working || applied || pendingApply} onChange={detail.editable ? (key, value) => { setFields(current => ({ ...current, [key]: value })); setPreview(null); setApplied(false); } : undefined} />
        {detail.editable && <div className="flex flex-wrap gap-2"><Button size="sm" disabled={working || staleDraft || (!create && !dirty)} onClick={() => void showPreview(create ? "create" : "update")}>预览对象调整</Button><Button size="sm" variant="ghost" disabled={working || (!dirty && !preview && !staleDraft)} onClick={reset}><RotateCcw size={14} aria-hidden="true" />撤销本地编辑</Button></div>}
        {detail.deletable && !create && <Button size="sm" variant="ghost" disabled={working || staleDraft} onClick={() => void showPreview("delete")}>预览{objectRemoval[detail.kind].action}</Button>}
      </fieldset>
      {preview && <ArrangementObjectPreview preview={preview} workspace={workspace} disabled={working || staleDraft || pendingApply} applied={applied} onApply={() => void apply()} />}
      {applied && <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={onClose} disabled={!onClose || working}>完成并关闭</Button>{preview?.action !== "delete" && <Button size="sm" variant="outline" disabled={working} onClick={() => void startFresh()}>{create ? "新增另一条安排" : "载入最新对象继续调整"}</Button>}</div>}
    </>}
  </section>;
}
