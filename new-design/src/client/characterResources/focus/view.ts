import type {CharacterResourceLedger} from '../../../common/characterResources';
import type {ResourceFocusRecord} from '../../../common/characterResources/focus';
import {sameResourceFocusValue} from '../../../common/characterResources/focus';
export function resourceFocusView(ledger:CharacterResourceLedger|null,controller:{record:ResourceFocusRecord|null;applied:boolean;verifiedHash:string|null}){
 const record=controller.record,valid=Boolean(ledger&&record?.output&&controller.applied&&controller.verifiedHash===record.request.expectedSourceHash&&sameResourceFocusValue(ledger,record.snapshot.ledger));
 const role=valid?record!.output!.role.value:'unknown';
 const label=role==='protagonist'?'主角完整资源':role==='temporary'?'临时角色关键资源':role==='long_term'?'长期角色关键资源':'定位待核对 · 全部资源';
 const items=ledger?.items??[],visible=role==='temporary'?items.filter(item=>record!.output!.resources.find(result=>result.relationId===item.relationId)?.importance!=='ordinary'):items;
 return{label,role,valid,items:visible,limit:role==='protagonist'?10:role==='temporary'?5:6};
}
