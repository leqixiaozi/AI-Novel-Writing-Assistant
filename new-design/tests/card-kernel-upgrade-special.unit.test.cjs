const {test}=require('node:test');
const assert=require('node:assert/strict');
const {transformAction}=require('../scripts/card-kernel-upgrade-special.cjs');

const id=n=>`10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const createdAt='2026-09-22T12:34:56.123456+08:00';
const inputHash='a'.repeat(64);
const envelope=(type,values)=>({id:id(90),type_key:`legacy.${type}`,values:structuredClone(values),current_values:values});
function lookup(t,expectedType,expectedId,result={id:id(80),current_version_id:id(81)}){
 let calls=0;
 t.after(()=>assert.equal(calls,1));
 return(type,logicalId)=>{calls++;assert.equal(type,expectedType);assert.equal(logicalId,expectedId);return result;};
}
function settlement(patch={}){return{id:id(1),session_id:id(2),event_kind:'proposal_edited',from_status:'draft',to_status:'draft',item_id:id(3),idempotency_key:'original-event-key',actor:'fixture',detail:{note:'原完整说明'},editing_request_key:null,editing_input_hash:null,editing_receipt:null,created_at:createdAt,...patch};}
function material(patch={}){return{id:id(4),space_id:id(5),book_id:null,subject_kind:'group',subject_id:id(6),action:'reorder',expected_revision:2,result_version_id:id(7),detail:{orderedIds:[id(6),id(8)],inputHash},idempotency_key:'original-material-key',created_by:'fixture',created_at:createdAt,...patch};}
const blocked=code=>error=>error.name==='CardKernelUpgradeMappingError'&&error.code===code;

test('prompt receipt keeps the source identity, original exact version and existing input hash',t=>{
 const values={idempotency_key:'original-prompt-key',input_hash:inputHash,card_id:id(10),card_version_id:id(11),created_at:createdAt,__legacy_table:'prompt_command_receipts',__legacy_identity:{idempotency_key:'original-prompt-key'},__convergence_category:'compat_write'};
 const source=envelope('prompt_command_receipts',values),before=structuredClone(source);
 const result=transformAction(source,lookup(t,null,id(10),{id:id(10),current_version_id:id(12)}));
 assert.deepEqual(result,{id:id(90),card_id:id(10),card_version_id:id(11),action_key:'prompt.save',request_key:'prompt-command:original-prompt-key',input_hash:inputHash,payload:{idempotency_key:'original-prompt-key',input_hash:inputHash,card_id:id(10),card_version_id:id(11),created_at:createdAt},receipt:null,created_at:createdAt});
 assert.deepEqual(source,before);
});

test('ordinary settlement preserves event idempotency without inventing a paired input hash',t=>{
 const values=settlement();
 const result=transformAction(envelope('chapter_settlement_events',values),lookup(t,'chapter_adoption_session',id(2)));
 assert.equal(result.id,values.id);assert.equal(result.created_at,createdAt);
 assert.equal(result.card_id,id(80));assert.equal(result.card_version_id,id(81));
 assert.equal(result.action_key,'chapter_settlement.proposal_edited');
 assert.equal(result.request_key,null);assert.equal(result.input_hash,null);assert.equal(result.receipt,null);
 assert.deepEqual(result.payload,values);assert.notEqual(result.payload,values);
});

test('editing settlement preserves both request namespaces and the complete exact receipt',t=>{
 const receipt={sessionId:id(2),requestKey:'original-edit-key',items:[{id:id(3),note:'完整回执'}]};
 const values=settlement({editing_request_key:receipt.requestKey,editing_input_hash:inputHash,editing_receipt:receipt});
 const result=transformAction(envelope('chapter_settlement_events',values),lookup(t,'chapter_adoption_session',id(2)));
 assert.equal(result.request_key,`chapter_settlement:${id(2)}:editing:original-edit-key`);
 assert.equal(result.input_hash,inputHash);assert.equal(result.payload.idempotency_key,'original-event-key');
 assert.deepEqual(result.receipt,receipt);assert.notEqual(result.receipt,receipt);
 result.receipt.items[0].note='mutated output';assert.equal(receipt.items[0].note,'完整回执');
});

test('material event retains scope-key recovery and never treats business version as card version',t=>{
 const values=material();
 const result=transformAction(envelope('material_management_events',values),lookup(t,'material_group',id(6)));
 assert.equal(result.id,id(4));assert.equal(result.card_id,id(80));assert.equal(result.card_version_id,null);
 assert.equal(result.action_key,'material.group.reorder');assert.equal(result.created_at,createdAt);
 assert.equal(result.request_key,null);assert.equal(result.input_hash,null);
 assert.deepEqual(result.payload,values);assert.equal(result.payload.detail.inputHash,inputHash);
});

test('material membership owners distinguish membership changes from prompt-card classification',async t=>{
 for(const item of [{kind:'tag_membership',action:'add_member',type:'material_tag'},{kind:'group_membership',action:'remove_member',type:'material_group'},{kind:'group_membership',action:'move',type:null}]){
  await t.test(`${item.kind}.${item.action}`,t=>{
   const values=material({subject_kind:item.kind,action:item.action,...(item.action==='move'?{detail:{promptClassification:true,inputHash,groupId:id(7),organizationOnly:true}}:{})});
   const result=transformAction(envelope('material_management_events',values),lookup(t,item.type,id(6),{id:item.type===null?id(6):id(80),current_version_id:id(81)}));
   assert.equal(result.action_key,`material.${item.kind}.${item.action}`);
   assert.equal(result.payload.subject_id,id(6));assert.equal(result.card_version_id,null);
  });
 }
});

test('partial, malformed or mismatched editing evidence blocks rather than synthesizing evidence',()=>{
 const owner=()=>({id:id(80),current_version_id:id(81)});
 for(const patch of [{editing_request_key:'original-edit-key'},{editing_input_hash:inputHash},{editing_receipt:{}}]){
  assert.throws(()=>transformAction(envelope('chapter_settlement_events',settlement(patch)),owner),blocked('incomplete_editing_receipt'));
 }
 assert.throws(()=>transformAction(envelope('chapter_settlement_events',settlement({editing_request_key:'original-edit-key',editing_input_hash:'bad',editing_receipt:{sessionId:id(2),requestKey:'original-edit-key'}})),owner),blocked('invalid_editing_hash'));
 assert.throws(()=>transformAction(envelope('chapter_settlement_events',settlement({editing_request_key:'original-edit-key',editing_input_hash:inputHash,editing_receipt:{sessionId:id(99),requestKey:'original-edit-key'}})),owner),blocked('editing_receipt_identity_mismatch'));
});

test('unsupported source, inconsistent legacy identity and missing prompt evidence are fail closed',()=>{
 const owner=()=>({id:id(10),current_version_id:id(12)});
 const prompt={idempotency_key:'original-prompt-key',input_hash:inputHash,card_id:id(10),card_version_id:id(11),created_at:createdAt};
 assert.throws(()=>transformAction(envelope('unknown_events',{}),owner),blocked('unsupported_source_type'));
 assert.throws(()=>transformAction(envelope('prompt_command_receipts',{...prompt,__legacy_identity:{idempotency_key:'different'}}),owner),blocked('legacy_identity_mismatch'));
 assert.throws(()=>transformAction(envelope('prompt_command_receipts',{...prompt,input_hash:null}),owner),blocked('invalid_prompt_hash'));
 assert.throws(()=>transformAction(envelope('prompt_command_receipts',{...prompt,card_version_id:null}),owner),blocked('missing_prompt_exact_version'));
 const withoutId=envelope('prompt_command_receipts',prompt);delete withoutId.id;
 assert.throws(()=>transformAction(withoutId,owner),blocked('missing_prompt_source_card_id'));
});

test('owner lookup must resolve a real synchronous physical owner and settlement version',()=>{
 const source=envelope('chapter_settlement_events',settlement());
 assert.throws(()=>transformAction(source,()=>null),blocked('owner_not_found'));
 assert.throws(()=>transformAction(source,async()=>({id:id(80),current_version_id:id(81)})),blocked('owner_lookup_must_be_synchronous'));
 assert.throws(()=>transformAction(source,()=>({id:id(80),current_version_id:null})),blocked('settlement_owner_has_no_version'));
 assert.throws(()=>transformAction(envelope('material_management_events',material({subject_kind:'tag_membership',action:'copy'})),()=>({id:id(80),current_version_id:id(81)})),blocked('unsupported_tag_membership_owner'));
 assert.throws(()=>transformAction(envelope('material_management_events',material({subject_kind:'group_membership',action:'move'})),()=>({id:id(80),current_version_id:id(81)})),blocked('unproven_prompt_classification_owner'));
});

test('invalid timestamps, non-JSON details and unknown action values cannot be silently normalized',()=>{
 const owner=()=>({id:id(80),current_version_id:id(81)});
 assert.throws(()=>transformAction(envelope('material_management_events',material({created_at:'not-a-time'})),owner),blocked('invalid_created_at'));
 assert.throws(()=>transformAction(envelope('material_management_events',material({detail:{value:Infinity}})),owner),blocked('non_json_payload'));
 assert.throws(()=>transformAction(envelope('chapter_settlement_events',settlement({event_kind:'made_up'})),owner),blocked('unsupported_settlement_event_kind'));
});
