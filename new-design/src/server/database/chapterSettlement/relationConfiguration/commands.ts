import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {SettlementRelationConfigurationReceipt,SettlementRelationDraftInput,SettlementRelationPublishInput,SettlementRelationDefinition} from "../../../../common/chapterSettlementEditing";
import type {FieldDefinition} from "../../../../common/contracts";
import {stableHash} from "../../aiContracts/integrity";
import {getNewDesignPool,inSettlementTransaction} from "../transaction";
import {readBook,readConfigurationWorkspace,type Row} from "./catalog";
import {settlementRelationDraftInputSchema,settlementRelationPublishInputSchema,validateDefinition,relationError,normalizeError,parsedDefinition,parseExistingField} from "./policy";
import {validateFieldValue} from "../../../domain/validation";
import {validateDictionaryTreeValues} from "../../treeResources";
import {readBaseline} from "../editingPolicy";

const lockKey=(client:PoolClient,book:string,key:string)=>client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`settlement_relation_configuration:${book}:${key}`]);
async function mutate(bookId:string,key:string,input:unknown,operation:"save_draft"|"publish",action:(client:PoolClient,book:Row)=>Promise<{draftId:string;versionId:string;relationTypeId:string|null}>):Promise<SettlementRelationConfigurationReceipt>{
 const client=await (await getNewDesignPool()).connect();let committing=false;
 try{await client.query("BEGIN");await lockKey(client,bookId,key);const hash=stableHash({bookId,operation,input});
  const prior=(await client.query("SELECT input_hash,receipt FROM new_design.settlement_relation_configuration_receipts WHERE book_id=$1 AND request_key=$2",[bookId,key])).rows[0];
  if(prior){if(prior.input_hash!==hash)relationError(bookId,"同一请求对应不同内容，请核对原回执。",409);const receipt={...prior.receipt,repeated:true} as SettlementRelationConfigurationReceipt;committing=true;await client.query("COMMIT");return receipt;}
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`chapter_settlement_editing_book:${bookId}`]);const book=await readBook(client,bookId,true);
  const result=await inSettlementTransaction(client,()=>action(client,book));
  const receipt:SettlementRelationConfigurationReceipt={bookId,requestKey:key,operation,...result,repeated:false,workspace:await readConfigurationWorkspace(client,bookId)};
  await client.query("INSERT INTO new_design.settlement_relation_configuration_receipts(id,book_id,request_key,input_hash,receipt) VALUES($1,$2,$3,$4,$5::jsonb)",[randomUUID(),bookId,key,hash,JSON.stringify(receipt)]);
  committing=true;await client.query("COMMIT");return receipt;
 }catch(error){let rolledBack=false;try{await client.query("ROLLBACK");rolledBack=true;}catch{}normalizeError(bookId,error,rolledBack,committing);}finally{client.release();}
}
async function loadType(client:PoolClient,bookId:string,spaceId:string,id:string,revision:number|null,owned:boolean):Promise<Row>{const row=(await client.query("SELECT * FROM new_design.relation_types WHERE id=$1 AND status='published' FOR UPDATE",[id])).rows[0];if(!row||Number(row.revision)!==revision)relationError(bookId,"正式关系规格已改变，请重新读取后准备草稿。",409);if(owned?(row.owner_space_id!==spaceId||row.scope!=="book"):(row.owner_space_id!==null&&row.owner_space_id!==spaceId))relationError(bookId,"不能改写其他范围的关系规格。",422);return row;}
export async function saveSettlementRelationConfigurationDraft(bookId:string,raw:SettlementRelationDraftInput):Promise<SettlementRelationConfigurationReceipt>{
 const input=settlementRelationDraftInputSchema.parse(raw) as SettlementRelationDraftInput;
 return mutate(bookId,input.requestKey,input,"save_draft",async(client,book)=>{
  const space=String(book.space_id);await validateDefinition(client,bookId,space,input.definition);
  if(input.relationTypeId)await loadType(client,bookId,space,input.relationTypeId,input.expectedRelationTypeRevision,true);
  if(input.sourceRelationTypeId)await loadType(client,bookId,space,input.sourceRelationTypeId,input.expectedRelationTypeRevision,false);
  let draftId=input.draftId??randomUUID();let version=1;
  if(input.draftId){const row=(await client.query("SELECT * FROM new_design.settlement_relation_configuration_drafts WHERE id=$1 AND book_id=$2 FOR UPDATE",[draftId,bookId])).rows[0];if(!row||Number(row.revision)!==input.expectedRevision)relationError(bookId,"草稿已更新，请先核对保存回执。",409);version=Number((await client.query("SELECT MAX(version) version FROM new_design.settlement_relation_configuration_versions WHERE draft_id=$1",[draftId])).rows[0].version)+1;
    if(row.relation_type_id&&(input.relationTypeId!==row.relation_type_id||input.sourceRelationTypeId))relationError(bookId,"已发布草稿必须明确继续编辑原本书规格，不能切换目标。",409);
  }else await client.query("INSERT INTO new_design.settlement_relation_configuration_drafts(id,book_id,revision,status) VALUES($1,$2,1,'draft')",[draftId,bookId]);
  const versionId=randomUUID();await client.query("INSERT INTO new_design.settlement_relation_configuration_versions(id,draft_id,version,definition,relation_type_id,source_relation_type_id,expected_relation_type_revision) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)",[versionId,draftId,version,JSON.stringify(input.definition),input.relationTypeId??null,input.sourceRelationTypeId??null,input.expectedRelationTypeRevision]);
  await client.query("UPDATE new_design.settlement_relation_configuration_drafts SET current_version_id=$2,relation_type_id=$3,source_relation_type_id=$4,expected_relation_type_revision=$5,status='draft',revision=revision+$6,updated_at=now() WHERE id=$1",[draftId,versionId,input.relationTypeId??null,input.sourceRelationTypeId??null,input.expectedRelationTypeRevision,input.draftId?1:0]);
  return{draftId,versionId,relationTypeId:input.relationTypeId??null};
 });
}
async function validateExistingValues(client:PoolClient,bookId:string,spaceId:string,definition:SettlementRelationDefinition,ids:string[]):Promise<void>{
 if(!ids.length)return;
 const rows=(await client.query("SELECT * FROM new_design.current_state_projections WHERE book_id=$1 AND subject_kind='relation' AND subject_id=ANY($2::uuid[]) ORDER BY subject_id,state_key",[bookId,ids])).rows;
 for(const row of rows){const field=definition.fields.find(field=>field.key===row.state_key);if(!field)relationError(bookId,"既有关系包含已建立状态；请保留原字段，不能移除后迁移。",409);const baseline=await readBaseline(client,{book_id:bookId},"relation",String(row.subject_id),String(row.state_key),field,[],true);if(!baseline.known||baseline.stale)relationError(bookId,`${field.name}的前值来源已失效，请先核对原章节结算。`,409);const message=validateFieldValue(field,baseline.value);if(message)relationError(bookId,`既有${field.name}与新规格不兼容：${message}`,409);const issues=await validateDictionaryTreeValues(client,[field],{[field.key]:baseline.value});if(Object.keys(issues).length)relationError(bookId,`既有${field.name}不在新的字典范围，请保留原范围。`,409,issues);}
 const properties=(await client.query("SELECT id,properties FROM new_design.card_relations WHERE space_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE",[spaceId,ids])).rows;
 for(const row of properties){for(const [key,value] of Object.entries(row.properties??{})){const field=definition.fields.find(f=>f.key===key);if(!field)relationError(bookId,"既有关系属性不能静默移除，请保留原字段。",409);const message=validateFieldValue(field,value);if(message)relationError(bookId,message,409);}for(const field of definition.fields)if(field.required){const message=validateFieldValue(field,row.properties?.[field.key]);if(message)relationError(bookId,`既有关系缺少必填属性：${message}`,409);}const issues=await validateDictionaryTreeValues(client,definition.fields.filter(field=>row.properties?.[field.key]!==undefined),row.properties??{});if(Object.keys(issues).length)relationError(bookId,"既有关系属性不在新字典范围，请保留原范围。",409,issues);}
}
function validateCounts(bookId:string,definition:SettlementRelationDefinition,pairs:Array<{source:string;target:string}>):void{
 const seen=new Set<string>(),sources=new Map<string,number>(),targets=new Map<string,number>();
 for(const pair of pairs){const key=definition.direction==="undirected"?[pair.source,pair.target].sort().join(":"):`${pair.source}:${pair.target}`;if(seen.has(key))relationError(bookId,"新规格下存在重复关系，请先核对实例，不能静默合并。",409);seen.add(key);sources.set(pair.source,(sources.get(pair.source)??0)+1);targets.set(pair.target,(targets.get(pair.target)??0)+1);if(definition.direction==="undirected"){sources.set(pair.target,(sources.get(pair.target)??0)+1);targets.set(pair.source,(targets.get(pair.source)??0)+1);}}
 if(definition.sourceMax!==null&&[...sources.values()].some(count=>count>definition.sourceMax!))relationError(bookId,"来源关系数量超过新规格上限，请保留原上限或减少所选范围。",409);
 if(definition.targetMax!==null&&[...targets.values()].some(count=>count>definition.targetMax!))relationError(bookId,"目标关系数量超过新规格上限，请保留原上限或减少所选范围。",409);
}
async function endpoints(client:PoolClient,bookId:string,space:string,definition:SettlementRelationDefinition,sourceId:string,targetId:string):Promise<void>{
 if(sourceId===targetId)relationError(bookId,"关系两端不能是同一份资料。",422);
 const rows=(await client.query("SELECT card.id,type.type_key FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.id=ANY($1::uuid[]) AND card.space_id=$2 AND card.status='active' AND card.current_version_id IS NOT NULL AND type.status='published' AND type.current_version_id IS NOT NULL FOR SHARE OF card,type",[[sourceId,targetId],space])).rows;
 const source=rows.find(r=>r.id===sourceId),target=rows.find(r=>r.id===targetId);if(!source||!target)relationError(bookId,"关系两端资料已失效，请重新选择。",409);
 if((definition.sourceTypeKeys.length&&!definition.sourceTypeKeys.includes(source.type_key))||(definition.targetTypeKeys.length&&!definition.targetTypeKeys.includes(target.type_key)))relationError(bookId,"关系两端的正式内容类型不符合新规格。",422);
}
async function appendRelationVersion(client:PoolClient,bookId:string,spaceId:string,relationId:string,actor:string):Promise<void>{
 const row=(await client.query(`SELECT relation.*,source.current_version_id source_version_id,target.current_version_id target_version_id
   FROM new_design.card_relations relation JOIN new_design.cards source ON source.id=relation.source_card_id AND source.space_id=relation.space_id
   JOIN new_design.cards target ON target.id=relation.target_card_id AND target.space_id=relation.space_id
   WHERE relation.id=$1 AND relation.space_id=$2 FOR SHARE OF source,target`,[relationId,spaceId])).rows[0];
 if(!row||!row.source_version_id||!row.target_version_id)relationError(bookId,"关系实例缺少两端真实资料版本，不能保存执行来源。",409);
 const versionId=randomUUID();await client.query(`INSERT INTO new_design.card_relation_versions(id,card_relation_id,revision,source_card_version_id,target_card_version_id,status,properties,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,[versionId,relationId,row.revision,row.source_version_id,row.target_version_id,row.status,JSON.stringify(row.properties),actor]);
 await client.query("UPDATE new_design.card_relations SET current_version_id=$2 WHERE id=$1",[relationId,versionId]);
}
export async function publishSettlementRelationConfigurationDraft(bookId:string,raw:SettlementRelationPublishInput):Promise<SettlementRelationConfigurationReceipt>{
 const input=settlementRelationPublishInputSchema.parse(raw) as SettlementRelationPublishInput;
 return mutate(bookId,input.requestKey,input,"publish",async(client,book)=>{
  if(!input.confirmPublish)relationError(bookId,"请明确确认发布此草稿。",422);if(input.rebindRelations.length&&!input.confirmInstanceRebind)relationError(bookId,"请明确确认迁移所选关系实例。",422);if(new Set(input.rebindRelations.map(r=>r.id)).size!==input.rebindRelations.length)relationError(bookId,"迁移关系实例不能重复。",422);
  const space=String(book.space_id);const draft=(await client.query("SELECT draft.*,version.definition,version.id version_id FROM new_design.settlement_relation_configuration_drafts draft JOIN new_design.settlement_relation_configuration_versions version ON version.id=draft.current_version_id AND version.draft_id=draft.id WHERE draft.id=$1 AND draft.book_id=$2 FOR UPDATE OF draft",[input.draftId,bookId])).rows[0];
  if(!draft||draft.status!=="draft"||Number(draft.revision)!==input.expectedRevision)relationError(bookId,"草稿已改变或已发布，请核对原回执。",409);
  const definition=parsedDefinition(draft.definition);if(!definition)relationError(bookId,"草稿包含未知历史规格，不能静默发布。",422);await validateDefinition(client,bookId,space,definition);
  let target:Row|null=null;let source:Row|null=null;
  if(draft.relation_type_id)target=await loadType(client,bookId,space,String(draft.relation_type_id),Number(draft.expected_relation_type_revision),true);
  else if(draft.source_relation_type_id)source=await loadType(client,bookId,space,String(draft.source_relation_type_id),Number(draft.expected_relation_type_revision),false);
  const relationId=target?String(target.id):randomUUID();const relationKey=target?String(target.relation_key):source?String(source.relation_key):`relation_${randomUUID().replace(/-/g,"").slice(0,20)}`;
  if(!target&&(await client.query("SELECT id FROM new_design.relation_types WHERE owner_space_id=$1 AND relation_key=$2",[space,relationKey])).rows.length)relationError(bookId,"本书已存在同名来源规格，请选择该本书规格建立草稿，不能自动覆盖。",409);
  const affected=(await client.query("SELECT * FROM new_design.card_relations WHERE space_id=$1 AND (relation_type_id=$2 OR id=ANY($3::uuid[])) ORDER BY id FOR UPDATE",[space,relationId,input.rebindRelations.map(r=>r.id)])).rows;
  for(const selected of input.rebindRelations){const row=affected.find(r=>r.id===selected.id);const allowedSource=target?.source_relation_type_id??source?.id;if(!row||row.status!=="active"||Number(row.revision)!==selected.expectedRevision||(row.relation_type_id!==relationId&&row.relation_type_id!==allowedSource))relationError(bookId,"所选关系已改变或不属于该来源，请重新读取。",409);}
  for(const row of affected)await endpoints(client,bookId,space,definition,String(row.source_card_id),String(row.target_card_id));
  const projected=affected.filter(row=>row.status==='active').map(row=>({source:String(row.source_card_id),target:String(row.target_card_id)}));for(const created of input.createRelations??[])projected.push({source:created.sourceCardId,target:created.targetCardId});validateCounts(bookId,definition,projected);
  const initialProperties=Object.fromEntries(definition.fields.filter(field=>field.defaultValue!==undefined&&field.defaultValue!==null).map(field=>[field.key,field.defaultValue]));
  if(input.createRelations?.length){for(const field of definition.fields){const message=validateFieldValue(field,initialProperties[field.key]);if(message)relationError(bookId,`新关系实例需要合法属性默认值：${message}`,422);}const issues=await validateDictionaryTreeValues(client,definition.fields.filter(f=>initialProperties[f.key]!==undefined),initialProperties);if(Object.keys(issues).length)relationError(bookId,"新关系默认属性不在正式字典范围。",422,issues);}
  await validateExistingValues(client,bookId,space,definition,affected.map(r=>String(r.id)));
  if(target){const oldFields:FieldDefinition[]=[];for(const [index,value] of (Array.isArray(target.properties_schema)?target.properties_schema:[]).entries()){const parsed=parseExistingField(value,index);if(!parsed)relationError(bookId,"原正式规格含未知字段，不能静默覆盖；请创建新规格。",409);oldFields.push(parsed as FieldDefinition);}for(const field of oldFields){const replacement=definition.fields.find(f=>f.key===field.key);if(!replacement||replacement.type!==field.type||(field.required&&!replacement.required))relationError(bookId,`请保留既有字段“${field.name}”的类型与必填要求。`,409);}}
  const params=[relationId,definition.name,definition.description,definition.direction,definition.sourceTypeKeys,definition.targetTypeKeys,definition.sourceMax,definition.targetMax,JSON.stringify(definition.fields)];
  if(target)await client.query("UPDATE new_design.relation_types SET name=$2,description=$3,direction=$4,source_type_keys=$5,target_type_keys=$6,source_max=$7,target_max=$8,properties_schema=$9::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",params);
  else await client.query("INSERT INTO new_design.relation_types(id,name,description,direction,source_type_keys,target_type_keys,source_max,target_max,properties_schema,relation_key,scope,owner_space_id,status,revision,source_relation_type_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'book',$11,'published',1,$12)",[...params,relationKey,space,source?.id??null]);
  await client.query("INSERT INTO new_design.state_relation_capabilities(space_id,relation_key,settlement_capability,state_mode) VALUES($1,$2,$3,$4) ON CONFLICT(space_id,relation_key) DO UPDATE SET settlement_capability=EXCLUDED.settlement_capability,state_mode=EXCLUDED.state_mode,revision=state_relation_capabilities.revision+1,updated_at=now()",[space,relationKey,definition.capability,definition.mode]);
  await client.query("UPDATE new_design.state_relation_dimensions SET settlement_policy='derived',state_mode='derived',revision=revision+1,updated_at=now() WHERE space_id=$1 AND relation_key=$2 AND NOT(dimension_key=ANY($3::text[]))",[space,relationKey,definition.dimensions.map(d=>d.fieldKey)]);
  const inherited=(await client.query("SELECT * FROM new_design.state_relation_dimensions WHERE space_id='00000000-0000-4000-8000-000000000001' AND relation_key=$1 AND NOT(dimension_key=ANY($2::text[])) FOR SHARE",[relationKey,definition.dimensions.map(d=>d.fieldKey)])).rows;
  for(const retired of inherited)await client.query("INSERT INTO new_design.state_relation_dimensions(space_id,relation_key,dimension_key,label,direction,settlement_policy,state_mode) VALUES($1,$2,$3,$4,$5,'derived','derived') ON CONFLICT(space_id,relation_key,dimension_key) DO UPDATE SET settlement_policy='derived',state_mode='derived',revision=state_relation_dimensions.revision+1,updated_at=now()",[space,relationKey,retired.dimension_key,retired.label,retired.direction]);
  for(const dimension of definition.dimensions)await client.query("INSERT INTO new_design.state_relation_dimensions(space_id,relation_key,dimension_key,label,direction,settlement_policy,state_mode) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(space_id,relation_key,dimension_key) DO UPDATE SET label=EXCLUDED.label,direction=EXCLUDED.direction,settlement_policy=EXCLUDED.settlement_policy,state_mode=EXCLUDED.state_mode,revision=state_relation_dimensions.revision+1,updated_at=now()",[space,relationKey,dimension.fieldKey,dimension.label,dimension.direction,dimension.policy,dimension.mode]);
  for(const selected of input.rebindRelations){await client.query("UPDATE new_design.card_relations SET relation_type_id=$2,revision=revision+1,updated_at=now() WHERE id=$1",[selected.id,relationId]);await appendRelationVersion(client,bookId,space,selected.id,input.actor??"user");}
  for(const created of input.createRelations??[]){await endpoints(client,bookId,space,definition,created.sourceCardId,created.targetCardId);const duplicate=(await client.query("SELECT id FROM new_design.card_relations WHERE space_id=$1 AND relation_type_id=$2 AND source_card_id=$3 AND target_card_id=$4 AND status<>'archived'",[space,relationId,created.sourceCardId,created.targetCardId])).rows[0];if(duplicate)relationError(bookId,"所选关系实例已经存在，请直接维护。",409);const createdId=randomUUID();await client.query("INSERT INTO new_design.card_relations(id,space_id,relation_type_id,source_card_id,target_card_id,properties,status,revision,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,'active',1,$7)",[createdId,space,relationId,created.sourceCardId,created.targetCardId,JSON.stringify(initialProperties),input.actor??"user"]);await appendRelationVersion(client,bookId,space,createdId,input.actor??"user");}
  await client.query("UPDATE new_design.settlement_relation_configuration_drafts SET relation_type_id=$2,source_relation_type_id=NULL,expected_relation_type_revision=$3,status='published',revision=revision+1,updated_at=now() WHERE id=$1",[input.draftId,relationId,target?Number(target.revision)+1:1]);
  return{draftId:input.draftId,versionId:String(draft.version_id),relationTypeId:relationId};
 });
}
export const publishSettlementRelationConfiguration=publishSettlementRelationConfigurationDraft;
export async function getSettlementRelationConfigurationWorkspace(bookId:string){const client=await (await getNewDesignPool()).connect();try{await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");const result=await readConfigurationWorkspace(client,bookId);await client.query("COMMIT");return result;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
export async function readSettlementRelationConfigurationReceipt(bookId:string,key:string):Promise<SettlementRelationConfigurationReceipt|null>{const client=await (await getNewDesignPool()).connect();try{await client.query("BEGIN");await lockKey(client,bookId,key);await readBook(client,bookId);const row=(await client.query("SELECT receipt FROM new_design.settlement_relation_configuration_receipts WHERE book_id=$1 AND request_key=$2",[bookId,key])).rows[0];await client.query("COMMIT");return row?row.receipt as SettlementRelationConfigurationReceipt:null;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
