import type {ProfessionalViewsWorkspace} from '../../common/professionalViews';
import {sortedProfessionalTimings} from '../../common/professionalViews';
const lifecycle={planned:'计划发生',occurred:'已发生',cancelled:'已取消',invalidated:'已失效'};
const relationLabels={before:'先于',simultaneous:'同时',overlaps:'重叠',contains:'包含',causes:'导致',enables:'促成',blocks:'阻止',depends_on:'依赖'};
const roleLabels={mention:'提及',scene:'现场叙述',reveal:'揭示',retell:'重述',flashback:'回忆',flashforward:'预叙'};
export default function TimelineView({data,onSelect}:{data:ProfessionalViewsWorkspace;onSelect:(id:string)=>void}){
 const title=(id:string)=>data.timeline.materials.find(item=>item.cardId===id)?.title??'来源资料已不可用';
 const times=sortedProfessionalTimings(data.timeline.timings);
 return <section aria-label="世界故事时间"><h3>正式世界时间</h3><p>按正式规范顺序排列，不把章节叙述顺序或记录日期当成世界时间；未知时间单列说明。</p><a className="nd-button" href={`/new-design/books/${data.book.id}/composition`} target="_blank" rel="noreferrer">维护原事件时间与因果</a>
  <ol className="nd-pro-timeline">{times.map(time=><li key={time.id}><button className="nd-button" type="button" onClick={()=>onSelect(time.eventCardId)}>{title(time.eventCardId)}</button><p>{lifecycle[time.lifecycle]} · {time.status==='active'?'正式安排':'历史安排需核对'}</p><p>{time.startLabel??time.startInstant??(time.normalizedStart===null?'开始时间未确定':`世界顺序 ${time.normalizedStart}`)} → {time.endLabel??time.endInstant??(time.normalizedEnd===null?'结束时间未确定':`世界顺序 ${time.normalizedEnd}`)}</p>{time.relativeToEventCardId&&<p>相对事件：{title(time.relativeToEventCardId)} · {time.relativeRelation==='before'?'此前':time.relativeRelation==='after'?'此后':time.relativeRelation==='simultaneous'?'同时':'相对关系未确定'} · 偏移 {time.relativeOffset??'未确定'}</p>}<p>{time.reason}</p><ul>{data.timeline.occurrences.filter(item=>item.eventCardId===time.eventCardId).map(item=><li key={item.id}><a href={`/new-design/books/${data.book.id}/writing?chapter=${item.chapterCardId}`} target="_blank" rel="noreferrer">{title(item.chapterCardId)}</a> · {roleLabels[item.role]} · {item.status==='active'?'当前引用':'引用需核对'}</li>)}</ul></li>)}</ol>
  {!times.length&&<p>尚无正式确认的世界时间。已有时间提案不会被当作已发生事实，请到原事件时间编辑器预览影响后明确审核。</p>}
  <h3>正式因果、先后与并发</h3>{data.timeline.eventRelations.map(edge=><article key={edge.id}><p><button className="nd-button" onClick={()=>onSelect(edge.sourceEventCardId)}>{title(edge.sourceEventCardId)}</button> {relationLabels[edge.relationType]} <button className="nd-button" onClick={()=>onSelect(edge.targetEventCardId)}>{title(edge.targetEventCardId)}</button></p><p>{edge.status==='active'?'正式事件关系':'历史关系需核对'} · {edge.reason}</p></article>)}
  {!data.timeline.eventRelations.length&&<p>尚无正式确认的事件关系；不从事件名称推断因果。</p>}
 </section>;
}
