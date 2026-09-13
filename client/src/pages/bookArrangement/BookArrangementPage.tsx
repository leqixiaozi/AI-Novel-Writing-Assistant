import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { BookArrangementDraftPayload, BookArrangementDraftRecord, BookArrangementPreview, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { createBookArrangementApi } from "@/api/bookArrangement";
import { getNovelList } from "@/api/novel";
import { Button } from "@/components/ui/button";
import { AdjustmentOperationKeys, validateWritingControls } from "@/pages/novels/components/writingAdjustments/adjustmentState";
import { ArrangementInspector } from "./ArrangementInspector";
import { ArrangementMatrix } from "./ArrangementMatrix";
import { ArrangementPlanning, type ArrangementRun } from "./ArrangementPlanning";
import { ArrangementPreview } from "./ArrangementPreview";
import { chapterRange, chapterWindow, draftDirty, editableChapterIds } from "./arrangementState";
import "./bookArrangement.css";

function errorMessage(error: unknown): string {
  const failure = error as { response?: { data?: { message?: string } }; message?: string };
  return failure.response?.data?.message || failure.message || "操作未完成，请重试。输入内容已保留。";
}
type LocalDraft = { revision: number; payload: BookArrangementDraftPayload };
function readLocalDraft(novelId: string): LocalDraft | null {
  try { const value = JSON.parse(sessionStorage.getItem(`book-arrangement:${novelId}`) || "null") as LocalDraft | null; return value && typeof value.revision === "number" && typeof value.payload?.baseRevision === "string" && Array.isArray(value.payload.chapterEdits) && Array.isArray(value.payload.characterSpans) && Array.isArray(value.payload.pinnedTracks) ? value : null; } catch { return null; }
}

export default function BookArrangementPage() {
  const [params, setParams] = useSearchParams();
  const novelId = params.get("novelId") || "";
  const [novels, setNovels] = useState<Array<{ id: string; title: string }>>([]);
  const [listPage, setListPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [listError, setListError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [workspace, setWorkspace] = useState<BookArrangementWorkspace | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void getNovelList({ page: listPage, limit: 100 }).then(response => {
      if (!active) return;
      if (!response.data) throw new Error(response.message || "作品列表读取失败。");
      const result = response.data;
      setNovels(previous => { const entries = listPage === 1 ? result.items : [...previous, ...result.items]; return [...new Map(entries.map(item => [item.id, { id: item.id, title: item.title }])).values()]; });
      setHasMore(result.page < result.totalPages); setListError("");
    }).catch(error => { if (active) setListError(errorMessage(error)); });
    return () => { active = false; };
  }, [listPage, retry]);
  useEffect(() => {
    let active = true;
    setWorkspace(null); setDirty(false); setLoadError("");
    if (!novelId) { setLoading(false); return; }
    setLoading(true);
    void createBookArrangementApi(novelId).workspace().then(data => { if (active) setWorkspace(data); }).catch(error => { if (active) setLoadError(errorMessage(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [novelId, retry]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  return <main className="book-arrangement-page space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl">全书编排</h1><p className="mt-2 text-sm text-muted-foreground">沿同一章节轴查看事件、场景、人物与表达参数，选定范围后调整后续安排。</p></div>
      <label className="min-w-0 space-y-1 text-sm"><span>选择作品</span><select aria-label="选择作品" className="ba-input" value={novelId} onChange={event => {
        if (dirty && !window.confirm("有未保存的编排。切换后可恢复本地编辑，仍要切换作品吗？")) return;
        const next = new URLSearchParams(params); if (event.target.value) next.set("novelId", event.target.value); else next.delete("novelId"); setParams(next);
      }}><option value="">请选择作品</option>{novelId && !novels.some(novel => novel.id === novelId) && <option value={novelId}>{workspace?.title || "当前作品"}</option>}{novels.map(novel => <option key={novel.id} value={novel.id}>{novel.title}</option>)}</select></label>
    </header>
    {hasMore && <Button size="sm" variant="ghost" onClick={() => setListPage(page => page + 1)}>加载更多作品</Button>}
    {listError && <div role="alert" className="text-sm text-destructive">{listError}<Button size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>重试读取作品</Button></div>}
    {!novelId && <div className="space-y-2 bg-muted/20 px-4 py-12 text-center"><h2 className="text-lg">选择一本作品开始编排</h2><p className="text-sm text-muted-foreground">作品中的章节、人物、事件和场景会按同一章节轴展示。</p></div>}
    {loading && <p role="status" className="text-sm text-muted-foreground">正在读取全书编排…</p>}
    {loadError && <div role="alert" className="text-sm text-destructive">{loadError}<Button size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>重试读取编排</Button></div>}
    {workspace && <ArrangementEditor key={novelId} initialWorkspace={workspace} onDirty={setDirty} />}
  </main>;
}

function ArrangementEditor({ initialWorkspace, onDirty }: { initialWorkspace: BookArrangementWorkspace; onDirty: (value: boolean) => void }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [saved, setSaved] = useState<BookArrangementDraftRecord>(initialWorkspace.draft);
  const [draft, setDraft] = useState(initialWorkspace.draft.payload);
  const [localDraft, setLocalDraft] = useState(() => readLocalDraft(initialWorkspace.novelId));
  const [windowStart, setWindowStart] = useState(0);
  const [selectedId, setSelectedId] = useState(initialWorkspace.chapters[0]?.id ?? "");
  const [scope, setScope] = useState<string[]>([]);
  const [rangeFrom, setRangeFrom] = useState(initialWorkspace.chapters[0]?.id ?? "");
  const [rangeTo, setRangeTo] = useState(initialWorkspace.chapters[Math.min(9, initialWorkspace.chapters.length - 1)]?.id ?? "");
  const [spanId, setSpanId] = useState("");
  const [spanSelection, setSpanSelection] = useState(0);
  const selectSpan = (id: string) => { setSpanId(id); setSpanSelection(value => value + 1); };
  const [preview, setPreview] = useState<BookArrangementPreview | null>(null);
  const [previewSelected, setPreviewSelected] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const [planningOpen, setPlanningOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const keys = useRef(new AdjustmentOperationKeys());
  const inFlight = useRef(false);
  const api = useMemo(() => createBookArrangementApi(workspace.novelId), [workspace.novelId]);
  const dirty = draftDirty(draft, saved.payload);
  const localKey = `book-arrangement:${workspace.novelId}`;
  const window = chapterWindow(workspace.chapters, windowStart);
  const allowed = editableChapterIds(draft, scope);
  useEffect(() => { if (!window.chapters.some(chapter => chapter.id === selectedId)) setSelectedId(window.chapters[0]?.id ?? ""); }, [window.start, selectedId, workspace.chapters]);
  useEffect(() => { onDirty(dirty || Boolean(localDraft)); }, [dirty, localDraft, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    try { sessionStorage.setItem(localKey, JSON.stringify({ revision: saved.revision, payload: draft })); } catch { /* beforeunload remains active when session storage is unavailable */ }
  }, [draft, dirty, saved.revision, localKey]);
  const updateDraft = (value: BookArrangementDraftPayload) => { setDraft(value); setPreview(null); setApplied(false); setNotice(""); };
  const run: ArrangementRun = useCallback(async (operation, input, action) => {
    if (inFlight.current) return undefined;
    inFlight.current = true; setBusy(operation); setError(""); setNotice("");
    const request = keys.current.get(operation, input);
    try { const result = await action(request.key); keys.current.complete(request.identity); return result; }
    catch (failure) { setError(`${errorMessage(failure)} 输入内容已保留。`); return undefined; }
    finally { inFlight.current = false; setBusy(""); }
  }, []);
  const reload = async () => {
    const next = await api.workspace();
    setWorkspace(next); setSaved(next.draft); setDraft({ ...next.draft.payload, baseRevision: next.baseRevision }); setPreview(null); setApplied(false); setLocalDraft(null);
    try { sessionStorage.removeItem(localKey); } catch { /* no persistent local recovery available */ }
    if (next.draft.payload.baseRevision !== next.baseRevision) setNotice("资料已刷新，请保存草稿以使用最新章节资料。");
  };
  const save = async () => {
    for (const edit of draft.chapterEdits) { const validation = validateWritingControls(edit.controls); if (validation) { setError(validation); return; } }
    if (draft.characterSpans.some(span => !span.chapterIds.length || (span.weight !== null && (!Number.isFinite(span.weight) || span.weight < 0 || span.weight > 100)))) { setError("人物区段需包含章节，权重请留空或填写 0 至 100。"); return; }
    const input = { expectedRevision: saved.revision, payload: draft };
    const result = await run("保存草稿", input, key => api.saveDraft(input, key));
    if (result) { setSaved(result); setDraft(result.payload); setLocalDraft(null); setPreview(null); setNotice("编排草稿已保存，刷新后可继续编辑。"); try { sessionStorage.removeItem(localKey); } catch { /* server draft is durable */ } }
  };
  if (!workspace.chapters.length) return <p className="bg-muted/20 p-6 text-sm">这部作品还没有章节。请先在作品的大纲与章节页面准备章节。</p>;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-2"><span className="mr-auto text-sm">{workspace.title} · {workspace.chapters.length} 章 · {dirty ? "有未保存编辑" : saved.revision === 0 ? "尚未保存编排" : "草稿已保存"}</span><Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => {
      if (dirty && !globalThis.confirm("刷新资料会丢弃当前未保存编辑，是否继续？")) return;
      void run("刷新资料", {}, async () => { await reload(); return true; });
    }}>刷新资料</Button><Button size="sm" variant="secondary" disabled={Boolean(busy) || (!dirty && saved.revision > 0)} onClick={() => void save()}>保存草稿</Button><Button size="sm" disabled={Boolean(busy) || dirty || saved.revision === 0 || !allowed.length} onClick={() => void (async () => { const input = { draftRevision: saved.revision, chapterIds: scope }; const result = await run("预览后续要求", input, key => api.preview(input, key)); if (result) { setPreview(result); setPreviewSelected(result.chapterIds); setApplied(false); } })()}>预览后续要求</Button></div>
    {saved.revision === 0 && <p className="text-xs text-muted-foreground">编辑章节安排并保存草稿后，勾选范围预览后续要求。</p>}
    {localDraft && <div className="space-y-2 bg-amber-500/10 p-3 text-sm" role="status"><p>找到本作品尚未保存的本地编辑。可以恢复后检查，也可以继续服务端草稿。</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => { setDraft(localDraft.payload); setSaved(current => ({ ...current, revision: localDraft.revision })); setLocalDraft(null); setNotice("本地编辑已恢复，请核对后保存；其他窗口已修改时会提示版本冲突。"); }}>恢复未保存编辑</Button><Button size="sm" variant="ghost" onClick={() => { setLocalDraft(null); try { sessionStorage.removeItem(localKey); } catch { /* unavailable storage */ } }}>使用服务端草稿</Button></div></div>}
    {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {(busy || notice) && <p role="status" className="text-sm text-muted-foreground">{busy ? `${busy}…` : notice}</p>}
    <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-4">
      <section aria-label="全书概览" className="space-y-3 bg-muted/15 p-3"><div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto text-sm">全书概览 · 点击章节定位</h2><span className="text-xs text-muted-foreground">当前窗口：第 {window.chapters[0].order}—{window.chapters.at(-1)!.order} 章</span><Button size="sm" variant="ghost" aria-label="上一窗口" disabled={window.start === 0} onClick={() => setWindowStart(Math.max(0, window.start - 10))}>←</Button><Button size="sm" variant="ghost" aria-label="下一窗口" disabled={window.start + window.chapters.length >= workspace.chapters.length} onClick={() => setWindowStart(window.start + 10)}>→</Button></div>
        <div className="ba-overview">{workspace.chapters.map((chapter, index) => <button type="button" key={chapter.id} title={`第 ${chapter.order} 章 · ${chapter.title}`} aria-label={`概览第${chapter.order}章`} className={`${index >= window.start && index < window.start + window.chapters.length ? "in-window" : ""} ${chapter.id === selectedId ? "is-selected" : ""}`} onClick={() => { setSelectedId(chapter.id); setWindowStart(Math.floor(index / 10) * 10); }} />)}</div>
      </section>
      <div className="flex flex-wrap items-center gap-3 text-sm"><span>调整范围 · 已选 {scope.length} 章</span><label className="flex items-center gap-1"><input type="checkbox" aria-label="勾选当前窗口" checked={window.chapters.every(chapter => scope.includes(chapter.id))} onChange={event => { setScope(event.target.checked ? [...new Set([...scope, ...window.chapters.map(chapter => chapter.id)])] : scope.filter(id => !window.chapters.some(chapter => chapter.id === id))); setPreview(null); }} />当前窗口</label>
        <select aria-label="范围起始章节" className="ba-input ba-inline" value={rangeFrom} onChange={event => setRangeFrom(event.target.value)}>{workspace.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>第 {chapter.order} 章</option>)}</select><span>至</span><select aria-label="范围结束章节" className="ba-input ba-inline" value={rangeTo} onChange={event => setRangeTo(event.target.value)}>{workspace.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>第 {chapter.order} 章</option>)}</select><Button size="sm" variant="ghost" onClick={() => { setScope(chapterRange(workspace.chapters, rangeFrom, rangeTo)); setPreview(null); }}>勾选区间</Button><Button size="sm" variant="ghost" onClick={() => { setScope([]); setPreview(null); }}>清空范围</Button>
      </div>
      <div className="ba-layout"><ArrangementMatrix workspace={workspace} draft={draft} chapters={window.chapters} selectedId={selectedId} scope={scope} onSelect={setSelectedId} onScope={ids => { setScope(ids); setPreview(null); }} onSpan={selectSpan} onDraft={updateDraft} /><ArrangementInspector workspace={workspace} draft={draft} selectedId={selectedId} scope={scope} spanId={spanId} spanSelection={spanSelection} onSpan={selectSpan} onDraft={updateDraft} busy={Boolean(busy)} /></div>
    </fieldset>
    {workspace.previews.length > 0 && <select aria-label="恢复后续要求预览" className="ba-input" value="" disabled={Boolean(busy) || dirty} onChange={event => { const item = workspace.previews.find(entry => entry.id === event.target.value); if (item) { setPreview(item); setPreviewSelected(item.chapterIds); setApplied(false); } }}><option value="">恢复已保存的后续要求预览</option>{workspace.previews.map(item => <option key={item.id} value={item.id}>{item.chapterIds.map(id => workspace.chapters.find(chapter => chapter.id === id)?.title ?? id).join("、")}</option>)}</select>}
    {preview && <ArrangementPreview preview={preview} workspace={workspace} selected={previewSelected} onSelected={setPreviewSelected} disabled={Boolean(busy) || dirty || preview.baseRevision !== workspace.baseRevision} applied={applied} onApply={() => void (async () => { const input = { chapterIds: previewSelected }; const result = await run("应用所选章节要求", { id: preview.id, ...input }, key => api.apply(preview.id, input, key)); if (result) { setApplied(true); setWorkspace(current => ({ ...current, appliedSettings: { ...current.appliedSettings, ...result.appliedSettings } })); setNotice("所选章节的后续要求已应用，历史正文保持原样。"); } })()} />}
    <details className="bg-muted/20 p-4" onToggle={event => { if (event.currentTarget.open) setPlanningOpen(true); }}><summary className="cursor-pointer text-sm">AI 重编排所选大纲</summary>{planningOpen && <fieldset disabled={Boolean(busy)}><ArrangementPlanning workspace={workspace} draft={draft} scope={scope} dirty={dirty || saved.revision === 0} busy={Boolean(busy)} run={run} reload={reload} /></fieldset>}</details>
  </div>;
}
