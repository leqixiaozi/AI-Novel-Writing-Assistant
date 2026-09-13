import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookOpen, ChevronLeft, ChevronRight, MoreHorizontal, Network, Search } from "lucide-react";
import type { BookArrangementDraftPayload, BookArrangementDraftRecord, BookArrangementPreview, BookArrangementRelation, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import type { CharacterRelation } from "@ai-novel/shared/types/novel";
import { createBookArrangementApi } from "@/api/bookArrangement";
import { getCharacterRelations, getNovelList } from "@/api/novel";
import { Button } from "@/components/ui/button";
import { Dialog, AppDialogContent } from "@/components/ui/dialog";
import type { WritingControlKey } from "@ai-novel/shared/types/writingAdjustments";
import { ArrangementControlsPanel } from "./panels/ArrangementControlsPanel";
import { ArrangementObjectPanel, type ArrangementObjectSelection } from "./objects/ArrangementObjectPanel";
import { characterSpanError } from "./panels/characterEditing";
import { refreshArrangementDraft } from "./panels/draftRecovery";
import { AdjustmentOperationKeys, validateWritingControls } from "@/pages/novels/components/writingAdjustments/adjustmentState";
import { ArrangementInspector } from "./ArrangementInspector";
import { ArrangementMatrix } from "./ArrangementMatrix";
import { ArrangementPlanning, type ArrangementRun } from "./ArrangementPlanning";
import { ArrangementPreview } from "./ArrangementPreview";
import { ArrangementChapterNavigator } from "./ArrangementChapterNavigator";
import { chapterRange, chapterWindow, draftDirty, editableChapterIds } from "./arrangementState";
import type { BookArrangementVolumeEdit, BookArrangementVolumePreview } from "@ai-novel/shared/types/bookArrangement";
import { ArrangementVolumeInspector } from "./volume/ArrangementVolumeInspector";
import { ArrangementVolumePreview } from "./volume/ArrangementVolumePreview";
import { ChapterSceneEditor } from "./scenes/ChapterSceneEditor";
import "./panels/arrangement.css";

function errorMessage(error: unknown): string {
  const failure = error as { response?: { data?: { message?: string } }; message?: string };
  return failure.response?.data?.message || failure.message || "操作未完成，请重试。输入内容已保留。";
}
type LocalDraft = { revision: number; payload: BookArrangementDraftPayload };
function readLocalDraft(novelId: string): LocalDraft | null {
  try { const value = JSON.parse(sessionStorage.getItem(`book-arrangement:${novelId}`) || "null") as LocalDraft | null; return value && typeof value.revision === "number" && typeof value.payload?.baseRevision === "string" && Array.isArray(value.payload.chapterEdits) && Array.isArray(value.payload.characterSpans) && Array.isArray(value.payload.pinnedTracks) ? value : null; } catch { return null; }
}

function BookRelationshipPanel({ workspace, selectedId, onSelectChapter, onOpenRelation }: { workspace: BookArrangementWorkspace; selectedId: string; onSelectChapter: (chapterId: string) => void; onOpenRelation: (relation: BookArrangementRelation) => void }) {
  const [tab, setTab] = useState<"initial" | "chapter">("initial");
  const [initialRelations, setInitialRelations] = useState<CharacterRelation[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [initialError, setInitialError] = useState("");
  const [reload, setReload] = useState(0);
  const currentChapter = workspace.chapters.find(chapter => chapter.id === selectedId);
  const chapterRelations = (workspace.relations ?? []).filter(relation => relation.chapterId === selectedId || relation.chapterIds.includes(selectedId));
  const relationEditorUrl = `/novels/${workspace.novelId}/edit?stage=character&characterView=relations`;
  const characterName = (id: string) => workspace.characters.find(character => character.id === id)?.name || "未知角色";

  useEffect(() => {
    let active = true;
    setInitialLoading(true); setInitialError("");
    void getCharacterRelations(workspace.novelId).then(response => {
      if (!active) return;
      if (!response.data) throw new Error(response.message || "初始人物关系读取失败。");
      setInitialRelations(response.data);
    }).catch(error => { if (active) setInitialError(errorMessage(error)); }).finally(() => { if (active) setInitialLoading(false); });
    return () => { active = false; };
  }, [workspace.novelId, reload]);

  return <section className="ba-book-catalog ba-relation-panel">
    <div className="ba-inspector-tabs" role="tablist" aria-label="人物关系范围">
      <button type="button" role="tab" aria-selected={tab === "initial"} onClick={() => setTab("initial")}>初始关系</button>
      <button type="button" role="tab" aria-selected={tab === "chapter"} onClick={() => setTab("chapter")}>当前章节</button>
    </div>
    {tab === "initial" ? <>
      <header><div><h3>全书初始人物关系</h3><p>用于开书时确定人物之间的基础关系、隐藏张力和冲突来源。</p></div><Link target="_blank" rel="noreferrer" to={relationEditorUrl}>配置初始关系</Link></header>
      {initialLoading && <p role="status" className="ba-empty-state">正在读取初始人物关系…</p>}
      {initialError && <div role="alert" className="ba-relation-load-error"><span>{initialError}</span><Button size="sm" variant="outline" onClick={() => setReload(value => value + 1)}>重新读取</Button></div>}
      {!initialLoading && !initialError && initialRelations.map(relation => <article className="ba-relation-catalog-item" key={relation.id}><span><strong>{characterName(relation.sourceCharacterId)} → {characterName(relation.targetCharacterId)}</strong><small>初始设定</small></span><b>{relation.surfaceRelation}</b><em>{relation.hiddenTension || relation.conflictSource || relation.secretAsymmetry || "尚未补充隐藏张力与冲突来源。"}</em><Link target="_blank" rel="noreferrer" to={relationEditorUrl}>查看与配置</Link></article>)}
      {!initialLoading && !initialError && !initialRelations.length && <p className="ba-empty-state">本书尚未配置初始人物关系。可进入角色关系页建立。</p>}
    </> : <>
      <header><div><h3>{currentChapter ? `第 ${currentChapter.order} 章 · ${currentChapter.title}` : "当前章节"}</h3><p>这里只显示所选章节已经记录或计划发生的人物关系变化。</p></div><select className="ba-input ba-inline" aria-label="选择要查看人物关系的章节" value={selectedId} onChange={event => onSelectChapter(event.target.value)}>{workspace.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.order} · {chapter.title}</option>)}</select></header>
      {chapterRelations.map(relation => <button type="button" className="ba-relation-catalog-item" key={relation.id} onClick={() => onOpenRelation(relation)}><span><strong>{characterName(relation.sourceCharacterId)} → {characterName(relation.targetCharacterId)}</strong><small>{relation.basis === "plan" ? "计划" : relation.basis === "record" ? "记录" : relation.basis === "setting" ? "设定" : "待核对"}</small></span><b>{relation.title}</b><em>{relation.summary || relation.evidenceLabel}</em></button>)}
      {!chapterRelations.length && <p className="ba-empty-state">这一章还没有人物关系变化记录。可以从矩阵“关系阶段”轨道新增或调整。</p>}
    </>}
  </section>;
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
  const novelPicker = <label className="ba-novel-picker"><span className="sr-only">选择作品</span><select aria-label="选择作品" className="ba-input" value={novelId} onChange={event => {
        if (dirty && !window.confirm("有未保存的编排。切换后可恢复本地编辑，仍要切换作品吗？")) return;
        const next = new URLSearchParams(params); if (event.target.value) next.set("novelId", event.target.value); else next.delete("novelId"); setParams(next);
      }}><option value="">请选择作品</option>{novelId && !novels.some(novel => novel.id === novelId) && <option value={novelId}>{workspace?.title || "当前作品"}</option>}{novels.map(novel => <option key={novel.id} value={novel.id}>{novel.title}</option>)}</select></label>;
  return <main className="book-arrangement-page">
    {!workspace && <header className="ba-toolbar">{novelPicker}<span>全书编排</span></header>}
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
  const [windowSize, setWindowSize] = useState(8);
  const [selectedId, setSelectedId] = useState(initialWorkspace.chapters[0]?.id ?? "");
  const [scope, setScope] = useState<string[]>([]);
  const [rangeFrom, setRangeFrom] = useState(initialWorkspace.chapters[0]?.id ?? "");
  const [rangeTo, setRangeTo] = useState(initialWorkspace.chapters[Math.min(7, initialWorkspace.chapters.length - 1)]?.id ?? "");
  const [spanId, setSpanId] = useState("");
  const [selectedVolumeId, setSelectedVolumeId] = useState("");
  const [volumePreview, setVolumePreview] = useState<BookArrangementVolumePreview | null>(null);
  const [volumeApplied, setVolumeApplied] = useState(false);
  const [volumeSelection, setVolumeSelection] = useState<string[] | null>(null);
  const [characterSearch, setCharacterSearch] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [historySelection, setHistorySelection] = useState(0);
  const [spanSelection, setSpanSelection] = useState(0);
  const [panel, setPanel] = useState<"book" | "relations" | "chapter" | "volume" | "controls" | "planning" | "requirements" | "volume-preview" | "object" | null>(null);
  const [controlKey, setControlKey] = useState<WritingControlKey>();
  const [selectedObject, setSelectedObject] = useState<ArrangementObjectSelection | null>(null);
  const [objectDirty, setObjectDirty] = useState(false);
  const [sceneDirtyIds, setSceneDirtyIds] = useState<Set<string>>(() => new Set());
  const [sceneEditor, setSceneEditor] = useState<{ chapterId: string; sceneId?: string } | null>(null);
  const selectSpan = (id: string, clickedChapterId?: string) => {
    setSpanId(id);
    setHistorySelection(0);
    const span = draft.characterSpans.find(item => item.id === id);
    if (span) {
      setCharacterId(span.characterId);
      const targetChapterId = clickedChapterId && span.chapterIds.includes(clickedChapterId) ? clickedChapterId : span.chapterIds[0];
      if (targetChapterId) selectChapter(targetChapterId);
    }
    setSpanSelection(value => value + 1);
    setPanel("chapter");
  };
  const [preview, setPreview] = useState<BookArrangementPreview | null>(null);
  const [previewSelected, setPreviewSelected] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const keys = useRef(new AdjustmentOperationKeys());
  const inFlight = useRef(false);
  const api = useMemo(() => createBookArrangementApi(workspace.novelId), [workspace.novelId]);
  const dirty = draftDirty(draft, saved.payload);
  const latestDraft = useRef({ draft, saved });
  latestDraft.current = { draft, saved };
  const setChapterSceneDirty = useCallback((chapterId: string, value: boolean) => {
    setSceneDirtyIds(current => {
      if (current.has(chapterId) === value) return current;
      const next = new Set(current);
      if (value) next.add(chapterId); else next.delete(chapterId);
      return next;
    });
  }, []);
  const closePanel = () => {
    if (busy) return;
    setPanel(null); setObjectDirty(false);
  };
  const localKey = `book-arrangement:${workspace.novelId}`;
  const window = chapterWindow(workspace.chapters, windowStart, windowSize);
  const overviewVolumes = workspace.volumes.map(volume => ({ ...volume, chapterIds: draft.volumeEdits?.find(edit => edit.volumeId === volume.id)?.chapterIds ?? volume.chapterIds }));
  const currentVolume = overviewVolumes.find(volume => volume.chapterIds.includes(selectedId));
  const allowed = editableChapterIds(draft, scope);
  useEffect(() => { if (!window.chapters.some(chapter => chapter.id === selectedId)) setSelectedId(window.chapters[0]?.id ?? ""); }, [window.start, selectedId, workspace.chapters]);
  useEffect(() => {
    const selectedSpan = draft.characterSpans.find(item => item.id === spanId);
    if (selectedSpan && !selectedSpan.chapterIds.includes(selectedId)) setSpanId(draft.characterSpans.find(item => item.characterId === selectedSpan.characterId && item.chapterIds.includes(selectedId))?.id ?? "");
  }, [selectedId, spanId, draft.characterSpans]);
  useEffect(() => { onDirty(dirty || Boolean(localDraft) || objectDirty || sceneDirtyIds.size > 0); }, [dirty, localDraft, objectDirty, sceneDirtyIds, onDirty]);
  useEffect(() => {
    if (!dirty) { if (!localDraft) { try { sessionStorage.removeItem(localKey); } catch { /* unavailable storage */ } } return; }
    try { sessionStorage.setItem(localKey, JSON.stringify({ revision: saved.revision, payload: draft })); } catch { /* beforeunload remains active when session storage is unavailable */ }
  }, [draft, dirty, saved.revision, localKey, localDraft]);
  const updateDraft = (value: BookArrangementDraftPayload) => { setDraft(value); setPreview(null); setVolumePreview(null); setApplied(false); setNotice(""); };
  const updateVolume = (edit: BookArrangementVolumeEdit) => {
    setSelectedVolumeId(edit.volumeId);
    updateDraft({ ...draft, volumeEdits: [...(draft.volumeEdits ?? []).filter(item => item.volumeId !== edit.volumeId), edit] });
  };
  const run: ArrangementRun = useCallback(async (operation, input, action) => {
    if (inFlight.current) return undefined;
    inFlight.current = true; setBusy(operation); setError(""); setNotice("");
    const request = keys.current.get(operation, input);
    try { const result = await action(request.key); keys.current.complete(request.identity); return result; }
    catch (failure) { setError(`${errorMessage(failure)} 输入内容已保留。`); return undefined; }
    finally { inFlight.current = false; setBusy(""); }
  }, []);
  const reload = async (discardDraft = false) => {
    const next = await api.workspace();
    const refreshed = refreshArrangementDraft(latestDraft.current, next, discardDraft);
    const { keep, conflict: draftConflict } = refreshed;
    setWorkspace(next);
    setSaved(refreshed.saved); setDraft(refreshed.draft); setPreview(null); setVolumePreview(null); setApplied(false);
    if (!keep && (!localDraft || discardDraft)) { setLocalDraft(null); try { sessionStorage.removeItem(localKey); } catch { /* no persistent local recovery available */ } }
    if (draftConflict) setError("另一个窗口已更新编排草稿。本地编辑与原保存版本已保留；请先比较，或明确放弃本地编辑后重载，避免覆盖他人修改。");
    else if (next.draft.payload.baseRevision !== next.baseRevision) setNotice("资料已刷新，请保存草稿以使用最新章节资料。");
  };
  const save = async () => {
    for (const edit of draft.chapterEdits) { const validation = validateWritingControls(edit.controls); if (validation) { setError(validation); return; } }
    if (draft.characterSpans.some(span => !span.chapterIds.length || (span.weight !== null && (!Number.isFinite(span.weight) || span.weight < 0 || span.weight > 100)))) { setError("人物区段需包含章节，权重请留空或填写 0 至 100。"); return; }
    const occupied = new Set<string>();
    for (const span of draft.characterSpans) for (const id of span.chapterIds) { const identity = `${span.characterId}:${id}`; if (occupied.has(identity)) { setError("同一人物的参与区段不能重叠，请合并或调整范围。"); return; } occupied.add(identity); }
    const input = { expectedRevision: saved.revision, payload: draft };
    const result = await run("保存草稿", input, key => api.saveDraft(input, key));
    if (result) { setSaved(result); setDraft(result.payload); setLocalDraft(null); setPreview(null); setVolumePreview(null); setNotice("编排草稿已保存，刷新后可继续编辑。"); try { sessionStorage.removeItem(localKey); } catch { /* server draft is durable */ } }
    return result;
  };
  const previewVolumes = async (saveFirst = false) => {
    const record = saveFirst ? await save() : saved;
    if (!record) return;
    const volumeIds = (record.payload.volumeEdits ?? []).map(edit => edit.volumeId).filter(id => volumeSelection === null || volumeSelection.includes(id));
    if (!volumeIds.length) { setNotice("请调整卷段后，至少勾选一个待改卷段进行预览。"); setPanel("volume-preview"); return; }
    const input = { draftRevision: record.revision, volumeIds };
    const result = await run("预览卷段调整", input, key => api.previewVolumes(input, key));
    if (result) { setVolumePreview(result); setVolumeApplied(false); setPanel("volume-preview"); }
  };
  const selectChapter = (id: string) => {
    const index = workspace.chapters.findIndex(chapter => chapter.id === id);
    if (index < 0) return;
    setSelectedId(id);
    setSelectedVolumeId("");
    if (!window.chapters.some(chapter => chapter.id === id)) setWindowStart(Math.min(index, Math.max(0, workspace.chapters.length - windowSize)));
  };
  const openChapter = (id: string) => { selectChapter(id); setSpanId(""); setCharacterId(""); setHistorySelection(0); setPanel("chapter"); };
  const addAppearance = () => {
    setSelectedVolumeId("");
    setHistorySelection(0);
    const person = workspace.characters.find(item => item.id === characterId) ?? workspace.characters.find(item => item.name.includes(characterSearch.trim())) ?? workspace.characters[0];
    if (!person || !selectedId) return;
    const chapterIds = editableChapterIds(draft, scope.length ? scope : [selectedId]);
    if (!chapterIds.length) { setNotice("所选章节已锁定，请调整范围后添加出场。"); return; }
    const id = crypto.randomUUID();
    const span = { id, characterId: person.id, chapterIds, mode: "suggested" as const, weight: null, note: "" };
    const invalid = characterSpanError(draft, span);
    if (invalid) { setError(invalid); return; }
    updateDraft({ ...draft, characterSpans: [...draft.characterSpans, span] });
    if (!chapterIds.includes(selectedId)) selectChapter(chapterIds[0]);
    setCharacterId(person.id); setSpanId(id); setSpanSelection(value => value + 1);
    setPanel("chapter");
  };
  const previewRequirements = async () => {
    const input = { draftRevision: saved.revision, chapterIds: scope };
    const result = await run("预览后续要求", input, key => api.preview(input, key));
    if (result) { setPreview(result); setPreviewSelected(result.chapterIds); setApplied(false); setPanel("requirements"); }
  };
  const previewDisabled = Boolean(busy) || dirty || saved.revision === 0 || !allowed.length;
  if (!workspace.chapters.length) return <p className="bg-muted/20 p-6 text-sm">这部作品还没有章节。请先在作品的大纲与章节页面准备章节。</p>;
  return <div className="ba-editor">
    {sceneEditor ? <><ChapterSceneEditor workspace={workspace} chapterId={sceneEditor.chapterId} initialSceneId={sceneEditor.sceneId} busy={Boolean(busy)} run={run} reload={reload} onBack={() => { setSceneEditor(null); setObjectDirty(false); }} onDirty={setChapterSceneDirty} onObject={object => { setSelectedObject(object); setPanel("object"); }} />{error && <p role="alert" className="mx-5 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}{busy && <p role="status" className="mx-5 text-sm text-muted-foreground">{busy}…</p>}</> : <>
    <header className="ba-toolbar">{novelPicker}<label className="ba-character-search"><Search size={16} aria-hidden="true" /><input aria-label="搜索人物，定位出场" placeholder="搜索人物，定位出场" value={characterSearch} onChange={event => setCharacterSearch(event.target.value)} onKeyDown={event => {
      if (event.key !== "Enter" || !characterSearch.trim()) return;
      const person = workspace.characters.find(item => item.name.includes(characterSearch.trim()));
      if (!person) return;
      setCharacterId(person.id);
      const span = draft.characterSpans.find(item => item.characterId === person.id);
      if (span) { selectChapter(span.chapterIds[0]); selectSpan(span.id); }
      else { const record = workspace.events.find(item => item.participantIds.includes(person.id) && item.chapterId); if (record?.chapterId) selectChapter(record.chapterId); setSpanId(""); setHistorySelection(value => value + 1); }
    }} /></label><div className="ba-scope-switcher" aria-label="整书编排入口"><Button size="sm" variant="ghost" onClick={() => setPanel("book")}><BookOpen size={15} />整书资料</Button><Button size="sm" variant="ghost" onClick={() => setPanel("relations")}><Network size={15} />人物关系</Button></div>
      <Button size="sm" variant="secondary" disabled={Boolean(busy) || (!dirty && saved.revision > 0)} onClick={() => void save()}>保存草稿</Button><details className="ba-action-menu"><summary aria-label="更多编排操作"><MoreHorizontal size={17} />更多</summary><div onClick={event => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.parentElement?.removeAttribute("open"); }}><strong>整书与范围</strong><button type="button" onClick={() => setPanel("planning")}>AI 重编排</button><button type="button" onClick={() => setPanel("requirements")}>后续写作要求</button><button type="button" onClick={() => setPanel("volume-preview")}>卷段调整预览</button><strong>新增到当前章</strong>{(["event", "scene", "relation", "hook"] as const).map(kind => <button type="button" key={kind} onClick={() => { setSelectedObject({ kind, id: "new", chapterId: selectedId }); setPanel("object"); }}>{({ event: "事件", scene: "场景", relation: "关系阶段", hook: "伏笔" })[kind]}</button>)}<strong>资料</strong><button type="button" disabled={Boolean(busy)} onClick={() => void run("刷新资料", {}, async () => { await reload(); return true; })}>刷新资料</button></div></details></header>
    {localDraft && <div className="space-y-2 bg-amber-500/10 p-3 text-sm" role="status"><p>找到本作品尚未保存的本地编辑。可以恢复后检查，也可以继续服务端草稿。</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => { if (inFlight.current) return; updateDraft(localDraft.payload); setSaved(current => ({ ...current, revision: localDraft.revision })); setLocalDraft(null); setNotice("本地编辑已恢复，请核对后保存；其他窗口已修改时会提示版本冲突。"); }}>恢复未保存编辑</Button><Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => { if (inFlight.current) return; setLocalDraft(null); try { sessionStorage.removeItem(localKey); } catch { /* unavailable storage */ } }}>使用服务端草稿</Button></div></div>}
    {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {(busy || notice) && <p role="status" className="text-sm text-muted-foreground">{busy ? `${busy}…` : notice}</p>}
    <fieldset disabled={Boolean(busy)} className="ba-layout">
      <div className="ba-workbench">
      <div className="ba-page-heading"><nav aria-label="面包屑" className="ba-breadcrumb"><Link to="/novels">作品</Link><span>/</span><Link to={`/novels/${encodeURIComponent(workspace.novelId)}/edit`}>{workspace.title}</Link><span>/</span><span>全书编排</span></nav><h1>全书编排</h1><p>按章节查看故事安排，点击出场调整人物参与。</p><span className="ba-save-state">{dirty ? "有未保存编辑" : saved.revision === 0 ? "尚未保存编排" : "草稿已保存"}</span></div>
      <section aria-label="全书概览" className="ba-chapter-navigation"><div className="ba-navigation-heading"><h2>章节导航</h2><span>第 {window.chapters[0].order}—{window.chapters.at(-1)!.order} 章 · {window.chapters.length}章</span><small>拖动框体移动，拖两端缩放</small><Button size="sm" variant="ghost" aria-label="上一窗口" disabled={window.start === 0} onClick={() => setWindowStart(Math.max(0, window.start - window.chapters.length))}><ChevronLeft size={16} aria-hidden="true" /></Button><Button size="sm" variant="ghost" aria-label="下一窗口" disabled={window.start + window.chapters.length >= workspace.chapters.length} onClick={() => setWindowStart(window.start + window.chapters.length)}><ChevronRight size={16} aria-hidden="true" /></Button></div>
        <ArrangementChapterNavigator chapters={workspace.chapters} volumes={overviewVolumes} start={window.start} visibleCount={window.chapters.length} selectedId={selectedId} onStart={setWindowStart} onWindow={(start, size) => { setWindowStart(start); setWindowSize(size); }} onSelect={selectChapter} disabled={Boolean(busy)} />
      </section>
      <div className="ba-context-actions"><span>当前：第{workspace.chapters.find(chapter => chapter.id === selectedId)?.order}章{currentVolume ? ` · ${currentVolume.title}` : ""}</span><Button size="sm" variant="ghost" onClick={() => setSceneEditor({ chapterId: selectedId })}>场景编排</Button><Button size="sm" variant="ghost" onClick={() => { setControlKey(undefined); setPanel("controls"); }}>表达参数</Button>{dirty && <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => { if (globalThis.confirm("放弃尚未保存的编排编辑，并载入服务端草稿？")) void run("重载服务端草稿", {}, async () => { await reload(true); return true; }); }}>放弃本地编辑</Button>}</div>
      <details className="ba-scope-picker"><summary>调整范围 · 已选 {scope.length} 章</summary><div className="ba-scope-controls"><label className="flex items-center gap-1"><input type="checkbox" aria-label="勾选当前窗口" checked={window.chapters.every(chapter => scope.includes(chapter.id))} onChange={event => { setScope(event.target.checked ? [...new Set([...scope, ...window.chapters.map(chapter => chapter.id)])] : scope.filter(id => !window.chapters.some(chapter => chapter.id === id))); setPreview(null); }} />当前窗口</label>
        <select aria-label="范围起始章节" className="ba-input ba-inline" value={rangeFrom} onChange={event => setRangeFrom(event.target.value)}>{workspace.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>第 {chapter.order} 章</option>)}</select><span>至</span><select aria-label="范围结束章节" className="ba-input ba-inline" value={rangeTo} onChange={event => setRangeTo(event.target.value)}>{workspace.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>第 {chapter.order} 章</option>)}</select><Button size="sm" variant="ghost" onClick={() => { setScope(chapterRange(workspace.chapters, rangeFrom, rangeTo)); setPreview(null); }}>勾选区间</Button><Button size="sm" variant="ghost" onClick={() => { setScope([]); setPreview(null); }}>清空范围</Button>
      </div></details>
      <div id="ba-chapter-matrix"><ArrangementMatrix workspace={workspace} draft={draft} chapters={window.chapters} selectedId={selectedId} scope={scope} onSelect={openChapter} onScope={ids => { setScope(ids); setPreview(null); }} onSpan={selectSpan} onDraft={updateDraft} characterSearch={characterSearch} onCharacter={(id, chapterId) => { setSelectedVolumeId(""); setCharacterId(id); if (chapterId) selectChapter(chapterId); }} onHistory={(chapterId, personId) => { selectChapter(chapterId); setCharacterId(personId ?? ""); setSpanId(""); setHistorySelection(value => value + 1); setPanel("chapter"); }} selectedVolumeId={selectedVolumeId} onVolume={id => { setSelectedVolumeId(id); setSpanId(""); setPanel("volume"); }} onVolumeEdit={updateVolume} windowStart={window.start} onWindowStart={setWindowStart} onControl={(id, key) => { selectChapter(id); setControlKey(key); setPanel("controls"); }} onObject={object => { if (object.kind === "scene" && object.chapterId) { selectChapter(object.chapterId); setSceneEditor({ chapterId: object.chapterId, sceneId: object.id === "new" ? undefined : object.id }); return; } if (object.chapterId) selectChapter(object.chapterId); setSelectedObject(object); setPanel("object"); }} /></div></div>
    </fieldset></>}
    <Dialog open={panel !== null} onOpenChange={open => { if (!open) closePanel(); }}><AppDialogContent title={panel === "book" ? "整书资料与范围" : panel === "relations" ? "人物关系" : panel === "volume" ? "卷段编排" : panel === "volume-preview" ? "卷段调整预览" : panel === "planning" ? "AI 重编排大纲" : panel === "requirements" ? "后续写作要求" : panel === "controls" ? "表达参数" : panel === "object" ? "故事资料与调整" : "章节与人物编排"} description="查看资料、调整草稿，再预览和应用。关闭面板保留编排草稿。" className="ba-side-dialog" bodyClassName="ba-side-body" onInteractOutside={event => { if (busy) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} footer={<><span className="text-xs text-muted-foreground mr-auto">{panel === "object" ? objectDirty ? "此项编辑已暂存本地，尚未应用" : "对象调整在本面板预览与应用" : dirty ? "有未保存的编排" : saved.revision ? "编排草稿已保存" : "尚未保存编排"}</span><Button variant="outline" disabled={Boolean(busy)} onClick={closePanel}>关闭</Button>{panel !== "object" && panel !== "book" && panel !== "relations" && <Button disabled={Boolean(busy) || (!dirty && saved.revision > 0)} onClick={() => void save()}>保存编排草稿</Button>}</>}>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{(busy || notice) && <p role="status" className="text-sm text-muted-foreground">{busy || notice}</p>}
      <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-4">
      {panel === "book" && <section className="ba-book-scope-panel"><div className="ba-book-facts"><span>题材<strong>{workspace.genre?.name || "未设置"}</strong></span><span>章节<strong>{workspace.chapters.length} 章</strong></span><span>卷段<strong>{workspace.volumes.length} 卷</strong></span><span>人物<strong>{workspace.characters.length} 人</strong></span></div><div className="ba-scope-level"><h3>整书必须明确</h3><p>题材定位、故事主线、世界规则、核心人物和全书终局。它们会影响所有卷和章节。</p><div><Link target="_blank" rel="noreferrer" to={`/novels/${workspace.novelId}/edit?stage=story_macro`}>编辑故事主线</Link><Link target="_blank" rel="noreferrer" to={`/novels/${workspace.novelId}/edit?stage=world`}>编辑世界观与规则</Link><Link target="_blank" rel="noreferrer" to={`/novels/${workspace.novelId}/edit?stage=character`}>编辑核心人物</Link></div></div><div className="ba-scope-level"><h3>卷段需要明确</h3><p>本卷承诺、主角变化、高潮和通往下一卷的衔接。请在矩阵的卷段轨道点击对应卷段修改。</p></div><div className="ba-scope-level"><h3>章节需要明确</h3><p>章节目标、事件、场景、人物参与和表达参数。点击章节名称或矩阵中的具体对象修改。</p></div><p className="ba-panel-note">世界观继续由底座原“世界观准备”维护，避免产生两份互相冲突的世界设定。链接会在新窗口打开，当前编排位置和草稿保留。</p></section>}
      {panel === "relations" && <BookRelationshipPanel workspace={workspace} selectedId={selectedId} onSelectChapter={selectChapter} onOpenRelation={relation => { setSelectedObject({ kind: "relation", id: relation.sourceId, chapterId: relation.chapterId ?? undefined }); setPanel("object"); }} />}
      {(panel === "planning" || panel === "controls" || panel === "requirements") && <section className="space-y-2"><p className="text-sm">调整范围 · 已选 {scope.length} 章，未锁定 {allowed.length} 章</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setScope([selectedId]); setPreview(null); }}>仅当前章</Button><Button size="sm" variant="outline" onClick={() => { setScope(window.chapters.map(chapter => chapter.id)); setPreview(null); }}>当前窗口</Button><Button size="sm" variant="ghost" onClick={() => { setScope([]); setPreview(null); }}>清空</Button></div><details><summary className="text-sm cursor-pointer">选择章节区间</summary><div className="flex flex-wrap items-center gap-2 py-2"><select className="ba-input ba-inline" aria-label="面板范围起始章节" value={rangeFrom} onChange={event => setRangeFrom(event.target.value)}>{workspace.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.order} · {chapter.title}</option>)}</select><span>至</span><select className="ba-input ba-inline" aria-label="面板范围结束章节" value={rangeTo} onChange={event => setRangeTo(event.target.value)}>{workspace.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.order} · {chapter.title}</option>)}</select><Button size="sm" variant="outline" onClick={() => { setScope(chapterRange(workspace.chapters, rangeFrom, rangeTo)); setPreview(null); }}>使用这个区间</Button></div></details></section>}
      {panel === "chapter" && <ArrangementInspector workspace={workspace} draft={draft} selectedId={selectedId} scope={scope} spanId={spanId} spanSelection={spanSelection} onSpan={selectSpan} onDraft={updateDraft} busy={Boolean(busy)} characterId={characterId} historySelection={historySelection} onSelectChapter={selectChapter} onAddAppearance={addAppearance} onScope={ids => { setScope(ids); setPreview(null); }} onPreview={() => void previewRequirements()} previewDisabled={previewDisabled} dirty={dirty} onObject={object => { if (object.kind === "scene" && object.chapterId) { setPanel(null); setSceneEditor({ chapterId: object.chapterId, sceneId: object.id }); return; } setSelectedObject(object); setPanel("object"); }} />}
      {panel === "controls" && <ArrangementControlsPanel key={`${selectedId}:${controlKey ?? "all"}`} workspace={workspace} draft={draft} chapterId={selectedId} controlKey={controlKey} scope={scope} onDraft={updateDraft} />}
      {panel === "object" && selectedObject && <ArrangementObjectPanel key={`${workspace.novelId}:${selectedObject.kind}:${selectedObject.id}:${selectedObject.chapterId ?? ""}`} selectedObject={selectedObject} workspace={workspace} run={run} busy={Boolean(busy)} reload={reload} onClose={closePanel} onDirtyChange={setObjectDirty} />}
      {panel === "volume" && selectedVolumeId && <ArrangementVolumeInspector workspace={{ ...workspace, draft: { ...saved, payload: draft } }} volumeId={selectedVolumeId} edit={draft.volumeEdits?.find(edit => edit.volumeId === selectedVolumeId)} busy={Boolean(busy)} dirty={dirty} onChange={updateVolume} onRevert={() => updateDraft({ ...draft, volumeEdits: (draft.volumeEdits ?? []).filter(edit => edit.volumeId !== selectedVolumeId) })} onPreview={() => void previewVolumes()} onSaveAndPreview={() => void previewVolumes(true)} previewDisabled={!draft.volumeEdits?.length} onClose={() => setPanel("chapter")} />}
      {panel === "volume-preview" && <><fieldset className="space-y-2"><legend className="text-sm">选择要预览的待改卷段</legend>{(draft.volumeEdits ?? []).map(edit => <label className="flex items-center gap-2 text-sm" key={edit.volumeId}><input type="checkbox" aria-label={`预览卷段${edit.title}`} checked={volumeSelection === null || volumeSelection.includes(edit.volumeId)} onChange={event => { const current = volumeSelection ?? (draft.volumeEdits ?? []).map(item => item.volumeId); setVolumeSelection(event.target.checked ? [...current, edit.volumeId] : current.filter(id => id !== edit.volumeId)); setVolumePreview(null); }} />{edit.title}<Button size="sm" variant="ghost" onClick={() => { setSelectedVolumeId(edit.volumeId); setPanel("volume"); }}>继续调整</Button></label>)}</fieldset>
    {(workspace.volumePreviews?.length ?? 0) > 0 && <select aria-label="恢复卷段调整预览" className="ba-input" value="" disabled={Boolean(busy) || dirty} onChange={event => { const item = workspace.volumePreviews?.find(entry => entry.id === event.target.value); if (item) { setVolumePreview(item); setVolumeApplied(false); } }}><option value="">恢复已保存的卷段调整预览</option>{workspace.volumePreviews?.map(item => <option key={item.id} value={item.id}>{item.changes.map(change => change.after.title).join("、")} · 草稿 {item.draftRevision}</option>)}</select>}
    {volumePreview && <ArrangementVolumePreview workspace={workspace} currentDraftRevision={saved.revision} preview={volumePreview} onVolume={id => { setSelectedVolumeId(id); setPanel("volume"); }} onChapter={openChapter} busy={Boolean(busy)} disabled={dirty} applied={volumeApplied} onApply={() => void (async () => {
      const result = await run("应用卷段调整", { id: volumePreview.id }, key => api.applyVolumes(volumePreview.id, key));
      if (result) {
        setVolumeApplied(true); setNotice("卷段规划已应用，正在刷新资料。");
        await run("刷新卷段资料", { id: result.id }, async () => { await reload(); setNotice("卷段规划已应用，已有正文与阅读顺序保持原样。"); return true; });
      }
    })()} />}
    {!volumePreview && <p>调整卷段并保存草稿后，预览影响范围。</p>}<Button variant="outline" disabled={Boolean(busy) || !draft.volumeEdits?.length || (volumeSelection !== null && !draft.volumeEdits.some(edit => volumeSelection.includes(edit.volumeId)))} onClick={() => void previewVolumes(dirty)}>保存并预览卷段</Button></>}
    {panel === "requirements" && <><p className="text-sm text-muted-foreground">应用的要求会在章节的人工调整中生成时沿用，历史正文保持原样。已选 {scope.length} 章。</p><Button disabled={previewDisabled} onClick={() => void previewRequirements()}>预览后续要求</Button>{dirty && <p>请先保存编排草稿。</p>}
    {workspace.previews.length > 0 && <select aria-label="恢复后续要求预览" className="ba-input" value="" disabled={Boolean(busy) || dirty} onChange={event => { const item = workspace.previews.find(entry => entry.id === event.target.value); if (item) { setPreview(item); setPreviewSelected(item.chapterIds); setApplied(false); } }}><option value="">恢复已保存的后续要求预览</option>{workspace.previews.map(item => <option key={item.id} value={item.id}>{item.chapterIds.map(id => workspace.chapters.find(chapter => chapter.id === id)?.title ?? id).join("、")}</option>)}</select>}
    {preview && <ArrangementPreview preview={preview} workspace={workspace} selected={previewSelected} onSelected={setPreviewSelected} disabled={Boolean(busy) || dirty || preview.baseRevision !== workspace.baseRevision} applied={applied} onApply={() => void (async () => { const input = { chapterIds: previewSelected }; const result = await run("应用所选章节要求", { id: preview.id, ...input }, key => api.apply(preview.id, input, key)); if (result) { setApplied(true); setWorkspace(current => ({ ...current, appliedSettings: { ...current.appliedSettings, ...result.appliedSettings } })); setNotice("所选章节的后续要求已应用，历史正文保持原样。"); } })()} />}
    </>}
    {panel === "planning" && <ArrangementPlanning workspace={workspace} draft={draft} scope={scope} dirty={dirty || saved.revision === 0} busy={Boolean(busy)} run={run} reload={reload} />}
    </fieldset></AppDialogContent></Dialog>
  </div>;
}
