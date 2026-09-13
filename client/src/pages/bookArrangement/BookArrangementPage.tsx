import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { BookArrangementDraftPayload, BookArrangementDraftRecord, BookArrangementPreview, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { createBookArrangementApi } from "@/api/bookArrangement";
import { getNovelList } from "@/api/novel";
import { Button } from "@/components/ui/button";
import { ArrangementToolbar, useArrangementShell } from "@/components/layout/BookArrangementShell";
import { AdjustmentOperationKeys, validateWritingControls } from "@/pages/novels/components/writingAdjustments/adjustmentState";
import { ArrangementInspector } from "./ArrangementInspector";
import { ArrangementMatrix } from "./ArrangementMatrix";
import { ArrangementPlanning, type ArrangementRun } from "./ArrangementPlanning";
import { ArrangementPreview } from "./ArrangementPreview";
import { ArrangementChapterNavigator } from "./ArrangementChapterNavigator";
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
  const setBook = useArrangementShell();
  useEffect(() => { setBook(workspace ? { title: workspace.title, chapters: workspace.chapters.length, written: workspace.chapters.filter(chapter => chapter.hasContent).length, coverUrl: workspace.coverUrl, genre: workspace.genre?.name } : null); return () => setBook(null); }, [workspace, setBook]);
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
  const novelPicker = <label className="ba-novel-picker"><span className="sr-only">选择作品</span><select aria-label="选择作品" className="ba-input" value={novelId} onChange={event => {
        if (dirty && !window.confirm("有未保存的编排。切换后可恢复本地编辑，仍要切换作品吗？")) return;
        const next = new URLSearchParams(params); if (event.target.value) next.set("novelId", event.target.value); else next.delete("novelId"); setParams(next);
      }}><option value="">请选择作品</option>{novelId && !novels.some(novel => novel.id === novelId) && <option value={novelId}>{workspace?.title || "当前作品"}</option>}{novels.map(novel => <option key={novel.id} value={novel.id}>{novel.title}</option>)}</select></label>;
  return <main className="book-arrangement-page">
    {!workspace && <ArrangementToolbar><header className="ba-toolbar">{novelPicker}<span>全书编排台</span></header></ArrangementToolbar>}
    {hasMore && <Button size="sm" variant="ghost" onClick={() => setListPage(page => page + 1)}>加载更多作品</Button>}
    {listError && <div role="alert" className="text-sm text-destructive">{listError}<Button size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>重试读取作品</Button></div>}
    {!novelId && <div className="space-y-2 bg-muted/20 px-4 py-12 text-center"><h2 className="text-lg">选择一本作品开始编排</h2><p className="text-sm text-muted-foreground">作品中的章节、人物、事件和场景会按同一章节轴展示。</p></div>}
    {loading && <p role="status" className="text-sm text-muted-foreground">正在读取全书编排…</p>}
    {loadError && <div role="alert" className="text-sm text-destructive">{loadError}<Button size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>重试读取编排</Button></div>}
    {workspace && <ArrangementEditor key={novelId} initialWorkspace={workspace} onDirty={setDirty} novelPicker={novelPicker} />}
  </main>;
}

function ArrangementEditor({ initialWorkspace, onDirty, novelPicker }: { initialWorkspace: BookArrangementWorkspace; onDirty: (value: boolean) => void; novelPicker: ReactNode }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [saved, setSaved] = useState<BookArrangementDraftRecord>(initialWorkspace.draft);
  const [draft, setDraft] = useState(initialWorkspace.draft.payload);
  const [localDraft, setLocalDraft] = useState(() => readLocalDraft(initialWorkspace.novelId));
  const [windowStart, setWindowStart] = useState(0);
  const [selectedId, setSelectedId] = useState(initialWorkspace.chapters[0]?.id ?? "");
  const [scope, setScope] = useState<string[]>([]);
  const [rangeFrom, setRangeFrom] = useState(initialWorkspace.chapters[0]?.id ?? "");
  const [rangeTo, setRangeTo] = useState(initialWorkspace.chapters[Math.min(7, initialWorkspace.chapters.length - 1)]?.id ?? "");
  const [spanId, setSpanId] = useState("");
  const [characterSearch, setCharacterSearch] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [historySelection, setHistorySelection] = useState(0);
  const [spanSelection, setSpanSelection] = useState(0);
  const selectSpan = (id: string, clickedChapterId?: string) => {
    setSpanId(id);
    const span = draft.characterSpans.find(item => item.id === id);
    if (span) {
      setCharacterId(span.characterId);
      const targetChapterId = clickedChapterId && span.chapterIds.includes(clickedChapterId) ? clickedChapterId : span.chapterIds[0];
      if (targetChapterId) selectChapter(targetChapterId);
    }
    setSpanSelection(value => value + 1);
  };
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
  const window = chapterWindow(workspace.chapters, windowStart, 8);
  const allowed = editableChapterIds(draft, scope);
  useEffect(() => { if (!window.chapters.some(chapter => chapter.id === selectedId)) setSelectedId(window.chapters[0]?.id ?? ""); }, [window.start, selectedId, workspace.chapters]);
  useEffect(() => {
    const selectedSpan = draft.characterSpans.find(item => item.id === spanId);
    if (selectedSpan && !selectedSpan.chapterIds.includes(selectedId)) setSpanId(draft.characterSpans.find(item => item.characterId === selectedSpan.characterId && item.chapterIds.includes(selectedId))?.id ?? "");
  }, [selectedId, spanId, draft.characterSpans]);
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
  const selectChapter = (id: string) => {
    const index = workspace.chapters.findIndex(chapter => chapter.id === id);
    if (index < 0) return;
    setSelectedId(id);
    if (!window.chapters.some(chapter => chapter.id === id)) setWindowStart(Math.floor(index / 8) * 8);
  };
  const addAppearance = () => {
    const person = workspace.characters.find(item => item.id === characterId) ?? workspace.characters.find(item => item.name.includes(characterSearch.trim())) ?? workspace.characters[0];
    if (!person || !selectedId) return;
    const chapterIds = editableChapterIds(draft, scope.length ? scope : [selectedId]);
    if (!chapterIds.length) { setNotice("所选章节已锁定，请调整范围后添加出场。"); return; }
    const id = crypto.randomUUID();
    updateDraft({ ...draft, characterSpans: [...draft.characterSpans, { id, characterId: person.id, chapterIds, mode: "suggested", weight: null, note: "" }] });
    if (!chapterIds.includes(selectedId)) selectChapter(chapterIds[0]);
    setCharacterId(person.id); setSpanId(id); setSpanSelection(value => value + 1);
  };
  const previewRequirements = async () => {
    const input = { draftRevision: saved.revision, chapterIds: scope };
    const result = await run("预览后续要求", input, key => api.preview(input, key));
    if (result) { setPreview(result); setPreviewSelected(result.chapterIds); setApplied(false); }
  };
  const previewDisabled = Boolean(busy) || dirty || saved.revision === 0 || !allowed.length;
  if (!workspace.chapters.length) return <p className="bg-muted/20 p-6 text-sm">这部作品还没有章节。请先在作品的大纲与章节页面准备章节。</p>;
  return <div className="ba-editor">
    <ArrangementToolbar><header className="ba-toolbar">{novelPicker}<label className="ba-character-search"><Search size={16} aria-hidden="true" /><input aria-label="搜索人物，定位出场" placeholder="搜索人物，定位出场" value={characterSearch} onChange={event => setCharacterSearch(event.target.value)} onKeyDown={event => {
      if (event.key !== "Enter" || !characterSearch.trim()) return;
      const person = workspace.characters.find(item => item.name.includes(characterSearch.trim()));
      if (!person) return;
      setCharacterId(person.id);
      const span = draft.characterSpans.find(item => item.characterId === person.id);
      if (span) { selectChapter(span.chapterIds[0]); selectSpan(span.id); }
      else { const record = workspace.events.find(item => item.participantIds.includes(person.id) && item.chapterId); if (record?.chapterId) selectChapter(record.chapterId); setSpanId(""); setHistorySelection(value => value + 1); }
    }} /></label><select aria-label="章节窗口" className="ba-input ba-window-picker" value={window.start} onChange={event => setWindowStart(Number(event.target.value))}>{Array.from({ length: Math.max(1, workspace.chapters.length - 7) }, (_, start) => <option value={start} key={start}>第{workspace.chapters[start].order}—{workspace.chapters[Math.min(start + 7, workspace.chapters.length - 1)].order}章</option>)}</select><Button size="sm" disabled={Boolean(busy) || !workspace.characters.length} onClick={addAppearance}><Plus size={16} aria-hidden="true" />添加出场</Button>
      <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => {
      if (dirty && !globalThis.confirm("刷新资料会丢弃当前未保存编辑，是否继续？")) return;
      void run("刷新资料", {}, async () => { await reload(); return true; });
    }}>刷新资料</Button><Button size="sm" variant="secondary" disabled={Boolean(busy) || (!dirty && saved.revision > 0)} onClick={() => void save()}>保存草稿</Button></header></ArrangementToolbar>
    {localDraft && <div className="space-y-2 bg-amber-500/10 p-3 text-sm" role="status"><p>找到本作品尚未保存的本地编辑。可以恢复后检查，也可以继续服务端草稿。</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => { setDraft(localDraft.payload); setSaved(current => ({ ...current, revision: localDraft.revision })); setLocalDraft(null); setNotice("本地编辑已恢复，请核对后保存；其他窗口已修改时会提示版本冲突。"); }}>恢复未保存编辑</Button><Button size="sm" variant="ghost" onClick={() => { setLocalDraft(null); try { sessionStorage.removeItem(localKey); } catch { /* unavailable storage */ } }}>使用服务端草稿</Button></div></div>}
    {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {(busy || notice) && <p role="status" className="text-sm text-muted-foreground">{busy ? `${busy}…` : notice}</p>}
    <fieldset disabled={Boolean(busy)} className="ba-layout">
      <div className="ba-workbench">
      <div className="ba-page-heading"><nav aria-label="面包屑" className="ba-breadcrumb"><Link to="/novels">作品</Link><span>/</span><Link to={`/novels/${encodeURIComponent(workspace.novelId)}/edit`}>{workspace.title}</Link><span>/</span><span>全书编排台</span></nav><h1>全书编排台</h1><p>按章节查看故事安排，点击出场调整人物参与。</p><span className="ba-save-state">{dirty ? "有未保存编辑" : saved.revision === 0 ? "尚未保存编排" : "草稿已保存"}</span></div>
      <section aria-label="全书概览" className="ba-chapter-navigation"><div className="ba-navigation-heading"><h2>章节导航</h2><span>第 {window.chapters[0].order}—{window.chapters.at(-1)!.order} 章</span><Button size="sm" variant="ghost" aria-label="上一窗口" disabled={window.start === 0} onClick={() => setWindowStart(Math.max(0, window.start - 8))}><ChevronLeft size={16} aria-hidden="true" /></Button><Button size="sm" variant="ghost" aria-label="下一窗口" disabled={window.start + window.chapters.length >= workspace.chapters.length} onClick={() => setWindowStart(window.start + 8)}><ChevronRight size={16} aria-hidden="true" /></Button></div>
        <ArrangementChapterNavigator chapters={workspace.chapters} start={window.start} visibleCount={window.chapters.length} selectedId={selectedId} onStart={setWindowStart} onSelect={selectChapter} disabled={Boolean(busy)} />
      </section>
      <details className="ba-scope-picker"><summary>调整范围 · 已选 {scope.length} 章</summary><div className="ba-scope-controls"><label className="flex items-center gap-1"><input type="checkbox" aria-label="勾选当前窗口" checked={window.chapters.every(chapter => scope.includes(chapter.id))} onChange={event => { setScope(event.target.checked ? [...new Set([...scope, ...window.chapters.map(chapter => chapter.id)])] : scope.filter(id => !window.chapters.some(chapter => chapter.id === id))); setPreview(null); }} />当前窗口</label>
        <select aria-label="范围起始章节" className="ba-input ba-inline" value={rangeFrom} onChange={event => setRangeFrom(event.target.value)}>{workspace.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>第 {chapter.order} 章</option>)}</select><span>至</span><select aria-label="范围结束章节" className="ba-input ba-inline" value={rangeTo} onChange={event => setRangeTo(event.target.value)}>{workspace.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>第 {chapter.order} 章</option>)}</select><Button size="sm" variant="ghost" onClick={() => { setScope(chapterRange(workspace.chapters, rangeFrom, rangeTo)); setPreview(null); }}>勾选区间</Button><Button size="sm" variant="ghost" onClick={() => { setScope([]); setPreview(null); }}>清空范围</Button>
      </div></details>
      <div id="ba-chapter-matrix"><ArrangementMatrix workspace={workspace} draft={draft} chapters={window.chapters} selectedId={selectedId} scope={scope} onSelect={selectChapter} onScope={ids => { setScope(ids); setPreview(null); }} onSpan={selectSpan} onDraft={updateDraft} characterSearch={characterSearch} onCharacter={(id, chapterId) => { setCharacterId(id); if (chapterId) selectChapter(chapterId); }} onHistory={(chapterId, personId) => { selectChapter(chapterId); setCharacterId(personId ?? ""); setSpanId(""); setHistorySelection(value => value + 1); }} /></div></div>
      <ArrangementInspector workspace={workspace} draft={draft} selectedId={selectedId} scope={scope} spanId={spanId} spanSelection={spanSelection} onSpan={selectSpan} onDraft={updateDraft} busy={Boolean(busy)} characterId={characterId} historySelection={historySelection} onSelectChapter={selectChapter} onAddAppearance={addAppearance} onScope={ids => { setScope(ids); setPreview(null); }} onPreview={() => void previewRequirements()} previewDisabled={previewDisabled} dirty={dirty} />
    </fieldset>
    {workspace.previews.length > 0 && <select aria-label="恢复后续要求预览" className="ba-input" value="" disabled={Boolean(busy) || dirty} onChange={event => { const item = workspace.previews.find(entry => entry.id === event.target.value); if (item) { setPreview(item); setPreviewSelected(item.chapterIds); setApplied(false); } }}><option value="">恢复已保存的后续要求预览</option>{workspace.previews.map(item => <option key={item.id} value={item.id}>{item.chapterIds.map(id => workspace.chapters.find(chapter => chapter.id === id)?.title ?? id).join("、")}</option>)}</select>}
    {preview && <ArrangementPreview preview={preview} workspace={workspace} selected={previewSelected} onSelected={setPreviewSelected} disabled={Boolean(busy) || dirty || preview.baseRevision !== workspace.baseRevision} applied={applied} onApply={() => void (async () => { const input = { chapterIds: previewSelected }; const result = await run("应用所选章节要求", { id: preview.id, ...input }, key => api.apply(preview.id, input, key)); if (result) { setApplied(true); setWorkspace(current => ({ ...current, appliedSettings: { ...current.appliedSettings, ...result.appliedSettings } })); setNotice("所选章节的后续要求已应用，历史正文保持原样。"); } })()} />}
    <details className="ba-planning-panel" onToggle={event => { if (event.currentTarget.open) setPlanningOpen(true); }}><summary>AI 重编排所选大纲</summary>{planningOpen && <fieldset disabled={Boolean(busy)}><ArrangementPlanning workspace={workspace} draft={draft} scope={scope} dirty={dirty || saved.revision === 0} busy={Boolean(busy)} run={run} reload={reload} /></fieldset>}</details>
  </div>;
}
