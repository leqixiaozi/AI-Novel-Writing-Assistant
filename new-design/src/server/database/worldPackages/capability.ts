import type {PoolClient} from 'pg';
import {NewDesignError} from '../../domain/errors';
type Db=Pick<PoolClient,'query'>;
const guards=['world_package_version_guard','world_package_card_ref_guard','world_package_relation_ref_guard','world_package_installation_guard','world_package_install_card_ref_guard','world_package_versions_immutable','world_package_card_refs_immutable','world_package_relation_refs_immutable','world_package_installations_immutable','world_package_install_card_refs_immutable','world_package_complete_refs','world_install_complete_refs','world_package_card_history_guard','world_package_type_history_guard','world_package_form_history_guard','world_package_dictionary_history_guard','world_package_install_relation_ref_guard','world_package_install_relation_refs_immutable','world_package_candidate_guard','world_package_baseline_guard','world_package_library_command_guard','world_package_library_candidate_guard','world_package_library_commands_immutable','world_package_library_candidates_immutable','world_package_sync_command_guard','world_package_sync_commands_immutable','world_package_push_candidates_immutable','world_package_field_baselines_immutable'];
guards.push('world_package_added_card_ref_guard','world_package_added_card_refs_immutable','world_package_relation_baseline_guard','world_package_relation_baselines_immutable','world_package_sync_complete_children');
export async function worldPackageCapability(db:Db){
 const cutover=(await db.query(`SELECT
   to_regclass('new_design.system_capabilities') IS NOT NULL capability_table,
   EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id='131_card_kernel_v2_cutover') migration`)).rows[0]??{};
 if(cutover.capability_table&&cutover.migration){
  const final=(await db.query(`SELECT
    EXISTS(SELECT 1 FROM new_design.system_capabilities WHERE capability_key='card_kernel_v2' AND installed AND operational) kernel,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('new_design.card_version_actions') AND tgname='card_version_actions_immutable' AND tgenabled='O') immutable,
    EXISTS(SELECT 1 FROM new_design.relation_types WHERE relation_key='world_sample_relation' AND status='published') world_relation`)).rows[0]??{};
  return{installed:true,operational:Boolean(final.kernel&&final.immutable&&final.world_relation)};
 }
 const installed=(await db.query("SELECT to_regclass('new_design.world_package_capability') IS NOT NULL installed")).rows[0].installed;
 if(!installed)return{installed:false,operational:false};
 const checked=(await db.query("SELECT (SELECT count(*) FROM pg_trigger trigger JOIN pg_class relation ON relation.oid=trigger.tgrelid JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='new_design' AND trigger.tgname=ANY($1::text[]) AND trigger.tgenabled='O')::integer guards,(SELECT operational FROM new_design.world_package_capability WHERE contract='public_world_package_v1') operational",[guards])).rows[0];
 return{installed:true,operational:checked.guards===guards.length&&checked.operational===true};
}
export async function requireWorldPackageCapability(db:Db){if(!(await worldPackageCapability(db)).operational)throw new NewDesignError('公共世界同步尚未启用；保留本书独立资料及原来源。',503);}
