import type {SettlementFieldChoice} from '../../common/chapterSettlementEditing';
import {valueLabel} from '../chapterWriting/settlementEditing';
export function displayResourceValue(value:unknown,field:SettlementFieldChoice|undefined,objects:Array<{id:string;label:string}>=[]):string{
 if(Array.isArray(value)&&value.length)return value.map(item=>displayResourceValue(item,field,objects)).join('、');
 if(typeof value==='string'){const node=field?.dictionaryNodes.find(node=>node.id===value);if(node)return node.path.length?node.path.join(' / '):node.label;}
 return valueLabel(value,field?.field??null,{objects});
}
/** Compare full structured originals without relying on object key order. */
export function sameInput(left:unknown,right:unknown):boolean{
 const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
 return JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
}
