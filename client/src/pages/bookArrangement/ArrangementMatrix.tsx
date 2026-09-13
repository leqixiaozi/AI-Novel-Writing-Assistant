import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Diamond, LockKeyhole, SlidersHorizontal, TriangleAlert } from "lucide-react";
import type { BookArrangementDraftPayload, BookArrangementVolumeEdit, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { Button } from "@/components/ui/button";
import { arrangementTracks, chapterEdit, characterPresenceEntries, characterTrackColor, controlValue, curveSegments, eventStatusLabels, packChapterLanes, presenceLabels, type ChapterLaneSegment } from "./arrangementState";
import { ArrangementVolumeTrack } from "./volume/ArrangementVolumeTrack";
import type { WritingControlKey } from "@ai-novel/shared/types/writingAdjustments";
import type { ArrangementObjectSelection } from "./objects/ArrangementObjectPanel";
import { ArrangementPresenceBlock } from "./panels/ArrangementPresenceBlock";
import { ArrangementCurveCell } from "./controls/ArrangementCurveCell";

interface Props {
  workspace: BookArrangementWorkspace; draft: BookArrangementDraftPayload; chapters: BookArrangementWorkspace["chapters"];
  selectedId: string; scope: string[]; onSelect: (id: string) => void; onScope: (ids: string[]) => void;
  onSpan: (id: string, chapterId?: string) => void; onDraft: (draft: BookArrangementDraftPayload) => void;
  characterSearch?: string; onCharacter?: (characterId: string, chapterId?: string) => void; onHistory?: (chapterId: string, characterId?: string) => void;
  selectedVolumeId?: string; onVolume?: (id: string) => void; onVolumeEdit?: (edit: BookArrangementVolumeEdit) => void; windowStart?: number; onWindowStart?: (index: number) => void;
  onControl?: (chapterId: string, key: WritingControlKey) => void;
  onObject?: (object: ArrangementObjectSelection) => void;
}

const handledCheckLabels: Record<string, string> = { resolved: "已解决", ignored: "已忽略", closed: "已关闭" };

/** Pointer position chooses the shared chapter column; keyboard retains the visible selection. */
function clickedChapter(event: MouseEvent<HTMLButtonElement>, chapterIds: string[], selectedId: string): string {
  if (event.detail === 0) return chapterIds.includes(selectedId) ? selectedId : chapterIds[0];
  const box = event.currentTarget.getBoundingClientRect();
  const index = Math.max(0, Math.min(chapterIds.length - 1, Math.floor((event.clientX - box.left) / Math.max(1, box.width) * chapterIds.length)));
  return chapterIds[index];
}

export function ArrangementMatrix({ workspace, draft, chapters, selectedId, scope, onSelect, onScope, onSpan, onDraft, characterSearch = "", onCharacter, onHistory, selectedVolumeId, onVolume, onVolumeEdit, windowStart, onWindowStart, onControl, onObject }: Props) {
  const [groups, setGroups] = useState<Record<string, boolean>>({});
  const [personFilter, setPersonFilter] = useState("");
  const [manager, setManager] = useState(false);
  const [allPresence, setAllPresence] = useState(false);
  const [allRelations, setAllRelations] = useState(false);
  const [allClues, setAllClues] = useState(false);
  const [showDefaultTracks, setShowDefaultTracks] = useState(workspace.draft.revision === 0 && draft.pinnedTracks.length === 0);
  const visibleTracks = draft.pinnedTracks.length || !showDefaultTracks ? draft.pinnedTracks : ["pace", "tension"];
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
  const history = (chapterId: string, characterId?: string) => { onSelect(chapterId); onHistory?.(chapterId, characterId); };
  const label = (key: string, title: string, detail?: string) => <button type="button" className="ba-label ba-section-label" aria-expanded={!groups[key]} onClick={() => toggle(key)}>{groups[key] ? <ChevronRight size={15} /> : <ChevronDown size={15} />}<span>{title}{detail && <small>{detail}</small>}</span></button>;
  const guides = () => <div className="ba-plot-guides" aria-hidden="true">{chapters.map(chapter => <span key={chapter.id} data-chapter-id={chapter.id} className={chapter.id === selectedId ? "is-selected" : ""} />)}</div>;
  const empty = (text: string) => <p className="ba-track-empty">{text}</p>;
  const cell = (chapterId: string, content: ReactNode, className = "") => <div key={chapterId} data-chapter-id={chapterId} className={`ba-cell ${className} ${chapterId === selectedId ? "is-selected" : ""}`}>{content}</div>;

  return <section aria-label="章节对齐编排矩阵" className="ba-matrix-section">
    <div className="ba-matrix-toolbar">
      <label>人物筛选 <select aria-label="人物筛选" className="ba-input ba-inline" value={personFilter} onChange={event => { setPersonFilter(event.target.value); setAllPresence(false); if (event.target.value) onCharacter?.(event.target.value); }}><option value="">全部人物</option>{workspace.characters.map(person => <option key={person.id} value={person.id}>{person.name}{person.role ? ` · ${person.role}` : ""}</option>)}</select></label>
      <Button size="sm" variant="ghost" onClick={() => setGroups({})}>全部展开</Button>
      <Button size="sm" variant="ghost" onClick={() => setGroups({ volumes: true, events: true, people: true, relationships: true, threads: true, controls: true, reviews: true })}>全部折叠</Button>
      <Button size="sm" variant="ghost" aria-expanded={manager} onClick={() => setManager(!manager)}><SlidersHorizontal size={14} />管理表达轨道</Button>
    </div>
    {manager && <fieldset className="ba-track-manager"><legend>显示的表达参数</legend>{arrangementTracks.map(track => <label key={track.key}><input type="checkbox" checked={visibleTracks.includes(track.key)} onChange={event => { setShowDefaultTracks(false); onDraft({ ...draft, pinnedTracks: event.target.checked ? [...visibleTracks, track.key] : visibleTracks.filter(key => key !== track.key) }); }} />{track.label}</label>)}</fieldset>}
    <div className="book-arrangement-scroll" tabIndex={0} aria-label="章节矩阵，可横向滚动">
      <div className="ba-matrix ba-compact-matrix" style={{ "--ba-count": chapters.length } as CSSProperties}>
        <div className="ba-label ba-head">章节</div>
        {chapters.map(chapter => <div key={chapter.id} data-chapter-id={chapter.id} className={`ba-cell ba-head ${selectedId === chapter.id ? "is-selected" : ""}`}>
          <button type="button" className="ba-chapter-heading" aria-label={`选择第${chapter.order}章 · ${chapter.title}`} title={`第${chapter.order}章 · ${chapter.title}`} onClick={() => onSelect(chapter.id)}><span className="ba-chapter-number">{chapter.order} ·</span><span className="ba-chapter-title">{chapter.title}</span>{chapterEdit(draft, chapter.id).locked && <LockKeyhole size={12} aria-label="已锁定编排" />}</button>
          <label className={`ba-chapter-state ${chapter.hasContent ? "is-written" : "is-pending"}`}><input type="checkbox" aria-label={`调整范围第${chapter.order}章`} checked={scope.includes(chapter.id)} onChange={event => onScope(event.target.checked ? [...scope, chapter.id] : scope.filter(id => id !== chapter.id))} />{chapter.hasContent ? "已写" : "待写"}</label>
        </div>)}

        {label("volumes", "卷段", `${new Set(volumes.map(segment => segment.source.id)).size} 卷`)}
        <div className="ba-track-content">{!groups.volumes && <ArrangementVolumeTrack workspace={workspace} draft={draft} chapters={chapters} selectedChapterId={selectedId} selectedVolumeId={selectedVolumeId} onVolume={onVolume} onVolumeEdit={onVolumeEdit} windowStart={windowStart} onWindowStart={onWindowStart} />}</div>

        {label("events", "事件 / 场景", `${workspace.scenes.filter(scene => chapters.some(chapter => chapter.id === scene.chapterId)).length} 个场景`)}
        {groups.events ? <div className="ba-track-content" /> : chapters.map(chapter => { const events = workspace.events.filter(event => event.chapterId === chapter.id); const scenes = workspace.scenes.filter(scene => scene.chapterId === chapter.id).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)); return cell(chapter.id, <>
          <span className="ba-event-dots">{events.slice(0, 3).map(event => <button type="button" aria-label={`查看事件 ${event.title}`} key={event.id} title={`${event.title} · ${eventStatusLabels[event.status] || "状态未标注"}`} onClick={() => onObject?.({ kind: "event", id: event.id, chapterId: chapter.id })}><Circle size={12} fill={event.status === "occurred" || event.status === "resolved" ? "currentColor" : "none"} /></button>)}{events.length > 3 && <button type="button" aria-label={`查看第${chapter.order}章全部事件`} onClick={() => history(chapter.id)}>+{events.length - 3}</button>}{!events.length && <button type="button" className="ba-unset" onClick={() => onObject?.({ kind: "event", id: "new", chapterId: chapter.id })}>+ 事件</button>}</span>
          <span className="ba-scene-tags">{scenes.slice(0, 3).map((scene, index) => <button type="button" key={scene.id} className="ba-scene" title={scene.title} aria-label={`查看场景 ${scene.title}`} onClick={() => onObject?.({ kind: "scene", id: scene.id, chapterId: chapter.id })}>S{index + 1}</button>)}{scenes.length > 3 && <button type="button" onClick={() => history(chapter.id)}>+{scenes.length - 3}</button>}{!scenes.length && <button type="button" className="ba-unset" onClick={() => onObject?.({ kind: "scene", id: "new", chapterId: chapter.id })}>+ 场景</button>}</span>
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

        {label("controls", "叙事参数", `${visibleTracks.length} 种表达目标`)}
        <div className="ba-track-content ba-controls-content">{!groups.controls && arrangementTracks.filter(track => visibleTracks.includes(track.key)).map(track => {
          const values = chapters.map(chapter => controlValue(chapterEdit(draft, chapter.id).controls, track.key));
          return <div key={track.key} className="ba-control-track"><span className="ba-control-label">{track.label}</span><div className="ba-curve" style={{ "--ba-count": chapters.length } as CSSProperties}>
            <svg aria-label={`${track.label}曲线，未设置处断线`} viewBox={`0 0 ${chapters.length * 100} 62`} preserveAspectRatio="none">{curveSegments(values).map((segment, index) => <g key={index}><polyline fill="none" stroke={track.color} strokeWidth="2" vectorEffect="non-scaling-stroke" points={segment.map(point => `${point.x},${point.y}`).join(" ")} />{segment.map(point => <circle key={point.x} cx={point.x} cy={point.y} r="3" fill={track.color} />)}</g>)}</svg>
            {chapters.map((chapter, index) => <ArrangementCurveCell key={chapter.id} chapterId={chapter.id} order={chapter.order} label={track.label} controlKey={track.key} value={values[index]} selected={selectedId === chapter.id} draft={draft} onDraft={onDraft} onOpen={() => onControl?.(chapter.id, track.key)} />)}
          </div></div>;
        })}</div>

        {label("reviews", "核对结果")}
        {groups.reviews ? <div className="ba-track-content" /> : (workspace.checks ?? []).some(check => check.chapterIds.some(id => chapters.some(chapter => chapter.id === id))) ? chapters.map(chapter => { const checks = (workspace.checks ?? []).filter(check => check.chapterIds.includes(chapter.id)); return <div key={chapter.id} className={`ba-cell ba-check-cell ${chapter.id === selectedId ? "is-selected" : ""}`} data-chapter-id={chapter.id}>{checks.slice(0, 2).map(check => {
          const handledLabel = handledCheckLabels[check.status];
          return <button key={check.id} type="button" className={`ba-check-result ${handledLabel ? "is-handled" : "is-open"}`} data-status={check.status} title={`${handledLabel ?? "待处理"} · ${check.title}\n${check.evidenceLabel}\n${check.summary}`} onClick={() => onObject?.({ kind: "check", id: check.sourceId, chapterId: chapter.id })}>{handledLabel ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}<span>{check.title}<small className="ba-check-status">{handledLabel ?? "待处理"}</small><small>{check.evidenceLabel}</small></span></button>;
        })}{checks.length > 2 && <button type="button" onClick={() => history(chapter.id)}>另 {checks.length - 2} 项</button>}{!checks.length && <span className="ba-unset">暂无核对</span>}</div>; }) : <div className="ba-track-content">{empty("当前范围暂无核对结果")}</div>}
      </div>
    </div>
  </section>;
}
