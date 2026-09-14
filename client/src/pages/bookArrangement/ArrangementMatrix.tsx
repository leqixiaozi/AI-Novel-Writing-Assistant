import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookmarkPlus, CalendarPlus, ChevronDown, ChevronRight, Circle, Diamond, FilePenLine, LayoutList, LockKeyhole, Network, Plus } from "lucide-react";
import type { BookArrangementDraftPayload, BookArrangementVolumeEdit, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { SCENE_EXPRESSION_DIMENSIONS, type SceneExpressionDimensionKey, type SceneExpressionLevel, type SceneExpressionPointInput } from "@ai-novel/shared/types/sceneExpressionTracks";
import { Button } from "@/components/ui/button";
import { auditDimension, auditDimensions, auditHeatState, auditIssueTitle, chapterEdit, characterPresenceEntries, characterTrackColor, eventStatusLabels, packChapterLanes, presenceLabels, type ChapterLaneSegment } from "./arrangementState";
import { ArrangementVolumeTrack } from "./volume/ArrangementVolumeTrack";
import type { ArrangementObjectSelection } from "./objects/ArrangementObjectPanel";
import { ArrangementPresenceBlock } from "./panels/ArrangementPresenceBlock";
import { ArrangementCurveCell } from "./controls/ArrangementCurveCell";
import { chapterSceneGroups, expressionPoint, expressionPointKey, sceneExpressionCurveSegments, setExpressionPoint } from "./controls/sceneExpressionState";

interface Props {
  workspace: BookArrangementWorkspace; draft: BookArrangementDraftPayload; chapters: BookArrangementWorkspace["chapters"];
  selectedId: string; onSelect: (id: string) => void;
  onSpan: (id: string, chapterId?: string) => void; onDraft: (draft: BookArrangementDraftPayload) => void;
  characterSearch?: string; onCharacter?: (characterId: string, chapterId?: string) => void; onHistory?: (chapterId: string, characterId?: string) => void;
  selectedVolumeId?: string; onVolume?: (id: string) => void; onVolumeEdit?: (edit: BookArrangementVolumeEdit) => void; windowStart?: number; onWindowStart?: (index: number) => void;
  expressionPoints: SceneExpressionPointInput[];
  selectedExpression?: string;
  onExpressionPoints: (points: SceneExpressionPointInput[]) => void;
  onExpressionSelect: (sceneId: string, dimensionKey: SceneExpressionDimensionKey, open: boolean) => void;
  onObject?: (object: ArrangementObjectSelection) => void;
  onChapterMenuAction?: (action: ChapterMenuAction, chapterId: string) => void;
}

export type ChapterMenuAction = "chapter" | "scenes" | "add-scene" | "add-event" | "add-relation" | "add-hook";

const auditHeatLabels = { empty: "暂无结果", handled: "已处理", low: "轻微", medium: "需留意", high: "高风险", critical: "严重" } as const;
const handledCheckStatuses = new Set(["resolved", "ignored", "closed"]);
const collapsibleGroups = ["volumes", "events", "people", "relationships", "threads", "controls", "reviews"] as const;

/** Pointer position chooses the shared chapter column; keyboard retains the visible selection. */
function clickedChapter(event: MouseEvent<HTMLButtonElement>, chapterIds: string[], selectedId: string): string {
  if (event.detail === 0) return chapterIds.includes(selectedId) ? selectedId : chapterIds[0];
  const box = event.currentTarget.getBoundingClientRect();
  const index = Math.max(0, Math.min(chapterIds.length - 1, Math.floor((event.clientX - box.left) / Math.max(1, box.width) * chapterIds.length)));
  return chapterIds[index];
}

export function ArrangementMatrix({ workspace, draft, chapters, selectedId, onSelect, onSpan, onDraft, characterSearch = "", onCharacter, onHistory, selectedVolumeId, onVolume, onVolumeEdit, windowStart, onWindowStart, expressionPoints, selectedExpression, onExpressionPoints, onExpressionSelect, onObject, onChapterMenuAction }: Props) {
  const [groups, setGroups] = useState<Record<string, boolean>>({});
  const [personFilter, setPersonFilter] = useState("");
  const [allPresence, setAllPresence] = useState(false);
  const [allRelations, setAllRelations] = useState(false);
  const [allClues, setAllClues] = useState(false);
  const [expandedCells, setExpandedCells] = useState<Record<string, boolean>>({});
  const [chapterMenu, setChapterMenu] = useState<{ chapterId: string; x: number; y: number } | null>(null);
  const [matrixScrollLeft, setMatrixScrollLeft] = useState(0);
  const chapterMenuRef = useRef<HTMLDivElement>(null);
  const allGroupsCollapsed = collapsibleGroups.every(key => groups[key]);
  const configuredTracks = draft.pinnedTracks.filter((key): key is SceneExpressionDimensionKey => SCENE_EXPRESSION_DIMENSIONS.some(dimension => dimension.key === key));
  const visibleTracks = configuredTracks.length ? configuredTracks : SCENE_EXPRESSION_DIMENSIONS.map(dimension => dimension.key);
  const sceneGroups = chapterSceneGroups(chapters, workspace.scenes);
  const visibleScenes = sceneGroups.flatMap(group => group.scenes);
  const toggle = (key: string) => setGroups({ ...groups, [key]: !groups[key] });
  const presence = characterPresenceEntries(workspace, draft).filter(entry => (!personFilter || entry.characterId === personFilter) && (!characterSearch.trim() || entry.name.toLocaleLowerCase().includes(characterSearch.trim().toLocaleLowerCase())));
  const packedPresence = packChapterLanes(chapters, presence);
  const visiblePresence = allPresence ? packedPresence : packedPresence.filter(segment => segment.lane < 3);
  const hiddenPresence = packedPresence.length - visiblePresence.length;
  const volumes = packChapterLanes(chapters, workspace.volumes.map(volume => ({ ...volume, chapterIds: draft.volumeEdits?.find(edit => edit.volumeId === volume.id)?.chapterIds ?? volume.chapterIds })));
  const packedRelations = packChapterLanes(chapters, workspace.relations ?? []);
  const packedClues = packChapterLanes(chapters, workspace.clues ?? []);
  const relations = allRelations ? packedRelations : packedRelations.filter(segment => segment.lane < 3);
  const clues = allClues ? packedClues : packedClues.filter(segment => segment.lane < 3);
  const rowCount = <T,>(segments: ChapterLaneSegment<T>[]) => Math.max(1, ...segments.map(segment => segment.lane + 1));
  const plotStyle = <T,>(segments: ChapterLaneSegment<T>[]): CSSProperties => ({ "--ba-lanes": rowCount(segments), "--ba-count": chapters.length } as CSSProperties);
  const segmentStyle = (segment: { start: number; end: number; lane: number }, color?: string): CSSProperties => ({ gridColumn: `${segment.start + 1} / span ${segment.end - segment.start + 1}`, gridRow: segment.lane + 1, "--ba-color": color } as CSSProperties);
  const chapterLabel = (ids: string[]) => ids.map(id => workspace.chapters.find(chapter => chapter.id === id)?.order).filter(order => order !== undefined).join("、");
  const participantText = (ids: string[]) => ids.map(id => workspace.characters.find(person => person.id === id)?.name).filter(Boolean).join("、") || "未标参与人物";
  const history = (chapterId: string, characterId?: string) => { onSelect(chapterId); onHistory?.(chapterId, characterId); };
  const expandCell = (key: string, expanded: boolean) => setExpandedCells(current => ({ ...current, [key]: expanded }));
  const label = (key: string, title: string, detail?: string) => <button type="button" className="ba-label ba-section-label" aria-expanded={!groups[key]} onClick={() => toggle(key)}>{groups[key] ? <ChevronRight size={15} /> : <ChevronDown size={15} />}<span>{title}{detail && <small>{detail}</small>}</span></button>;
  const guides = () => <div className="ba-plot-guides" aria-hidden="true">{chapters.map(chapter => <span key={chapter.id} data-chapter-id={chapter.id} className={chapter.id === selectedId ? "is-selected" : ""} />)}</div>;
  const empty = (text: string) => <p className="ba-track-empty">{text}</p>;
  const openChapterMenu = (chapterId: string, x: number, y: number) => setChapterMenu({ chapterId, x: Math.min(x, window.innerWidth - 232), y: Math.min(y, window.innerHeight - 330) });
  const cell = (chapterId: string, content: ReactNode, className = "") => {
    const menuCell = className.includes("ba-event-scene-cell");
    return <div key={chapterId} data-chapter-id={chapterId} className={`ba-cell ${className} ${chapterId === selectedId ? "is-selected" : ""}`} tabIndex={menuCell ? 0 : undefined} onPointerDown={menuCell ? event => { if (event.button === 2) { event.preventDefault(); event.stopPropagation(); openChapterMenu(chapterId, event.clientX, event.clientY); } } : undefined} onContextMenu={menuCell ? event => { event.preventDefault(); event.stopPropagation(); openChapterMenu(chapterId, event.clientX, event.clientY); } : undefined} onKeyDown={menuCell ? event => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      openChapterMenu(chapterId, box.left + Math.min(box.width / 2, 80), box.top + Math.min(box.height / 2, 80));
    } : undefined}>{content}</div>;
  };
  useEffect(() => {
    if (!chapterMenu) return;
    const close = (event: PointerEvent) => { if (!chapterMenuRef.current?.contains(event.target as Node)) setChapterMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setChapterMenu(null); };
    const dismiss = () => setChapterMenu(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    chapterMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss, true); };
  }, [chapterMenu]);
  const runChapterMenuAction = (action: ChapterMenuAction) => {
    if (!chapterMenu) return;
    onChapterMenuAction?.(action, chapterMenu.chapterId);
    setChapterMenu(null);
  };

  return <><section aria-label="章节对齐编排矩阵" className="ba-matrix-section">
    <div className="ba-matrix-toolbar">
      <label>人物筛选 <select aria-label="人物筛选" className="ba-input ba-inline" value={personFilter} onChange={event => { setPersonFilter(event.target.value); setAllPresence(false); if (event.target.value) onCharacter?.(event.target.value); }}><option value="">全部人物</option>{workspace.characters.map(person => <option key={person.id} value={person.id}>{person.name}{person.role ? ` · ${person.role}` : ""}</option>)}</select></label>
      <Button size="sm" variant="ghost" aria-label={allGroupsCollapsed ? "展开全部编排轨道" : "折叠全部编排轨道"} onClick={() => setGroups(allGroupsCollapsed ? {} : Object.fromEntries(collapsibleGroups.map(key => [key, true])))}>{allGroupsCollapsed ? "全部展开" : "全部折叠"}</Button>
    </div>
    <div className="ba-sticky-chapter-head">
      <div className="ba-sticky-chapter-head-inner" style={{ "--ba-count": chapters.length, transform: `translateX(${-matrixScrollLeft}px)` } as CSSProperties}>
        <div className="ba-label ba-head">章节</div>
        {chapters.map(chapter => <button type="button" key={chapter.id} data-chapter-id={chapter.id} className={`ba-cell ba-head ${selectedId === chapter.id ? "is-selected" : ""}`} aria-label={`选择第${chapter.order}章 · ${chapter.title}`} title={`第${chapter.order}章 · ${chapter.title}`} onClick={() => onSelect(chapter.id)}>
          <span className="ba-chapter-heading"><span className="ba-chapter-number">{chapter.order} ·</span><span className="ba-chapter-title">{chapter.title}</span>{chapterEdit(draft, chapter.id).locked && <LockKeyhole size={12} aria-label="已锁定编排" />}</span>
          <span className={`ba-chapter-state ${chapter.hasContent ? "is-written" : "is-pending"}`}>{chapter.hasContent ? "已写" : "待写"}</span>
        </button>)}
      </div>
    </div>
    <div className="book-arrangement-scroll" tabIndex={0} aria-label="章节矩阵，可横向滚动" onScroll={event => setMatrixScrollLeft(event.currentTarget.scrollLeft)}>
      <div className="ba-matrix ba-compact-matrix" style={{ "--ba-count": chapters.length } as CSSProperties}>
        {label("volumes", "卷段", `${new Set(volumes.map(segment => segment.source.id)).size} 卷`)}
        <div className="ba-track-content">{!groups.volumes && <ArrangementVolumeTrack workspace={workspace} draft={draft} chapters={chapters} selectedChapterId={selectedId} selectedVolumeId={selectedVolumeId} onVolume={onVolume} onVolumeEdit={onVolumeEdit} windowStart={windowStart} onWindowStart={onWindowStart} />}</div>

        {label("events", "事件 / 场景", `${workspace.scenes.filter(scene => chapters.some(chapter => chapter.id === scene.chapterId)).length} 个场景`)}
        {groups.events ? <div className="ba-track-content" /> : chapters.map(chapter => { const events = workspace.events.filter(event => event.chapterId === chapter.id); const scenes = workspace.scenes.filter(scene => scene.chapterId === chapter.id).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)); const eventKey = `event:${chapter.id}`, sceneKey = `scene:${chapter.id}`; const eventsExpanded = Boolean(expandedCells[eventKey]), scenesExpanded = Boolean(expandedCells[sceneKey]); const visibleEvents = eventsExpanded ? events : events.slice(0, 3), visibleScenes = scenesExpanded ? scenes : scenes.slice(0, 3); return cell(chapter.id, <>
          <span className="ba-event-dots">{visibleEvents.map(event => <button type="button" className="ba-event-chip ba-object-marker" aria-label={`查看事件 ${event.title}`} title={`${event.title} · ${eventStatusLabels[event.status] || "状态未标注"}\n${event.summary || "尚未填写事件摘要"}`} key={event.id} onClick={() => onObject?.({ kind: "event", id: event.id, chapterId: chapter.id })}><Circle size={10} fill={event.status === "occurred" || event.status === "resolved" ? "currentColor" : "none"} /><span className="ba-event-title">{event.title}</span><span className="ba-object-tooltip" role="tooltip"><small>{eventStatusLabels[event.status] || "状态未标注"} · {participantText(event.participantIds)}</small><span>{event.summary || "尚未填写事件摘要"}</span></span></button>)}{events.length > 3 && <button type="button" className="ba-event-more" aria-expanded={eventsExpanded} aria-label={`${eventsExpanded ? "收起" : "展开"}第${chapter.order}章全部事件`} onClick={() => expandCell(eventKey, !eventsExpanded)}>{eventsExpanded ? "收起" : `+${events.length - 3} 更多`}</button>}{!events.length && <button type="button" className="ba-unset" onClick={() => onObject?.({ kind: "event", id: "new", chapterId: chapter.id })}>+ 事件</button>}</span>
          <span className="ba-scene-tags">{visibleScenes.map(scene => { const index = scenes.indexOf(scene); return <button type="button" key={scene.id} className="ba-scene ba-object-marker" aria-label={`查看场景 ${scene.title}`} title={`${scene.title} · 约 ${scene.targetWordCount} 字\n${scene.objective || scene.conflict || "尚未填写场景任务"}`} onClick={() => onObject?.({ kind: "scene", id: scene.id, chapterId: chapter.id })}><b>S{index + 1}</b><span className="ba-scene-title">{scene.title}</span><span className="ba-object-tooltip" role="tooltip"><strong>S{index + 1} · {scene.title}</strong><small>约 {scene.targetWordCount} 字</small><span>{scene.objective || scene.conflict || "尚未填写场景任务"}</span></span></button>; })}{scenes.length > 3 && <button type="button" className="ba-scene-more" aria-expanded={scenesExpanded} aria-label={`${scenesExpanded ? "收起" : "展开"}第${chapter.order}章全部场景`} onClick={() => expandCell(sceneKey, !scenesExpanded)}>{scenesExpanded ? "收起" : `+${scenes.length - 3} 更多`}</button>}{!scenes.length && <button type="button" className="ba-unset" onClick={() => onObject?.({ kind: "scene", id: "new", chapterId: chapter.id })}>+ 场景</button>}</span>
        </>, "ba-event-scene-cell"); })}

        {label("people", "人物出场", "按出场排列")}
        <div className="ba-track-content ba-presence-content">{!groups.people && <>
          <div className="ba-presence-legend"><span><Circle size={9} fill="currentColor" />实线：历史记录</span><span><Circle size={9} />虚线：计划安排</span></div>
          {visiblePresence.length ? <div className="ba-packed-plot ba-presence-plot" style={plotStyle(visiblePresence)}>{guides()}{visiblePresence.map(segment => {
            const entry = segment.source;
            const span = draft.characterSpans.find(item => item.id === entry.spanId);
            if (entry.kind === "plan" && span) return <ArrangementPresenceBlock key={segment.segmentId} span={span} draft={draft} workspace={workspace} visibleIds={segment.chapterIds} style={segmentStyle(segment, characterTrackColor(entry.characterId))} name={entry.name} onDraft={onDraft} onSelect={onSpan} />;
            return <button key={segment.segmentId} type="button" className={`ba-presence-block ${entry.kind === "plan" ? "is-plan" : "is-record"} ${entry.mode === "forbidden" ? "is-forbidden" : ""} ${segment.chapterIds.includes(selectedId) ? "covers-selected" : ""}`} data-kind={entry.kind} data-character-id={entry.characterId} data-span-id={entry.spanId} data-chapter-ids={segment.chapterIds.join(",")} aria-label={`${entry.name}第${chapterLabel(segment.chapterIds)}章${entry.kind === "plan" ? "计划区段" : "历史记录"}`} style={segmentStyle(segment, characterTrackColor(entry.characterId))} title={`${entry.name} · ${entry.kind === "record" ? "历史记录" : presenceLabels[entry.mode!]}${entry.weight === null ? "" : ` · 权重 ${entry.weight}`}\n${entry.note}`} onClick={event => {
              const id = clickedChapter(event, segment.chapterIds, selectedId);
              if (entry.kind === "record") history(id, entry.characterId);
              else { onSelect(id); onSpan(entry.spanId!, id); }
            }}><Circle size={9} fill={entry.kind === "record" ? "currentColor" : "none"} /><span>{entry.name}{entry.mode === "forbidden" ? " · 不出场" : ""}</span></button>;
          })}</div> : empty(characterSearch || personFilter ? "当前范围没有符合筛选的人物记录或计划" : "当前章节没有人物参与记录或计划区段")}
          {hiddenPresence > 0 && <button className="ba-presence-more" type="button" onClick={() => setAllPresence(true)}>另 {hiddenPresence} 个区段 <ChevronDown size={13} /></button>}
          {allPresence && packedPresence.some(segment => segment.lane >= 3) && <button className="ba-presence-more" type="button" onClick={() => setAllPresence(false)}>收起更多区段</button>}
          <p className="ba-track-caption">只显示当前章节范围内的记录与计划；未参与人物不占行。</p>
        </>}</div>

        {label("relationships", "关系阶段", `${new Set(packedRelations.map(segment => segment.source.id)).size} 项`)}
        <div className="ba-track-content">{!groups.relationships && <>{relations.length ? <div className="ba-packed-plot ba-relation-plot" style={plotStyle(relations)}>{guides()}{relations.map(segment => <button type="button" key={segment.segmentId} className={`ba-evidence-block ${segment.source.basis === "plan" ? "is-plan" : "is-record"}`} data-source-id={segment.source.id} style={segmentStyle(segment, segment.source.basis === "plan" ? "#9964d9" : "#3b82f6")} title={`${segment.source.title}\n${segment.source.evidenceLabel}\n${segment.source.summary}`} onClick={event => onObject?.({ kind: "relation", id: segment.source.sourceId, chapterId: clickedChapter(event, segment.chapterIds, selectedId) })}><Diamond size={14} fill={segment.source.basis === "plan" ? "none" : "currentColor"} /><span>{segment.source.title}<small>{segment.source.evidenceLabel}</small></span></button>)}</div> : empty("当前范围暂无关系阶段资料")}{packedRelations.length > relations.length && <button type="button" className="ba-presence-more" onClick={() => setAllRelations(true)}>另 {packedRelations.length - relations.length} 个关系区段 <ChevronDown size={13} /></button>}{allRelations && packedRelations.some(segment => segment.lane >= 3) && <button type="button" className="ba-presence-more" onClick={() => setAllRelations(false)}>收起更多关系</button>}</>}</div>

        {label("threads", "线索与伏笔", `${new Set(packedClues.map(segment => segment.source.id)).size} 项`)}
        <div className="ba-track-content">{!groups.threads && <>{clues.length ? <div className="ba-packed-plot ba-clue-plot" style={plotStyle(clues)}>{guides()}{clues.map(segment => <button type="button" key={segment.segmentId} className={`ba-evidence-block ${segment.source.basis === "plan" ? "is-plan" : "is-record"}`} data-source-id={segment.source.id} style={segmentStyle(segment, segment.source.payoffChapterId ? "#e45b59" : "#18a68a")} title={`${segment.source.title}\n${segment.source.evidenceLabel}\n${segment.source.summary}`} onClick={event => onObject?.({ kind: segment.source.sourceEntity === "TimelineHook" ? "hook" : "foreshadow", id: segment.source.sourceId, chapterId: clickedChapter(event, segment.chapterIds, selectedId) })}><Diamond size={14} fill={segment.source.basis === "plan" ? "none" : "currentColor"} /><span>{segment.source.title}<small>{segment.source.evidenceLabel}</small></span></button>)}</div> : empty("当前范围暂无可定位的线索与伏笔")}{packedClues.length > clues.length && <button type="button" className="ba-presence-more" onClick={() => setAllClues(true)}>另 {packedClues.length - clues.length} 个线索区段 <ChevronDown size={13} /></button>}{allClues && packedClues.some(segment => segment.lane >= 3) && <button type="button" className="ba-presence-more" onClick={() => setAllClues(false)}>收起更多线索</button>}</>}</div>

        <button type="button" className="ba-label ba-section-label ba-expression-section-label" aria-expanded={!groups.controls} onClick={() => toggle("controls")}>
          <span className="ba-expression-section-title">{groups.controls ? <ChevronRight size={15} /> : <ChevronDown size={15} />}<span>场景表达轨道<small>{visibleTracks.length} 条 · {visibleScenes.length} 个场景点</small></span></span>
          {!groups.controls && <span className="ba-expression-dimension-gutter" style={{ "--ba-track-count": visibleTracks.length } as CSSProperties} aria-hidden="true">{SCENE_EXPRESSION_DIMENSIONS.filter(track => visibleTracks.includes(track.key)).map(track => <i key={track.key} className={`is-${track.color}`}>{track.label}</i>)}</span>}
        </button>
        <div className="ba-track-content ba-controls-content">{!groups.controls && <div className="ba-scene-track-scroll" style={{ "--ba-count": Math.max(1, chapters.length) } as CSSProperties}>
          {SCENE_EXPRESSION_DIMENSIONS.filter(track => visibleTracks.includes(track.key)).map(track => {
            return <div key={track.key} className={`ba-control-track is-${track.color}`}><div className="ba-curve">
              <svg aria-label={`${track.label}场景曲线，未设置处断线`} viewBox={`0 0 ${Math.max(1, chapters.length) * 100} 62`} preserveAspectRatio="none">{sceneExpressionCurveSegments(visibleScenes.map(scene => ({ x: scene.curveX, level: expressionPoint(expressionPoints, scene.id, track.key)?.level ?? null }))).map((segment, index) => <polyline key={index} fill="none" stroke={`var(--ba-${track.color})`} strokeWidth="2" vectorEffect="non-scaling-stroke" points={segment.map(point => `${point.x},${point.y}`).join(" ")} />)}</svg>
              {sceneGroups.map(group => <div key={group.chapter.id} className="ba-curve-chapter" data-chapter-id={group.chapter.id}>{group.scenes.map((scene, sceneIndex) => { const point = expressionPoint(expressionPoints, scene.id, track.key); const binding = expressionPointKey(scene.id, track.key); return <ArrangementCurveCell key={binding} chapterOrder={group.chapter.order} sceneOrder={scene.sortOrder} sceneIndex={sceneIndex} sceneCount={group.scenes.length} scene={scene} dimension={track} level={point?.level ?? null} note={point?.note ?? null} selected={selectedExpression === binding} onSelect={() => onExpressionSelect(scene.id, track.key, false)} onOpen={() => onExpressionSelect(scene.id, track.key, true)} onChange={(level: SceneExpressionLevel) => onExpressionPoints(setExpressionPoint(expressionPoints, { sceneId: scene.id, dimensionKey: track.key, level, note: point?.note ?? null }))} />; })}</div>)}
            </div></div>;
          })}
          {!visibleScenes.length && <p className="ba-track-empty">当前章节范围没有可绑定的场景，请先完成场景编排。</p>}
        </div>}</div>

        <button type="button" className="ba-label ba-section-label ba-audit-label" aria-expanded={!groups.reviews} onClick={() => toggle("reviews")}>
          {groups.reviews ? <ChevronRight size={15} /> : <ChevronDown size={15} />}<span>核对结果{!groups.reviews && <span className="ba-audit-dimension-list">{auditDimensions.map(dimension => <i key={dimension.key}>{dimension.label}</i>)}</span>}</span>
        </button>
        {groups.reviews ? <div className="ba-track-content" /> : <div className="ba-track-content ba-audit-heatmap" style={{ "--ba-count": chapters.length } as CSSProperties}><div className="ba-audit-summary" aria-label="核对结果图例"><span className="is-handled">已处理</span><span className="is-low">轻微</span><span className="is-medium">留意</span><span className="is-high">高风险</span><span className="is-critical">严重</span></div>{auditDimensions.flatMap(dimension => chapters.map(chapter => {
          const checks = (workspace.checks ?? []).filter(check => check.chapterIds.includes(chapter.id) && auditDimension(check) === dimension.key);
          const state = auditHeatState(checks);
          const openCount = checks.filter(check => !handledCheckStatuses.has(check.status.toLocaleLowerCase())).length;
          const target = checks.find(check => !handledCheckStatuses.has(check.status.toLocaleLowerCase())) ?? checks[0];
          const detail = checks.length ? `${checks.length} 项；${checks.slice(0, 3).map(auditIssueTitle).join("、")}${checks.length > 3 ? "等" : ""}` : "尚无此类核对结果";
          return <button key={`${dimension.key}:${chapter.id}`} type="button" className={`ba-audit-cell is-${state} ${chapter.id === selectedId ? "is-selected" : ""}`} data-state={state} disabled={!target} aria-label={`第${chapter.order}章 ${dimension.label}：${auditHeatLabels[state]}，${detail}`} title={`第${chapter.order}章 · ${dimension.label}\n${auditHeatLabels[state]} · ${detail}`} onClick={() => target && onObject?.({ kind: "check", id: target.sourceId, chapterId: chapter.id })}><span>{state === "handled" ? "✓" : openCount || "—"}</span></button>;
        }))}</div>}
      </div>
    </div>
  </section>{chapterMenu && typeof document !== "undefined" && createPortal(<div ref={chapterMenuRef} role="menu" aria-label="章节快捷编辑" className="ba-chapter-context-menu" style={{ left: Math.max(8, chapterMenu.x), top: Math.max(8, chapterMenu.y) }}>
    <header><small>快捷编辑</small><strong>第 {workspace.chapters.find(chapter => chapter.id === chapterMenu.chapterId)?.order} 章 · {workspace.chapters.find(chapter => chapter.id === chapterMenu.chapterId)?.title}</strong></header>
    <button type="button" role="menuitem" onPointerDown={event => { if (event.button === 0) runChapterMenuAction("chapter"); }} onClick={() => runChapterMenuAction("chapter")}><FilePenLine size={16} /><span>章节设置<small>目标、人物与章节边界</small></span></button>
    <button type="button" role="menuitem" onPointerDown={event => { if (event.button === 0) runChapterMenuAction("scenes"); }} onClick={() => runChapterMenuAction("scenes")}><LayoutList size={16} /><span>编排本章场景<small>顺序、篇幅与场景内容</small></span></button>
    <div className="ba-chapter-context-separator" role="separator" />
    <button type="button" role="menuitem" onPointerDown={event => { if (event.button === 0) runChapterMenuAction("add-scene"); }} onClick={() => runChapterMenuAction("add-scene")}><Plus size={16} /><span>新增场景</span></button>
    <button type="button" role="menuitem" onPointerDown={event => { if (event.button === 0) runChapterMenuAction("add-event"); }} onClick={() => runChapterMenuAction("add-event")}><CalendarPlus size={16} /><span>新增事件</span></button>
    <button type="button" role="menuitem" onPointerDown={event => { if (event.button === 0) runChapterMenuAction("add-relation"); }} onClick={() => runChapterMenuAction("add-relation")}><Network size={16} /><span>新增关系阶段</span></button>
    <button type="button" role="menuitem" onPointerDown={event => { if (event.button === 0) runChapterMenuAction("add-hook"); }} onClick={() => runChapterMenuAction("add-hook")}><BookmarkPlus size={16} /><span>新增伏笔</span></button>
  </div>, document.body)}</>;
}
