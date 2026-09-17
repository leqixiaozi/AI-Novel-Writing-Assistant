import type {ProfessionalObject} from '../../common/worldCharacterMaintenance';
export interface GraphPoint {id:string;x:number;y:number;}
export interface GraphEdge {id:string;sourceId:string;targetId:string;label:string;directed:boolean;available:boolean;}
export default function GraphCanvas({objects,points,edges,selected,onSelect,onEdge}:{objects:Pick<ProfessionalObject,"id"|"title"|"typeLabel">[];points:GraphPoint[];edges:GraphEdge[];selected:string;onSelect:(id:string)=>void;onEdge:(id:string)=>void}){
 const pointById=new Map(points.map(point=>[point.id,point]));
 const width=Math.max(1000,...points.map(point=>point.x+180)),height=Math.max(360,...points.map(point=>point.y+80));
 return <div className="nd-pro-graph-scroll"><svg className="nd-pro-graph" viewBox={`0 0 ${width} ${height}`} style={{width,height}} role="group" aria-label="专业资料节点图；可使用左侧目录选择节点，使用关系列表选择连线">
  <defs><marker id="nd-professional-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs>
  {edges.map(edge=>{const a=pointById.get(edge.sourceId),b=pointById.get(edge.targetId);if(!a||!b)return null;return <g key={edge.id} className={edge.available?'':'is-unavailable'}><line x1={a.x+80} y1={a.y+22} x2={b.x+80} y2={b.y+22} markerEnd={edge.directed?'url(#nd-professional-arrow)':undefined}/><foreignObject x={(a.x+b.x)/2+15} y={(a.y+b.y)/2+5} width="130" height="44"><button type="button" className="nd-pro-edge" onClick={()=>onEdge(edge.id)} title={edge.label}>{edge.label}</button></foreignObject></g>;})}
  {points.map(point=>{const object=objects.find(object=>object.id===point.id);if(!object)return null;return <foreignObject x={point.x} y={point.y} width="160" height="60" key={point.id}><button type="button" className={`nd-pro-node ${selected===point.id?'is-selected':''}`} onClick={()=>onSelect(point.id)} aria-pressed={selected===point.id} title={`${object.title} · ${object.typeLabel}`}><span>{object.title}</span><small>{object.typeLabel}</small></button></foreignObject>;})}
 </svg></div>;
}
