import { useState, type CSSProperties, type ReactNode } from "react";
import type { BookArrangementDraftPayload, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { Button } from "@/components/ui/button";
import { arrangementTracks, chapterEdit, controlValue, curveSegments, eventStatusLabels, presenceLabels } from "./arrangementState";

export function ArrangementMatrix({ workspace, draft, chapters, selectedId, scope, onSelect, onScope, onSpan, onDraft }: {
  workspace: BookArrangementWorkspace; draft: BookArrangementDraftPayload; chapters: BookArrangementWorkspace["chapters"];
  selectedId: string; scope: string[]; onSelect: (id: string) => void; onScope: (ids: string[]) => void; onSpan: (id: string) => void; onDraft: (draft: BookArrangementDraftPayload) => void;
}) {
  const [groups, setGroups] = useState<Record<string, boolean>>({});
  const [personFilter, setPersonFilter] = useState("");
  const [manager, setManager] = useState(false);
  const [showDefaultTracks, setShowDefaultTracks] = useState(workspace.draft.revision === 0 && draft.pinnedTracks.length === 0);
  const visibleTracks = draft.pinnedTracks.length || !showDefaultTracks ? draft.pinnedTracks : ["pace", "tension"];
  const toggle = (key: string) => setGroups({ ...groups, [key]: !groups[key] });
  const people = workspace.characters.filter(person => !personFilter || person.id === personFilter);
  const cell = (chapterId: string, content: ReactNode, key?: string) => <button key={key ?? chapterId} type="button" data-chapter-id={chapterId} className={`ba-cell ${selectedId === chapterId ? "is-selected" : ""}`} onClick={() => onSelect(chapterId)}>{content}</button>;
  const group = (key: string, label: string, count: number) => <button className="ba-group" type="button" aria-expanded={!groups[key]} onClick={() => toggle(key)}>{groups[key] ? "›" : "⌄"} {label}<span>{count}</span></button>;
  return <section aria-label="章节对齐编排矩阵" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm">人物筛选 <select aria-label="人物筛选" className="ba-input ba-inline" value={personFilter} onChange={event => setPersonFilter(event.target.value)}><option value="">全部人物</option>{workspace.characters.map(person => <option key={person.id} value={person.id}>{person.name}{person.role ? ` · ${person.role}` : ""}</option>)}</select></label>
      <Button size="sm" variant="ghost" onClick={() => setGroups({})}>全部展开</Button>
      <Button size="sm" variant="ghost" onClick={() => setGroups({ events: true, scenes: true, people: true, controls: true })}>全部折叠</Button>
      <Button size="sm" variant="ghost" aria-expanded={manager} onClick={() => setManager(!manager)}>管理表达轨道</Button>
    </div>
    {manager && <fieldset className="flex flex-wrap gap-4 bg-muted/30 p-3"><legend className="text-sm">显示的表达参数</legend>{arrangementTracks.map(track => <label key={track.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={visibleTracks.includes(track.key)} onChange={event => { setShowDefaultTracks(false); onDraft({ ...draft, pinnedTracks: event.target.checked ? [...visibleTracks, track.key] : visibleTracks.filter(key => key !== track.key) }); }} />{track.label}</label>)}</fieldset>}
    <div className="book-arrangement-scroll" tabIndex={0} aria-label="章节矩阵，可横向滚动">
      <div className="ba-matrix" style={{ "--ba-count": chapters.length } as CSSProperties}>
        <div className="ba-label ba-head">章节 / 调整范围</div>
        {chapters.map(chapter => <div key={chapter.id} data-chapter-id={chapter.id} className={`ba-cell ba-head ${selectedId === chapter.id ? "is-selected" : ""}`}>
          <button type="button" aria-label={`选择第${chapter.order}章`} onClick={() => onSelect(chapter.id)}>第 {chapter.order} 章{chapterEdit(draft, chapter.id).locked ? " · 锁定" : ""}</button>
          <label className="flex justify-center gap-1 text-xs"><input type="checkbox" aria-label={`调整范围第${chapter.order}章`} checked={scope.includes(chapter.id)} onChange={event => onScope(event.target.checked ? [...scope, chapter.id] : scope.filter(id => id !== chapter.id))} />调整</label>
        </div>)}
        <div className="ba-label">章节定位</div>{chapters.map(chapter => cell(chapter.id, <><span>{chapter.title}</span><small>{chapter.wordCount.toLocaleString()} 字 · {chapter.hasContent ? "已有正文" : "待写"}</small></>))}
        <div className="ba-label">所属卷</div>{chapters.map(chapter => cell(chapter.id, <small>{workspace.volumes.filter(volume => volume.chapterIds.includes(chapter.id)).map(volume => volume.title).join(" / ") || "未分卷"}</small>))}
        {group("events", "事件时间线", workspace.events.length)}
        {!groups.events && <><div className="ba-label">发生时间 / 事件</div>{chapters.map(chapter => { const events = workspace.events.filter(event => event.chapterId === chapter.id); return cell(chapter.id, <>{events.slice(0, 2).map(event => <span key={event.id} className="ba-event"><span className="line-clamp-2"><i />{event.title}</span><small>{eventStatusLabels[event.status] || "状态未标注"} · {event.storyTimeLabel || (event.storyDayIndex == null ? "时间未设" : `第 ${event.storyDayIndex} 天`)}</small></span>)}{events.length > 2 && <small>另 {events.length - 2} 项，选择章节查看</small>}{!events.length && <small>暂无事件</small>}</>); })}</>}
        {group("scenes", "场景结构", workspace.scenes.length)}
        {!groups.scenes && <><div className="ba-label">已有场景</div>{chapters.map(chapter => { const scenes = workspace.scenes.filter(scene => scene.chapterId === chapter.id); return cell(chapter.id, <>{scenes.slice(0, 2).map(scene => <span key={scene.id} className="ba-scene line-clamp-2">{scene.title}</span>)}{scenes.length > 2 && <small>另 {scenes.length - 2} 项，选择章节查看</small>}{!scenes.length && <small>暂无场景</small>}</>); })}</>}
        {group("people", "人物轨道", people.length)}
        {!groups.people && people.map(person => <div className="contents" key={person.id}>
          <div className="ba-label"><span className="ba-person-dot">{person.name.slice(0, 1)}</span><span>{person.name}<small>{person.role || "人物"}</small></span></div>
          {chapters.map((chapter, index) => <div data-chapter-id={chapter.id} className={`ba-cell ba-person-cell ${selectedId === chapter.id ? "is-selected" : ""}`} key={chapter.id}>
            {draft.characterSpans.filter(span => span.characterId === person.id && span.chapterIds.includes(chapter.id)).map(span => <button key={span.id} type="button" className={`ba-span ba-span-${span.mode} ${span.chapterIds.includes(chapters[index - 1]?.id) ? "ba-span-joined-left" : ""} ${span.chapterIds.includes(chapters[index + 1]?.id) ? "ba-span-joined-right" : ""}`} aria-label={`${person.name}第${chapter.order}章区段`} onClick={() => { onSelect(chapter.id); onSpan(span.id); }}>{presenceLabels[span.mode]}{span.weight === null ? "" : ` · 权重 ${span.weight}`}</button>)}
            {!draft.characterSpans.some(span => span.characterId === person.id && span.chapterIds.includes(chapter.id)) && <button type="button" className="text-xs text-muted-foreground" onClick={() => onSelect(chapter.id)}>未设置</button>}
          </div>)}
        </div>)}
        {!groups.people && people.length === 0 && <p className="ba-empty-row">请在人物页面准备人物，再为人物编排参与区段。</p>}
        {group("controls", "五种表达参数", visibleTracks.length)}
        {!groups.controls && arrangementTracks.filter(track => visibleTracks.includes(track.key)).map(track => {
          const values = chapters.map(chapter => controlValue(chapterEdit(draft, chapter.id).controls, track.key));
          const segments = curveSegments(values);
          return <div className="contents" key={track.key}>
            <div className="ba-label"><i className="ba-track-dot" style={{ background: track.color }} />{track.label}</div>
            <div className="ba-curve" style={{ "--ba-count": chapters.length } as CSSProperties}>
              <svg aria-label={`${track.label}曲线，未设置处断线`} viewBox={`0 0 ${chapters.length * 100} 62`} preserveAspectRatio="none">
                {segments.map((segment, index) => <g key={index}><polyline fill="none" stroke={track.color} strokeWidth="2" vectorEffect="non-scaling-stroke" points={segment.map(point => `${point.x},${point.y}`).join(" ")} />{segment.map(point => <circle key={point.x} cx={point.x} cy={point.y} r="3" fill={track.color} />)}</g>)}
              </svg>
              {chapters.map((chapter, index) => <button key={chapter.id} data-chapter-id={chapter.id} type="button" className={`ba-curve-cell ${selectedId === chapter.id ? "is-selected" : ""}`} onClick={() => onSelect(chapter.id)} aria-label={`第${chapter.order}章${track.label}${values[index] === null ? "未设置" : values[index]}`}><span>{values[index] === null ? (chapterEdit(draft, chapter.id).controls[track.key]?.mode === "disabled" ? "已停用" : "未设置") : values[index]}</span></button>)}
            </div>
          </div>;
        })}
      </div>
    </div>
    <p className="text-xs text-muted-foreground">阅读顺序按章节从左至右排列；事件标注故事内发生时间。人物参与和表达曲线来自编排草稿，未设置处保留空白。</p>
  </section>;
}
