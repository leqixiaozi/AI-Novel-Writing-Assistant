import type {PoolClient} from 'pg';
import type {FieldDefinition} from '../../../common/contracts';
import {randomUUID} from 'node:crypto';
/** Each mount owns option identities; source options and other mounts remain independent. */
export function cloneLocalFieldOptions(options:FieldDefinition['options']):FieldDefinition['options']{return options.map(option=>({...option,id:randomUUID()}));}
export async function installLocalFieldOptions(client:PoolClient,definitionId:string,field:FieldDefinition,createdBy:string){
 for(const option of field.options){const versionId=randomUUID();await client.query('INSERT INTO new_design.field_option_definitions(id,field_definition_id,option_key,current_version_id) VALUES($1,$2,$3,NULL)',[option.id,definitionId,option.value]);await client.query('INSERT INTO new_design.field_option_versions(id,option_definition_id,version,label,created_by) VALUES($1,$2,1,$3,$4)',[versionId,option.id,option.label,createdBy]);await client.query('UPDATE new_design.field_option_definitions SET current_version_id=$2 WHERE id=$1',[option.id,versionId]);}
}
