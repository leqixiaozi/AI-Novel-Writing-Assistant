import type {PoolClient} from 'pg';
import type {FieldDefinition} from '../../../common/contracts';
import {randomUUID} from 'node:crypto';
import {createRecordCard} from '../recordCards';
import {assertFound} from '../../domain/errors';
/** Each mount owns option identities; source options and other mounts remain independent. */
export function cloneLocalFieldOptions(options:FieldDefinition['options']):FieldDefinition['options']{return options.map(option=>({...option,id:randomUUID()}));}
export async function installLocalFieldOptions(client:PoolClient,definitionId:string,field:FieldDefinition,createdBy:string){
 const definition=assertFound((await client.query('SELECT space_id FROM new_design.field_definitions WHERE id=$1',[definitionId])).rows[0],'局部字段不存在。');
 for(const option of field.options){
   const id=option.id??randomUUID(),versionId=randomUUID(),now=new Date().toISOString(),spaceId=String(definition.space_id);
   await createRecordCard(client,{id:versionId,spaceId,typeKey:'field_option_version',title:option.label,values:{id:versionId,option_definition_id:id,version:1,label:option.label,created_by:createdBy,created_at:now}});
   await createRecordCard(client,{id,spaceId,typeKey:'field_option_definition',title:option.label,values:{id,field_definition_id:definitionId,option_key:option.value,current_version_id:versionId,status:'active',revision:1,created_at:now,updated_at:now}});
 }
}
