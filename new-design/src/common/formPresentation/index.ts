import type {BookViewCard,FieldDefinition} from '../contracts';

export type CharacterFieldSection='profile'|'visible';
const visibleGroups=new Set(['外在表现','外显档案','外显字段','外显']);
export function fieldInCharacterSection(field:FieldDefinition,section:CharacterFieldSection) {
  return section==='visible'?visibleGroups.has(field.group.trim()):!visibleGroups.has(field.group.trim());
}
/** Only the installed structured role contract may classify the cast. */
export function castSection(card:BookViewCard):'protagonists'|'supporting'|'unspecified' {
  const role=card.typeFields.find(field=>field.key==='story_role'&&field.type==='select'&&!field.hidden&&!field.optionSource);
  const value=card.values.story_role;
  if(!role||!role.options.some(option=>option.value===value))return 'unspecified';
  return value==='protagonist'?'protagonists':'supporting';
}
export function fieldDisplay(field:FieldDefinition,value:unknown):string {
  if(value===null||value===undefined||value==='')return '未填写';
  if(field.optionSource?.kind==='dictionary_tree')return '已选择字典资料';
  if(Array.isArray(value))return value.map(item=>field.options.find(option=>option.value===item)?.label??String(item)).join('、');
  if(typeof value==='boolean')return value?'是':'否';
  if(typeof value==='object')return '结构化资料';
  return field.options.find(option=>option.value===value)?.label??String(value);
}
