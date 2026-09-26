import type {PoolClient} from 'pg';
import {NewDesignError,assertFound} from '../../../domain/errors';
import {findRecordCard} from '../../recordCards';
import {stableHash} from '../../aiContracts/integrity';
import {settlementRecordCtes as ctes} from './rows';
import {settlementRecordDefaults} from './definitions';
type Row=Record<string,any>;
const fail=()=>{throw new NewDesignError('结算来源、冻结版本或状态推进不符合原始记录。',409);};
const equal=(a:unknown,b:unknown)=>stableHash(a??null)===stableHash(b??null);
function immutable(row:Row,old:Row,keys:string[]){if(keys.some(key=>!equal(row[key],old[key])))fail();}
async function record(db:PoolClient,id:unknown,kind:string){return assertFound(await findRecordCard(db,String(id),kind),'结算引用的来源不存在。');}

/** The former preparation/session/checkpoint triggers are enforced at the native record boundary. */
export async function validateSettlementOrigin(db:PoolClient,kind:string,row:Row,old:Row|null){
 if(old&&['settlement_policy_version','chapter_settlement_item_version','settlement_relation_configuration_version','settlement_relation_configuration_receipt'].includes(kind))fail();
 if(kind==='book_settlement_policy'){
  const version=await record(db,row.current_version_id,'settlement_policy_version');if(version.book_id!==row.book_id)fail();
 }
 if(kind==='settlement_relation_configuration_draft'||kind==='settlement_relation_configuration_version'){
  for(const key of ['relation_type_id','source_relation_type_id'])if(row[key]&&!(await db.query('SELECT 1 FROM new_design.relation_types WHERE id=$1',[row[key]])).rowCount)fail();
  if(kind==='settlement_relation_configuration_draft'&&row.current_version_id)await record(db,row.current_version_id,'settlement_relation_configuration_version');
  if(kind==='settlement_relation_configuration_version')await record(db,row.draft_id,'settlement_relation_configuration_draft');
 }
 if(kind==='chapter_settlement_item_version'&&!(await db.query('SELECT 1 FROM new_design.chapter_settlement_items WHERE id=$1',[row.item_id])).rowCount)fail();
 if(kind==='chapter_adoption_preparation'){
  if(old){
   immutable(row,old,Object.keys(settlementRecordDefaults[kind]).filter(key=>key!=='status'));
   if(old.status!=='prepared'||!['consumed','stale','cancelled'].includes(row.status))fail();
  }else if(row.supplement_base_checkpoint_id==null){
   if(!(await db.query(`WITH ${ctes.planning_objects} SELECT 1 FROM new_design.chapter_documents document
    JOIN new_design.chapter_body_versions body ON body.id=$3 AND body.chapter_document_id=document.id
    JOIN planning_objects object ON object.id=$5
    WHERE document.id=$2 AND document.book_id=$1 AND document.revision=$4 AND body.archived_at IS NULL
     AND body.planning_version_id=$6 AND body.context_manifest_id IS NOT DISTINCT FROM $7::uuid
     AND object.book_id=$1 AND object.card_id=document.chapter_card_id AND object.level='chapter' AND object.adopted_version_id=$6`,
    [row.book_id,row.chapter_document_id,row.body_version_id,row.expected_document_revision,row.planning_object_id,row.planning_version_id,row.context_manifest_id])).rowCount)fail();
  }else{
   if(!(await db.query(`WITH ${ctes.chapter_stable_checkpoints},${ctes.chapter_adoption_sessions},${ctes.planning_versions}
    SELECT 1 FROM chapter_stable_checkpoints base JOIN chapter_adoption_sessions original ON original.id=base.session_id AND original.status='stable'
    JOIN new_design.chapter_settlements settlement ON settlement.id=base.settlement_id AND settlement.status='committed'
    JOIN new_design.chapter_documents document ON document.id=base.chapter_document_id AND document.book_id=base.book_id AND document.status='active' AND document.adopted_version_id=base.body_version_id
    JOIN new_design.books book ON book.id=base.book_id AND book.status='active'
    JOIN new_design.chapter_body_versions body ON body.id=base.body_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
    JOIN planning_versions plan ON plan.id=original.planning_version_id AND plan.object_id=original.planning_object_id AND plan.book_id=base.book_id
    WHERE base.id=$1 AND base.status='stable' AND base.book_id=$2 AND base.chapter_document_id=$3 AND base.body_version_id=$4
     AND document.revision=$5 AND base.chapter_order=document.logical_order AND original.book_id=base.book_id
     AND original.chapter_document_id=document.id AND original.body_version_id=body.id AND original.settlement_id=settlement.id
     AND settlement.book_id=base.book_id AND settlement.chapter_document_id=document.id AND settlement.body_version_id=body.id
     AND original.planning_object_id=$6 AND original.planning_version_id=$7 AND plan.content_hash=$8 AND body.planning_version_id=plan.id
     AND body.context_manifest_id IS NOT DISTINCT FROM $9::uuid AND original.context_manifest_id IS NOT DISTINCT FROM $9::uuid`,
    [row.supplement_base_checkpoint_id,row.book_id,row.chapter_document_id,row.body_version_id,row.expected_document_revision,row.planning_object_id,row.planning_version_id,row.planning_content_hash,row.context_manifest_id])).rowCount)fail();
  }
 }
 if(['chapter_adoption_preparation','chapter_adoption_session'].includes(kind)){
  const plan=await record(db,row.planning_version_id,'planning_version');if(plan.object_id!==row.planning_object_id)fail();
  if(row.context_manifest_id&&!(await db.query('SELECT 1 FROM new_design.context_manifests WHERE id=$1',[row.context_manifest_id])).rowCount)fail();
 }
 if(kind==='chapter_adoption_session'){
  const policy=await record(db,row.policy_version_id,'settlement_policy_version');if(policy.book_id!==row.book_id)fail();
  if(row.prior_body_version_id&&!(await db.query('SELECT 1 FROM new_design.chapter_body_versions WHERE id=$1 AND chapter_document_id=$2',[row.prior_body_version_id,row.chapter_document_id])).rowCount)fail();
  if(row.adoption_id&&!(await db.query('SELECT 1 FROM new_design.chapter_body_adoptions WHERE id=$1',[row.adoption_id])).rowCount)fail();
  if(row.settlement_id&&!(await db.query('SELECT 1 FROM new_design.chapter_settlements WHERE id=$1',[row.settlement_id])).rowCount)fail();
  if(old){
   immutable(row,old,['book_id','chapter_document_id','body_version_id','preparation_id','prior_body_version_id','policy_version_id','planning_object_id','planning_version_id','context_manifest_id','dependency_hash','adoption_kind','idempotency_key','created_by','created_at','supplement_base_checkpoint_id']);
   if(old.adoption_kind==='resource_supplement'&&!equal(row.adoption_id,old.adoption_id))fail();
   const transitions:Record<string,string[]>={reviewing:['adopted_pending_proposals','impact_review_required','cancelled','failed'],impact_review_required:['adopted_pending_proposals','cancelled','failed'],adopted_pending_proposals:['pending_review','settling','failed'],pending_review:['partially_confirmed','settling','failed'],partially_confirmed:['pending_review','settling','failed'],settling:['stable','failed'],failed:['pending_review','settling','cancelled']};
   if(Number(row.revision)!==Number(old.revision)+1||['stable','cancelled'].includes(old.status)||row.status!==old.status&&!transitions[old.status]?.includes(row.status))fail();
   if(row.status==='stable'&&(!row.adoption_id||!row.settlement_id))fail();
  }else{
   const prep=await record(db,row.preparation_id,'chapter_adoption_preparation');
   immutable(row,prep,['book_id','chapter_document_id','body_version_id','planning_object_id','planning_version_id','context_manifest_id','dependency_hash']);
   if(!(await db.query('SELECT 1 FROM new_design.chapter_body_versions WHERE id=$1 AND chapter_document_id=$2 AND archived_at IS NULL',[row.body_version_id,row.chapter_document_id])).rowCount)fail();
   if((row.adoption_kind==='resource_supplement')!==(row.supplement_base_checkpoint_id!=null))fail();
   if(row.supplement_base_checkpoint_id){
    const base=await record(db,row.supplement_base_checkpoint_id,'chapter_stable_checkpoint'),original=await record(db,base.session_id,'chapter_adoption_session');
    immutable(row,base,['book_id','chapter_document_id','body_version_id']);
    immutable(row,original,['adoption_id','planning_object_id','planning_version_id','context_manifest_id']);
    if(base.status!=='stable'||original.status!=='stable'||row.status!=='adopted_pending_proposals'||row.prior_body_version_id!=null||row.settlement_id!=null||prep.supplement_base_checkpoint_id!==base.id||prep.status!=='consumed')fail();
   }
  }
 }
 if(kind==='chapter_stable_checkpoint'){
  if(old)immutable(row,old,Object.keys(settlementRecordDefaults[kind]).filter(key=>key!=='status'));
  await record(db,row.session_id,'chapter_adoption_session');
  if(row.previous_checkpoint_id)await record(db,row.previous_checkpoint_id,'chapter_stable_checkpoint');
  if(!(await db.query('SELECT 1 FROM new_design.chapter_settlements WHERE id=$1',[row.settlement_id])).rowCount)fail();
 }
 if(kind==='chapter_proposal_extraction_request'){
  const session=await record(db,row.session_id,'chapter_adoption_session');immutable(row,session,['book_id','body_version_id']);
  if(!(await db.query(`SELECT 1 FROM new_design.task_contract_versions contract,new_design.prompt_recipe_versions recipe,new_design.context_manifests manifest,new_design.model_route_snapshots route
   WHERE contract.id=$1 AND recipe.id=$2 AND manifest.id=$3 AND route.id=$4`,[row.task_contract_version_id,row.prompt_recipe_version_id,row.context_manifest_id,row.model_route_snapshot_id])).rowCount)fail();
  if(row.ai_task_id&&!(await db.query('SELECT 1 FROM new_design.ai_tasks WHERE id=$1',[row.ai_task_id])).rowCount)fail();
  if(old)immutable(row,old,['session_id','book_id','body_version_id','task_contract_version_id','prompt_recipe_version_id','context_manifest_id','model_route_snapshot_id','request_hash','idempotency_key','created_by','created_at']);
 }
}
