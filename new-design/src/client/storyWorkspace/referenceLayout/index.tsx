import type {BookViewCard,FieldDefinition} from '../../../common/contracts';
import {castSection,fieldDisplay} from '../../../common/formPresentation';
import Help from '../Help';
import './reference.css';
export {default as ReferenceDetail} from './Detail';

export const CHARACTER_DETAILS=[['overview','总览'],['basic','档案'],['visible','外显'],['resources','资源'],['timeline','时间线'],['relations','关系'],['dynamics','动态'],['intelligence','智能层'],['initial','初始状态']] as const;
export const WORLD_DETAILS=[['overview','世界总览'],['rules','规则与张力'],['guidance','生成约束'],['usage','使用范围'],['sync','同步与资产'],['basic','编辑档案'],['initial','初始状态']] as const;
export function CastIndex({cards,search,selectedId,onSelect}:{cards:BookViewCard[];search:string;selectedId:string;onSelect:(card:BookViewCard)=>void}) {
 const filtered=cards.filter(card=>card.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
 return <>{([['protagonists','主角位'],['supporting','配角与关系角色'],['unspecified','未指定人物定位']] as const).map(([key,label])=>{
  const items=filtered.filter(card=>castSection(card)===key);
  return items.length?<section className="nd-cast-section" key={key}><h3>{label}<small>{items.length}</small></h3>{items.map(card=>{
   const role=card.typeFields.find(field=>field.key==='story_role');
   return <button key={card.id} className={card.id===selectedId?'is-selected':''} aria-pressed={card.id===selectedId} onClick={()=>onSelect(card)}><span className="nd-cast-avatar" aria-hidden="true">{Array.from(card.title)[0]}</span><span><strong>{card.title}</strong><small>{role?fieldDisplay(role,card.values[role.key]):card.cardTypeName}</small></span></button>;
  })}</section>:null;
 })}{!filtered.length&&<p>{cards.length?'没有匹配的人物。':'尚无人物，选择内容类型后新增。'}</p>}</>;
}
export function SelectedSummary({card,fields=card.typeFields}:{card:BookViewCard;fields?:FieldDefinition[]}) {
 const entries=fields.filter(field=>!field.hidden&&field.key!=='name'&&card.values[field.key]!==undefined&&card.values[field.key]!==null&&card.values[field.key]!=='').slice(0,4);
 return <header className="nd-selected-summary"><div><span className="nd-cast-avatar" aria-hidden="true">{Array.from(card.title)[0]}</span><h3>{card.title}</h3><small>{card.cardTypeName}</small><Help label="档案摘要">显示已保存档案。填写中的内容在原表单保留；档案值、初始状态与章节确认后的状态分别记录。</Help></div><dl>{entries.map(field=><div key={field.key}><dt>{field.name}</dt><dd>{fieldDisplay(field,card.values[field.key])}</dd></div>)}</dl></header>;
}
