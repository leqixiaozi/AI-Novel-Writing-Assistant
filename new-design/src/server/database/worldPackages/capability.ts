import type {PoolClient} from 'pg';
import {NewDesignError} from '../../domain/errors';
type Db=Pick<PoolClient,'query'>;
export async function worldPackageCapability(db:Db){
 const cutover=(await db.query(`SELECT
   to_regclass('new_design.system_capabilities') IS NOT NULL capability_table,
   EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id IN ('132_card_kernel_tables_only','133_card_kernel_tables_only_upgrade')) migration`)).rows[0]??{};
 if(!cutover.capability_table||!cutover.migration)return{installed:false,operational:false};
 const final=(await db.query(`SELECT
   EXISTS(SELECT 1 FROM new_design.system_capabilities WHERE capability_key='card_kernel_v2' AND installed AND operational AND details->>'storage'='tables_only') kernel,
   EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('new_design.card_version_actions') AND tgname='card_version_actions_immutable' AND tgenabled='O') immutable,
   EXISTS(SELECT 1 FROM new_design.relation_types WHERE relation_key='world_sample_relation' AND status='published') world_relation`)).rows[0]??{};
 return{installed:true,operational:Boolean(final.kernel&&final.immutable&&final.world_relation)};
}
export async function requireWorldPackageCapability(db:Db){if(!(await worldPackageCapability(db)).operational)throw new NewDesignError('公共世界同步尚未启用；保留本书独立资料及原来源。',503);}
