import type {Pool,PoolClient} from 'pg';
/** Read-only capability check; never installs the manual contract. */
export async function publicCharactersCapability(db:Pool|PoolClient){
 const exists=(await db.query("SELECT to_regclass('new_design.public_character_profile_capability') IS NOT NULL present")).rows[0].present===true;
 if(!exists)return{installed:false,operational:false};
 const row=(await db.query(`SELECT capability.operational,
  EXISTS(SELECT 1 FROM pg_trigger entry JOIN pg_proc guard ON guard.oid=entry.tgfoid JOIN pg_namespace ns ON ns.oid=guard.pronamespace
   WHERE entry.tgrelid='new_design.professional_resource_receipts'::regclass AND entry.tgname='professional_resource_receipt_guard'
    AND entry.tgenabled IN ('O','A') AND ns.nspname='new_design'
    AND strpos(pg_get_functiondef(guard.oid),'public_character_profile_v1')>0) protected
  FROM new_design.public_character_profile_capability capability WHERE capability.contract='public_character_profile_v1'`)).rows[0];
 return{installed:row?.protected===true,operational:row?.protected===true&&row.operational===true};
}
