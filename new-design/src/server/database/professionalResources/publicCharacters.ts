import type {Pool,PoolClient} from 'pg';
import {readCardWorkflowCapability} from '../cardWorkflow';
/** Read-only capability check; never installs the manual contract. */
export async function publicCharactersCapability(db:Pool|PoolClient){
 return readCardWorkflowCapability(db,'public_character_profile_v1',['card_version_local_value']);
}
