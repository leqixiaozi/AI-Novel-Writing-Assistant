import type {CharacterResourceLedger,CharacterResourceItem} from '../../../common/characterResources';
import type {ResourceHistoryItem} from '../../../common/characterResources/history';
import type {ResourceFocusRecord} from '../../../common/characterResources/focus';
import {sameResourceFocusValue} from '../../../common/characterResources/focus';
export function resourceFocusView(ledger:CharacterResourceLedger|null,controller:{record:ResourceFocusRecord|null;applied:boolean;verifiedHash:string|null}){
 const record=controller.record,sourceVerified=Boolean(ledger&&record&&controller.verifiedHash===record.request.expectedSourceHash&&sameResourceFocusValue(ledger,record.snapshot.ledger)),valid=Boolean(sourceVerified&&record?.output&&controller.applied);
 const role=valid?record!.output!.role.value:'unknown';
 const label=role==='protagonist'?'主角完整资源':role==='temporary'?'临时角色关键资源':role==='long_term'?'长期角色关键资源':'定位待核对 · 全部资源';
 const items=ledger?.items??[],originalHistory=record?.snapshot.history;
 const historyInScope=Boolean(ledger&&originalHistory?.bookId===ledger.bookId&&originalHistory.characterId===ledger.characterId&&sameResourceFocusValue(originalHistory.selection,ledger.selection));
 const history=historyInScope?(originalHistory!.items.map(item=>sourceVerified?item:{...item,currentHolding:null,changes:item.changes.map(change=>({...change,available:false,unavailableReason:'原建议中的历史来源尚未重新核对，请打开原章节。'}))})):[];
 type Entry={kind:'current';item:CharacterResourceItem}|{kind:'history';item:ResourceHistoryItem};
 const allEntries:Entry[]=[...items.map(item=>({kind:'current' as const,item})),...history.filter(item=>!items.some(current=>current.relationId===item.relationId)).map(item=>({kind:'history' as const,item}))];
 const status=(id:string)=>record?.output?.history?.find(result=>result.relationId===id)?.status??'unknown';
 const entries=allEntries.filter(entry=>{
  if(role==='long_term')return status(entry.item.relationId)!=='stale';
  if(role!=='temporary')return true;
  if(entry.kind==='history')return ['transferred','unknown'].includes(status(entry.item.relationId));
  return status(entry.item.relationId)==='transferred'||record!.output!.resources.find(result=>result.relationId===entry.item.relationId)?.importance!=='ordinary';
 });
 if(role==='temporary'||role==='long_term'){
  const priority=(entry:Entry)=>status(entry.item.relationId)==='transferred'?-1:record!.output!.resources.find(result=>result.relationId===entry.item.relationId)?.importance==='key'?0:1;
  entries.sort((left,right)=>priority(left)-priority(right));
 }
 return{label,role,valid,items:entries.filter((entry):entry is Extract<Entry,{kind:'current'}>=>entry.kind==='current').map(entry=>entry.item),entries,allEntries,limit:role==='protagonist'?10:role==='temporary'?5:6};
}
