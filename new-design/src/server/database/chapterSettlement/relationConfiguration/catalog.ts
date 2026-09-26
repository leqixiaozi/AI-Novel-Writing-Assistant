import {settlementRecordCtes} from '../recordStorage';
import type {PoolClient} from "pg";
import type {FieldDefinition} from "../../../../common/contracts";
import type {SettlementRelationConfigurationWorkspace,SettlementRelationDefinition,SettlementRelationDraft} from "../../../../common/chapterSettlementEditing";
import {parsedDefinition,relationError,parseExistingField} from "./policy";
export type Row=Record<string,unknown>;
export async function readBook(client:PoolClient,id:string,lock=false):Promise<Row>{const row=(await client.query(`SELECT * FROM new_design.books WHERE id=$1 AND status='active' ${lock?"FOR SHARE":""}`,[id])).rows[0];if(!row)relationError(id,"本书不可用，请返回书架确认。",404);return row;}
export function mapDraft(row:Row):SettlementRelationDraft{return{id:String(row.id),bookId:String(row.book_id),revision:Number(row.revision),versionId:String(row.current_version_id),version:Number(row.version),status:row.status as "draft"|"published",relationTypeId:row.relation_type_id?String(row.relation_type_id):null,sourceRelationTypeId:row.source_relation_type_id?String(row.source_relation_type_id):null,expectedRelationTypeRevision:row.expected_relation_type_revision===null?null:Number(row.expected_relation_type_revision),definition:row.definition as SettlementRelationDefinition};}
export async function readConfigurationWorkspace(client:PoolClient,bookId:string):Promise<SettlementRelationConfigurationWorkspace>{
 const book=await readBook(client,bookId);const space=String(book.space_id);
 const typeRows=(await client.query("SELECT type_key,name,space_id FROM new_design.card_types WHERE NOT is_internal AND status='published' AND current_version_id IS NOT NULL AND space_id IN($1,'00000000-0000-4000-8000-000000000001') ORDER BY CASE WHEN space_id=$1 THEN 0 ELSE 1 END,name",[space])).rows;
 const types:Array<{key:string;label:string}>=[];for(const row of typeRows)if(!types.some(t=>t.key===row.type_key))types.push({key:String(row.type_key),label:String(row.name)});
 const cards=(await client.query("SELECT card.id,card.title,type.type_key FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND NOT type.is_internal WHERE card.space_id=$1 AND card.status='active' AND card.current_version_id IS NOT NULL AND type.status='published' AND type.current_version_id IS NOT NULL ORDER BY card.title",[space])).rows;
 const relations=(await client.query("SELECT relation.id,relation.revision,relation.relation_type_id,source.title source_name,target.title target_name,type.name FROM new_design.card_relations relation JOIN new_design.cards source ON source.id=relation.source_card_id JOIN new_design.cards target ON target.id=relation.target_card_id JOIN new_design.relation_types type ON type.id=relation.relation_type_id WHERE relation.space_id=$1 AND relation.status='active' ORDER BY type.name,source.title",[space])).rows;
 const caps=(await client.query(`WITH ${settlementRecordCtes.state_relation_capabilities}
SELECT * FROM state_relation_capabilities WHERE space_id IN($1,'00000000-0000-4000-8000-000000000001') ORDER BY CASE WHEN space_id=$1 THEN 0 ELSE 1 END`,[space])).rows;
 const dims=(await client.query(`WITH ${settlementRecordCtes.state_relation_dimensions}
SELECT * FROM state_relation_dimensions WHERE space_id IN($1,'00000000-0000-4000-8000-000000000001')`,[space])).rows;
 const publishedRows=(await client.query("SELECT * FROM new_design.relation_types WHERE status='published' AND(owner_space_id=$1 OR owner_space_id IS NULL) ORDER BY name",[space])).rows;
 const published=publishedRows.map(row=>{
   const cap=caps.find(c=>c.relation_key===row.relation_key);const fields:FieldDefinition[]=[];let valid=Array.isArray(row.properties_schema);
   for(const [index,value] of (Array.isArray(row.properties_schema)?row.properties_schema:[]).entries()){const parsed=parseExistingField(value,index);if(parsed)fields.push(parsed as FieldDefinition);else valid=false;}
   const effectiveDims=new Map<string,Row>();for(const dimension of dims.filter(d=>d.relation_key===row.relation_key).sort((a,b)=>a.space_id===space?-1:b.space_id===space?1:0))if(!effectiveDims.has(String(dimension.dimension_key)))effectiveDims.set(String(dimension.dimension_key),dimension);
   const definition={name:String(row.name),description:String(row.description),direction:row.direction,sourceTypeKeys:row.source_type_keys,targetTypeKeys:row.target_type_keys,sourceMax:row.source_max,targetMax:row.target_max,fields,capability:cap?.settlement_capability??"disabled",mode:cap?.state_mode??"none",dimensions:[...effectiveDims.values()].map(d=>({fieldKey:String(d.dimension_key),label:String(d.label),direction:d.direction,policy:d.settlement_policy,mode:d.state_mode}))};
   const checked=parsedDefinition(definition);return{id:String(row.id),key:String(row.relation_key),name:String(row.name),revision:Number(row.revision),scope:row.scope as "system"|"template"|"book",ownerSpaceId:row.owner_space_id?String(row.owner_space_id):null,editable:valid&&Boolean(checked),definition:(checked??definition) as SettlementRelationDefinition,instanceIds:relations.filter(r=>r.relation_type_id===row.id).map(r=>String(r.id)),unavailableReason:valid&&checked?null:"历史规格缺少完整字段或维度定义，请明确补齐后保存为本书草稿。"};
 });
 const drafts=(await client.query(`WITH ${settlementRecordCtes.settlement_relation_configuration_drafts},
${settlementRecordCtes.settlement_relation_configuration_versions}
SELECT draft.*,version.version,version.definition FROM settlement_relation_configuration_drafts draft JOIN settlement_relation_configuration_versions version ON version.id=draft.current_version_id AND version.draft_id=draft.id WHERE draft.book_id=$1 ORDER BY draft.updated_at DESC`,[bookId])).rows.map(mapDraft);
 return{bookId,bookName:String(book.name),spaceId:space,types,objects:cards.map(r=>({id:String(r.id),label:String(r.title),typeKey:String(r.type_key)})),relations:relations.map(r=>({id:String(r.id),label:`${r.source_name} → ${r.target_name} · ${r.name}`,revision:Number(r.revision),relationTypeId:String(r.relation_type_id)})),published,drafts};
}
