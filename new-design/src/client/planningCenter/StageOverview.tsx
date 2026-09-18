import type {PlanningObject} from '../../common/contracts';
import {LEGACY_PLANNING_FIELDS,type LegacyPlanningPresentation} from './legacyPlanningFields';

/** Coverage of adopted fields is not an inferred quality or tension score. */
export default function StageOverview({presentation,objects,selectedId,onSelect}:{presentation:LegacyPlanningPresentation;objects:PlanningObject[];selectedId:string;onSelect:(object:PlanningObject)=>void}){
 const level=presentation==='story_macro'?'story':presentation==='outline'?'volume':'chapter';
 const rows=objects.filter(object=>object.level===level&&object.status==='active');
 const fields=LEGACY_PLANNING_FIELDS[presentation].flatMap(group=>group.fields);
 const filled=(object:PlanningObject,key:string)=>typeof object.adoptedVersion?.content[key]==='string'&&String(object.adoptedVersion.content[key]).trim().length>0;
 const adopted=rows.filter(object=>object.adoptedVersion);
 const count=adopted.reduce((total,object)=>total+fields.filter(field=>filled(object,field.key)).length,0);
 return <section className="nd-stage-overview" aria-label="采用规划概览">
  <header><h3>{presentation==='structured'?'章节节奏安排':'采用规划概览'}</h3><span>{rows.length} 项 · 已采用 {adopted.length} 项 · 已填 {count}/{adopted.length*fields.length} 项专用字段</span></header>
  {rows.length?<div className="nd-stage-overview-scroll"><table><thead><tr><th>规划</th>{fields.map(field=><th key={field.key}>{field.label}</th>)}</tr></thead><tbody>{rows.map(object=><tr key={object.id} className={selectedId===object.id?'is-selected':''}><th scope="row"><button type="button" aria-pressed={selectedId===object.id} onClick={()=>onSelect(object)}>{object.title}</button><small>{object.adoptedVersion?`采用版本 ${object.adoptedVersion.version}`:'等待采用'}</small></th>{fields.map(field=><td key={field.key}><span className={filled(object,field.key)?'is-filled':''} title={filled(object,field.key)?String(object.adoptedVersion!.content[field.key]):undefined}>{filled(object,field.key)?'已安排':object.adoptedVersion?'未填写':'未采用'}</span></td>)}</tr>)}</tbody></table></div>:<p>当前阶段尚无规划，建立候选并明确采用后显示安排。</p>}
  <small>只读取正式采用版本；章节节奏按开场、压力转折、本章兑现、章末牵引展示安排，不推算张力或质量分数。</small>
 </section>;
}
