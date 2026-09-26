import type {PoolClient} from 'pg';
import {PUBLIC_CHARACTER_SPACE_ID,type CharacterImportCatalog,type CharacterImportWorkspace} from '../../../common/characterImport';
import type {FieldDefinition} from '../../../common/contracts';
import {assertFound,NewDesignError} from '../../domain/errors';
import {getNewDesignPool} from '../runtime';
import {freezeFormContext,formHash} from '../formAssist';
import {resolveBookFormVersion} from '../referenceParity';
import {listRecordCards,requireRecordCard,type RecordCardRow} from '../recordCards';
function sourceValues(row:RecordCardRow){const {recordCardId,recordSpaceId,recordStatus,recordRevision,...values}=row;return values;}
export async function characterImportSources(db:PoolClient,bookId:string,resourceId:string,versionId:string,lock=false):Promise<CharacterImportWorkspace>{
 const book=assertFound((await db.query("SELECT space_id FROM new_design.books WHERE id=$1 AND status='active'"+(lock?" FOR SHARE":""),[bookId])).rows[0],'本书不存在或已归档。');
 const source=assertFound((await db.query("SELECT card.id,version.id version_id,version.title,version.revision,version.type_version_id,version.values,type_version.fields FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='character' AND type.status='published' JOIN new_design.card_versions version ON version.card_id=card.id AND version.id=$3 JOIN new_design.card_type_versions type_version ON type_version.id=version.type_version_id AND type_version.card_type_id=type.id WHERE card.id=$1 AND card.space_id=$2 AND card.status='active'"+(lock?" FOR SHARE OF card,type,version,type_version":""),[resourceId,PUBLIC_CHARACTER_SPACE_ID,versionId])).rows[0],'所选版本不是有效公共角色来源；书内人物没有自动公开。');
 const localValues=await listRecordCards(db,'card_version_local_value',{where:{card_version_id:versionId},includeArchived:true});
 const definitions=(await db.query('SELECT definition.id,definition.field_key,version.id version_id,version.field_schema FROM new_design.field_definitions definition JOIN new_design.field_definition_versions version ON version.field_definition_id=definition.id WHERE version.id=ANY($1::uuid[])',[localValues.map(row=>row.field_definition_version_id)])).rows;
 const local=localValues.map(value=>{const definition=assertFound(definitions.find(row=>row.id===value.field_definition_id&&row.version_id===value.field_definition_version_id),'公共角色补充字段的冻结规格不存在。');return{field_key:definition.field_key,value:value.value,field_schema:definition.field_schema};});
 const target=assertFound((await db.query("SELECT type.id,type.current_version_id,type.revision FROM new_design.card_types type WHERE type.space_id=$1 AND type.type_key='character' AND type.status='published' AND type.current_version_id IS NOT NULL"+(lock?" FOR SHARE":""),[book.space_id])).rows[0],'本书人物规格尚未发布，原公共角色保留。'),resolution=await resolveBookFormVersion(db,book.space_id,'character');
 if(lock&&resolution)await requireRecordCard(db,String(resolution.form_id),'card_group_form','本书人物表单不存在。',{lock:true});
 const form=await freezeFormContext(db,{bookId,cardTypeId:String(target.id),typeVersionId:String(target.current_version_id),cardId:null,cardRevision:null,formVersionId:resolution?.id??null,title:String(source.title)},{},[]);
 const allowedSpaces=[String(book.space_id),'00000000-0000-4000-8000-000000000001'];
 const capabilityRows=await listRecordCards(db,'state_type_capability',{where:{type_key:'character'},lock});
 const policyRows=await listRecordCards(db,'state_field_policy',{where:{type_key:'character'},lock});
 const byScope=(a:RecordCardRow,b:RecordCardRow)=>Number(b.space_id===book.space_id)-Number(a.space_id===book.space_id);
 const capabilities=capabilityRows.filter(row=>allowedSpaces.includes(String(row.space_id))).sort(byScope).map(sourceValues),policies=policyRows.filter(row=>allowedSpaces.includes(String(row.space_id))).sort((a,b)=>byScope(a,b)||String(a.field_key).localeCompare(String(b.field_key))).map(sourceValues);

 if(local.some(row=>Object.hasOwn(source.values,row.field_key)))throw new NewDesignError('公共角色存在重复的字段与独立补充键，请保留原来源核对。',422);
 return{bookId,source:{id:String(source.id),versionId:String(source.version_id),title:String(source.title),revision:Number(source.revision),typeVersionId:String(source.type_version_id),values:{...source.values,...Object.fromEntries(local.map(row=>[row.field_key,row.value]))},fields:[...source.fields as FieldDefinition[],...local.map(row=>row.field_schema as FieldDefinition)]},target:{cardTypeId:String(target.id),typeVersionId:String(target.current_version_id),revision:Number(target.revision),formVersionId:resolution?.id??null,formResolutionKind:resolution?'installed_form':'type_schema',fields:form.fields,importFields:form.fields.filter(field=>!field.hidden),sourceHash:formHash({form:form.sourceHash,capabilities,policies})}};
}
export async function getCharacterImportCatalog():Promise<CharacterImportCatalog>{
 const db=await(await getNewDesignPool()).connect();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const cards=(await db.query("SELECT card.id,card.title FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='character' AND type.status='published' WHERE card.space_id=$1 AND card.status='active' AND card.current_version_id IS NOT NULL ORDER BY card.id LIMIT 201",[PUBLIC_CHARACTER_SPACE_ID])).rows,items=[];for(const card of cards.slice(0,200)){const versions=(await db.query('SELECT id,revision,title FROM new_design.card_versions WHERE card_id=$1 ORDER BY revision DESC LIMIT 51',[card.id])).rows;items.push({id:String(card.id),title:String(card.title),versions:versions.slice(0,50).map(row=>({id:String(row.id),revision:Number(row.revision),title:String(row.title)})),versionsTruncated:versions.length>50});}await db.query('COMMIT');return{items,truncated:cards.length>200};}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
