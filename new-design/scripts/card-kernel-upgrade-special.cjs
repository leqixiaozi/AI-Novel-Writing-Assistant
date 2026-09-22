'use strict';

// Historical-row conversion only: no database, clock, random IDs or model calls.
// The caller must preflight action-ID collisions and exact owner-version FKs.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const settlementKinds=new Set(['session_started','body_adopted','impact_review_required','proposal_added','proposal_edited','decision_recorded','settlement_started','settlement_committed','settlement_failed']);
const materialActions=new Set(['create','revise','move','reorder','archive','restore','promote_children','archive_tree','add_member','remove_member','copy']);

function reject(code){
 const error=new Error(`Legacy action conversion blocked: ${code}`);
 error.name='CardKernelUpgradeMappingError';error.code=code;throw error;
}
function object(value,label){if(value===null||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))reject(label);return value;}
function uuid(value,label){if(typeof value!=='string'||!UUID.test(value))reject(label);return value;}
function text(value,label,empty=false){if(typeof value!=='string'||(!empty&&!value.length))reject(label);return value;}
function hash(value,label){if(typeof value!=='string'||!HASH.test(value))reject(label);return value;}
function timestamp(value){
 if(value instanceof Date){if(!Number.isFinite(value.getTime()))reject('invalid_created_at');return new Date(value.getTime());}
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(value)||!Number.isFinite(Date.parse(value)))reject('invalid_created_at');
 return value; // Do not round PostgreSQL's fractional timestamp precision.
}
function jsonCopy(value,seen=new Set()){
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!Number.isFinite(value))reject('non_json_payload');return value;}
 if(value instanceof Date)return timestamp(value).toISOString();
 if(typeof value!=='object'||seen.has(value))reject('non_json_payload');
 if(!Array.isArray(value))object(value,'non_json_payload');
 seen.add(value);
 const copy=Array.isArray(value)?value.map(item=>jsonCopy(item,seen)):Object.fromEntries(Object.entries(value).map(([key,item])=>[key,jsonCopy(item,seen)]));
 seen.delete(value);return copy;
}
function sourceRow(row){
 object(row,'invalid_source_row');
 const rawType=row.type_key??row.sourceType??row.__legacy_table;
 if(typeof rawType!=='string')reject('missing_source_type');
 const type=rawType.startsWith('legacy.')?rawType.slice(7):rawType;
 if(!['prompt_command_receipts','chapter_settlement_events','material_management_events'].includes(type))reject('unsupported_source_type');
 const raw=object(row.current_values??row.values??row,'missing_source_payload');
 if(raw.__legacy_table!==undefined&&raw.__legacy_table!==type)reject('legacy_table_mismatch');
 if(raw.__legacy_identity!==undefined){
  object(raw.__legacy_identity,'invalid_legacy_identity');
  for(const [key,value] of Object.entries(raw.__legacy_identity))if(!Object.hasOwn(raw,key)||JSON.stringify(raw[key])!==JSON.stringify(value))reject('legacy_identity_mismatch');
 }
 const payload=Object.fromEntries(Object.entries(raw).filter(([key])=>!['__legacy_table','__legacy_identity','__convergence_category','sourceType','type_key'].includes(key)).map(([key,value])=>[key,jsonCopy(value)]));
 return{type,payload,raw,sourceId:row.id};
}
function owner(lookupOwner,type,id){
 uuid(id,'invalid_owner_logical_id');
 const result=lookupOwner(type,id);
 if(result&&typeof result.then==='function')reject('owner_lookup_must_be_synchronous');
 if(!result)reject('owner_not_found');object(result,'invalid_owner');
 uuid(result.id,'invalid_owner_physical_id');
 if(result.current_version_id!=null)uuid(result.current_version_id,'invalid_owner_current_version');
 return result;
}
function finalize(action){
 uuid(action.id,'invalid_source_action_id');uuid(action.card_id,'invalid_action_owner');
 if(action.card_version_id!==null)uuid(action.card_version_id,'invalid_action_version');
 if((action.request_key===null)!==(action.input_hash===null))reject('unpaired_request_hash');
 if(action.request_key!==null){text(action.request_key,'invalid_action_request');hash(action.input_hash,'invalid_action_hash');}
 if(action.action_key.length>120)reject('invalid_action_key');
 return action;
}

/**
 * @param {{id:string,type_key:string,current_values?:object,values?:object}} row
 * Source catalog row. Prompt receipts have no old row ID, so row.id (the stable
 * legacy physical card ID) becomes the action ID. Other sources retain payload.id.
 * @param {(type:string|null,logicalId:string)=>({id:string,current_version_id:string|null}|null)} lookupOwner
 * Synchronous lookup; null type means the original author card's physical ID.
 * @returns {{id:string,card_id:string,card_version_id:string|null,action_key:string,request_key:string|null,input_hash:string|null,payload:object,receipt:object|null,created_at:string|Date}}
 */
function transformAction(row,lookupOwner){
 if(typeof lookupOwner!=='function')reject('missing_owner_lookup');
 const {type,payload,raw,sourceId}=sourceRow(row);
 const createdAt=timestamp(raw.created_at); // Never substitute the legacy card timestamp.
 if(type==='prompt_command_receipts'){
  const request=text(payload.idempotency_key,'missing_prompt_request'),inputHash=hash(payload.input_hash,'invalid_prompt_hash');
  const card=owner(lookupOwner,null,payload.card_id);
  // Author card IDs are stable physical identities, not record logical IDs.
  if(card.id!==payload.card_id)reject('prompt_owner_identity_changed');
  const version=uuid(payload.card_version_id,'missing_prompt_exact_version');
  return finalize({id:uuid(sourceId,'missing_prompt_source_card_id'),card_id:card.id,card_version_id:version,action_key:'prompt.save',request_key:`prompt-command:${request}`,input_hash:inputHash,payload,receipt:null,created_at:createdAt});
 }
 if(type==='chapter_settlement_events'){
  if(!settlementKinds.has(payload.event_kind))reject('unsupported_settlement_event_kind');
  text(payload.to_status,'missing_settlement_status');text(payload.actor,'missing_settlement_actor',true);object(payload.detail,'invalid_settlement_detail');
  if(payload.item_id!=null)uuid(payload.item_id,'invalid_settlement_item');
  if(payload.idempotency_key!=null)text(payload.idempotency_key,'invalid_settlement_idempotency_key',true);
  const card=owner(lookupOwner,'chapter_adoption_session',payload.session_id);
  if(card.current_version_id==null)reject('settlement_owner_has_no_version');
  const editing=[payload.editing_request_key,payload.editing_input_hash,payload.editing_receipt].filter(value=>value!=null).length;
  if(editing!==0&&editing!==3)reject('incomplete_editing_receipt');
  let requestKey=null,inputHash=null,receipt=null;
  if(editing===3){
   const key=text(payload.editing_request_key,'invalid_editing_request');
   if(key.length<8||key.length>160)reject('invalid_editing_request');
   inputHash=hash(payload.editing_input_hash,'invalid_editing_hash');receipt=object(payload.editing_receipt,'invalid_editing_receipt');
   if(receipt.sessionId!==payload.session_id||receipt.requestKey!==key)reject('editing_receipt_identity_mismatch');
   requestKey=`chapter_settlement:${payload.session_id}:editing:${key}`;
  }
  // Ordinary events never had an input hash. Keep their independent event key
  // in payload.idempotency_key, where runtime checks it. Do not synthesize a hash
  // or exploit SQL CHECK's unknown/null truth value to store an incomplete pair.
  return finalize({id:uuid(payload.id,'missing_settlement_id'),card_id:card.id,card_version_id:card.current_version_id,action_key:`chapter_settlement.${payload.event_kind}`,request_key:requestKey,input_hash:inputHash,payload,receipt,created_at:createdAt});
 }
 if(!materialActions.has(payload.action))reject('unsupported_material_action');
 uuid(payload.space_id,'missing_material_space');if(payload.book_id!=null)uuid(payload.book_id,'invalid_material_book');
 text(payload.idempotency_key,'missing_material_idempotency_key',true);text(payload.created_by,'missing_material_actor',true);object(payload.detail,'invalid_material_detail');
 if(payload.expected_revision!=null&&!Number.isInteger(payload.expected_revision))reject('invalid_material_revision');
 if(payload.result_version_id!=null)uuid(payload.result_version_id,'invalid_material_result_version');
 let ownerType;
 switch(payload.subject_kind){
  case 'tag':ownerType='material_tag';break;
  case 'group':ownerType='material_group';break;
  case 'smart_view':ownerType='smart_view';break;
  case 'tag_membership':
   if(!['add_member','remove_member'].includes(payload.action))reject('unsupported_tag_membership_owner');
   ownerType='material_tag';break;
  case 'group_membership':
   if(payload.action==='move'){
    if(payload.detail.promptClassification!==true)reject('unproven_prompt_classification_owner');
    ownerType=null; // Prompt classification moves own an author card.
   }
   else if(['add_member','remove_member'].includes(payload.action))ownerType='material_group';
   else reject('unsupported_group_membership_owner');
   break;
  default:reject('unsupported_material_subject');
 }
 const card=owner(lookupOwner,ownerType,payload.subject_id);
 if(ownerType===null&&card.id!==payload.subject_id)reject('material_author_owner_identity_changed');
 // result_version_id is a BUSINESS version record, not a card_versions FK.
 // Material runtime uses payload space/key for idempotency, not top-level keys.
 return finalize({id:uuid(payload.id,'missing_material_event_id'),card_id:card.id,card_version_id:null,action_key:`material.${payload.subject_kind}.${payload.action}`,request_key:null,input_hash:null,payload,receipt:null,created_at:createdAt});
}

module.exports={transformAction};
