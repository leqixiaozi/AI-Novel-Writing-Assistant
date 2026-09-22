import type {PoolClient} from 'pg';
import {NewDesignError} from '../../../domain/errors';
import {stableHash} from '../../aiContracts/integrity';
import {validateSupplementClaim} from './supplementClaim';
type Row=Record<string,any>;
const assets=['new_design.chapter.settlement_candidates','new_design.character.resource_backfill','new_design.character.stable_resource_supplement','new_design.character.stable_resource_correction'];
const fail=()=>{throw new NewDesignError('章节提取的冻结来源、模型回执或任务归属不一致。',409);};
export async function validateExtractionRecord(db:PoolClient,row:Row,old:Row|null){
 if(!old)await validateSupplementClaim(db,row);
 const changed=(key:string)=>old&&stableHash(old[key]??null)!==stableHash(row[key]??null);
 if(old){
  if(['frozen_plan','frozen_input_hash','expected_session_revision'].some(changed))fail();
  if(old.generated_output!=null&&['generated_output','generated_execution'].some(changed))fail();
  if(old.frozen_plan!=null&&changed('ai_task_id')||old.generated_execution!=null&&changed('generated_execution'))fail();
  if(old.status==='succeeded'&&(changed('status')||changed('failure')))fail();
  if(old.frozen_plan!=null&&['stale','cancelled'].includes(old.status)&&changed('status'))fail();
 }
 const plan=row.frozen_plan,input=plan?.input;
 if(plan){
  if(!row.frozen_input_hash||!row.expected_session_revision||!row.ai_task_id||!assets.includes(plan.assetId)||plan.assetVersion!=='v1'||input?.sessionId!==row.session_id||input?.bodyVersionId!==row.body_version_id)fail();
  const contract=await db.query(`SELECT 1 FROM new_design.ai_tasks task JOIN new_design.task_contract_versions contract ON contract.id=task.task_contract_version_id
   JOIN new_design.task_contracts config ON config.id=contract.contract_id JOIN new_design.prompt_recipe_versions recipe ON recipe.id=contract.prompt_recipe_version_id
   WHERE task.id=$1 AND task.source_kind='chapter_settlement_extraction' AND task.source_id=$2 AND task.book_id=$3
   AND contract.id=$4 AND contract.prompt_recipe_version_id=$5 AND contract.task_group='chapter_settlement' AND config.task_key='chapter_settlement_'||$6::text
   AND contract.budget_policy->>'assetId'=$7 AND contract.budget_policy->>'assetVersion'=$8 AND recipe.variables_schema->'const'=$9::jsonb`,[row.ai_task_id,row.id,row.book_id,row.task_contract_version_id,row.prompt_recipe_version_id,row.session_id,plan.assetId,plan.assetVersion,JSON.stringify(input)]);
  if(!contract.rowCount)fail();
  if(plan.assetId!==assets[0]){
   const scope=input.resourceScope;if(!scope||!Array.isArray(scope.resources)||!Array.isArray(scope.anchors))fail();
   if(!old){
    if(!scope.resources.length||!(await db.query(`SELECT 1 FROM new_design.books book JOIN new_design.cards actor ON actor.space_id=book.space_id
     JOIN new_design.card_types type ON type.id=actor.card_type_id AND type.type_key='character' AND type.status='published'
     JOIN new_design.chapter_documents document ON document.book_id=book.id AND document.adopted_version_id=$2 AND document.status='active'
     JOIN new_design.chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id AND body.archived_at IS NULL
     WHERE book.id=$1 AND book.status='active' AND actor.status='active' AND actor.id=$3 AND actor.current_version_id=$4 AND actor.revision=$5 AND body.content=$6 AND body.content_hash=$7`,[row.book_id,row.body_version_id,scope.characterId,scope.characterVersionId,scope.characterRevision,input.bodyContent,input.bodyContentHash])).rowCount)fail();
    for(const ref of scope.resources)if(!(await db.query(`SELECT 1 FROM new_design.card_relations relation JOIN new_design.books book ON book.space_id=relation.space_id AND book.id=$1
     JOIN new_design.cards resource ON resource.id=relation.target_card_id AND resource.space_id=book.space_id AND resource.status='active'
     JOIN new_design.card_types type ON type.id=resource.card_type_id AND type.type_key='prop' AND type.status='published'
     JOIN new_design.card_relation_versions version ON version.id=relation.current_version_id AND version.card_relation_id=relation.id
     WHERE relation.status='active' AND relation.id=$2 AND version.id=$3 AND relation.source_card_id=$4 AND relation.relation_type_id=$5
     AND resource.id=$6 AND resource.current_version_id=$7 AND version.revision=relation.revision AND version.status=relation.status AND version.properties=relation.properties`,[row.book_id,ref.relationId,ref.relationVersionId,scope.characterId,scope.relationTypeId,ref.id,ref.versionId])).rowCount)fail();
    for(const ref of scope.anchors)if(!(await db.query("SELECT 1 FROM new_design.text_anchors WHERE id=$1 AND book_id=$2 AND body_version_id=$3 AND status='active' AND subject_card_id=$4 AND start_offset=$5 AND end_offset=$6 AND excerpt=$7",[ref.id,row.book_id,row.body_version_id,ref.subjectCardId,ref.start,ref.end,ref.excerpt])).rowCount)fail();
   }
  }
 }
 if(row.generated_output!=null&&(!plan||row.generated_execution==null))fail();
 if(old&&old.generated_output==null&&row.generated_output!=null){
  if(old.status!=='running'||row.status!=='running'||!(await db.query("SELECT 1 FROM new_design.ai_task_attempts WHERE task_id=$1 AND status='running' AND input_hash=$2 AND task_contract_version_id=$3 AND prompt_recipe_version_id=$4 AND context_manifest_id=$5 AND model_route_snapshot_id=$6",[row.ai_task_id,row.frozen_input_hash,row.task_contract_version_id,row.prompt_recipe_version_id,row.context_manifest_id,row.model_route_snapshot_id])).rowCount)fail();
 }
}
