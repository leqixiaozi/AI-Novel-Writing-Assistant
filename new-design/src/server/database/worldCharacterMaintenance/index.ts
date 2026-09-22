import {storyRecordCtes} from '../storyTimeline/persistence';
import {z} from "zod";
import type {PoolClient} from "pg";
import type {CardTypeCapability} from "../../../common/contracts";
import {CARD_TYPE_CAPABILITIES} from "../../../common/contracts";
import {professionalObjectsForMode} from "../../../common/worldCharacterMaintenance";
import type {ProfessionalObject,ProfessionalField,WorldCharacterQuery,WorldCharacterMaintenanceWorkspace} from "../../../common/worldCharacterMaintenance";
import {getNewDesignPool} from "../runtime";
import {getBookInTransaction} from "../templateStore";
import {NewDesignError} from "../../domain/errors";
import {professionalDisplay,professionalRelationAction,professionalFields} from "./presentation";
import {readProfessionalState,readProfessionalKnowledge,readProfessionalMilestones,readProfessionalIssues} from "./sources";
export const worldCharacterQuerySchema=z.object({mode:z.enum(["world","character"]),focusCardId:z.string().uuid().optional()}).strict();
type Row=Record<string,any>;
export {professionalFields,professionalDisplay} from "./presentation";

export async function readProfessionalObjectsInTransaction(client:PoolClient,spaceId:string,focusCardId?:string,cardIds?:string[]):Promise<{objects:ProfessionalObject[];truncated:boolean}>{
 const rows=(await client.query(`SELECT card.id,card.card_type_id,card.current_version_id,card.type_version_id,card.revision,
 type.type_key,type.name type_label,type.status type_status,type.semantic_capabilities,
 version.title,version.values,installed.fields,installed.id installed_id
 FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id
 LEFT JOIN new_design.card_versions version ON version.id=card.current_version_id AND version.card_id=card.id
 LEFT JOIN new_design.card_type_versions installed ON installed.id=card.type_version_id AND installed.card_type_id=type.id
 WHERE card.space_id=$1 AND card.status='active' AND NOT type.is_internal AND ($3::uuid[] IS NULL OR card.id=ANY($3)) ORDER BY CASE WHEN card.id=$2::uuid THEN 0 ELSE 1 END,type.sort_order,card.title,card.id LIMIT 301`,[spaceId,focusCardId??null,cardIds??null])).rows as Row[];
 const scoped=(await client.query(`SELECT definition.card_type_id,definition.card_id,definition.scope,definition.field_key,version.id version_id,version.field_schema
 FROM new_design.field_definitions definition JOIN new_design.field_definition_versions version ON version.id=definition.current_version_id AND version.field_definition_id=definition.id
 WHERE definition.space_id=$1 AND definition.status='active' AND definition.scope IN ('book_type','card') ORDER BY CASE WHEN definition.scope='card' THEN 1 ELSE 0 END,definition.created_at,definition.id`,[spaceId])).rows as Row[];
 const local=(await client.query(`WITH ${storyRecordCtes.card_version_local_values}
SELECT local.card_version_id,definition.field_key,local.value FROM card_version_local_values local
 JOIN new_design.field_definitions definition ON definition.id=local.field_definition_id AND definition.space_id=$1 AND definition.scope='card'
 JOIN new_design.field_definition_versions version ON version.id=local.field_definition_version_id AND version.field_definition_id=definition.id
 WHERE local.card_version_id=ANY($2::uuid[])`,[spaceId,rows.slice(0,300).map(row=>row.current_version_id).filter(Boolean)])).rows as Row[];
 const objects:ProfessionalObject[]=rows.slice(0,300).map(row=>{
  const fields=new Map<string,ProfessionalField>(professionalFields(row.fields).map(field=>[field.key,{field,versionId:String(row.installed_id),origin:"type"}]));
  for(const addition of scoped.filter(item=>item.card_type_id===row.card_type_id&&(item.scope==="book_type"||item.card_id===row.id)))for(const field of professionalFields([addition.field_schema]))fields.set(field.key,{field,versionId:String(addition.version_id),origin:addition.scope==="card"?"local":"book"});
  const values:Record<string,unknown>={...(row.values&&typeof row.values==="object"&&!Array.isArray(row.values)?row.values:{})};for(const item of local.filter(item=>item.card_version_id===row.current_version_id))values[String(item.field_key)]=item.value;
  return{id:String(row.id),title:String(row.title??"资料版本缺失"),typeId:String(row.card_type_id),typeKey:String(row.type_key),typeLabel:String(row.type_label),versionId:row.current_version_id?String(row.current_version_id):null,revision:Number(row.revision),fields:[...fields.values()],values,capabilities:Array.isArray(row.semantic_capabilities)?row.semantic_capabilities.filter((key:string)=>(CARD_TYPE_CAPABILITIES as readonly string[]).includes(key)) as CardTypeCapability[]:[],unavailableReason:!row.installed_id?"已安装的正式字段版本缺失，请核对本书内容类型。":!row.current_version_id||!row.title?"正式资料版本缺失，不能冒充已保存档案。":row.type_status!=="published"?"内容类型当前未正式发布；历史档案保留，编辑前请核对规格。":null};
 });
 return{objects,truncated:rows.length>300};
}

export async function getWorldCharacterMaintenanceWorkspace(bookId:string,input:WorldCharacterQuery):Promise<WorldCharacterMaintenanceWorkspace>{
 const id=z.string().uuid().parse(bookId),query=worldCharacterQuerySchema.parse(input),client=await(await getNewDesignPool()).connect();
 try{
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");const book=await getBookInTransaction(client,id);if(book.status!=="active")throw new NewDesignError("本书已归档，专业维护不覆盖历史结果。",409);
  const read=await readProfessionalObjectsInTransaction(client,book.spaceId,query.focusCardId),objects=read.objects;if(query.focusCardId&&!professionalObjectsForMode(objects,query.mode).some(object=>object.id===query.focusCardId))throw new NewDesignError("所选资料不属于本书当前专业视图的有效档案，请重新选择中文资料；不会默默换成其他首项。",422,{focusCardId:"所选对象不属于本书当前专业视图有效范围。"});
  const dictionaryRows=(await client.query(`WITH ${storyRecordCtes.dictionary_items},
${storyRecordCtes.dictionary_definitions},
${storyRecordCtes.dictionary_item_versions}
SELECT item.dictionary_id,item.id,version.label FROM dictionary_items item JOIN dictionary_definitions definition ON definition.id=item.dictionary_id
   JOIN dictionary_item_versions version ON version.id=item.current_version_id AND version.item_id=item.id
   WHERE item.status='active' AND definition.status='published' AND version.status='active' AND (definition.owner_space_id IS NULL OR definition.owner_space_id=$1)`,[book.spaceId])).rows;
  const dictionaryLabels=new Map<string,string>(dictionaryRows.map(row=>[`${row.dictionary_id}:${row.id}`,String(row.label)])),objectLabels=new Map(objects.map(object=>[object.id,object.title]));
  const relationRows=(await client.query(`SELECT relation.*,type.name type_label,type.direction,type.status type_status,type.properties_schema,
    source.title source_label,target.title target_label,version.id exact_version_id,
    (version.revision=relation.revision AND version.status=relation.status AND version.properties=relation.properties AND source.status='active' AND target.status='active' AND source.current_version_id IS NOT NULL AND target.current_version_id IS NOT NULL AND source_snapshot.id IS NOT NULL AND target_snapshot.id IS NOT NULL) version_valid
    FROM new_design.card_relations relation JOIN new_design.relation_types type ON type.id=relation.relation_type_id
    JOIN new_design.cards source ON source.id=relation.source_card_id AND source.space_id=relation.space_id JOIN new_design.cards target ON target.id=relation.target_card_id AND target.space_id=relation.space_id
    LEFT JOIN new_design.card_relation_versions version ON version.id=relation.current_version_id AND version.card_relation_id=relation.id
    LEFT JOIN new_design.card_versions source_snapshot ON source_snapshot.id=version.source_card_version_id AND source_snapshot.card_id=source.id
    LEFT JOIN new_design.card_versions target_snapshot ON target_snapshot.id=version.target_card_version_id AND target_snapshot.card_id=target.id
    WHERE relation.space_id=$1 AND relation.status='active' AND (type.owner_space_id IS NULL OR type.owner_space_id=$1) ORDER BY type.name,relation.id LIMIT 201`,[book.spaceId])).rows as Row[];
  const capabilities=(await client.query(`WITH ${storyRecordCtes.state_relation_capabilities}
SELECT * FROM state_relation_capabilities WHERE space_id=ANY($1::uuid[]) ORDER BY CASE WHEN space_id=$2 THEN 1 ELSE 0 END`,[["00000000-0000-4000-8000-000000000001",book.spaceId],book.spaceId])).rows as Row[];
  const dimensions=(await client.query(`WITH ${storyRecordCtes.state_relation_dimensions}
SELECT * FROM state_relation_dimensions WHERE space_id=ANY($1::uuid[]) ORDER BY CASE WHEN space_id=$2 THEN 1 ELSE 0 END`,[["00000000-0000-4000-8000-000000000001",book.spaceId],book.spaceId])).rows as Row[];
  const relationKeys=new Map((await client.query("SELECT id,relation_key FROM new_design.relation_types WHERE id=ANY($1::uuid[])",[relationRows.map(row=>row.relation_type_id)])).rows.map(row=>[row.id,row.relation_key]));
  const modeLabels:Record<string,string>={none:"不结算",absolute:"完整值",delta:"数值增量",derived:"派生只读",lifecycle:"生命周期",relation_state:"关系状态"},policyLabels:Record<string,string>={none:"不结算",tracked:"记录变化",derived:"派生只读",lifecycle:"生命周期",suggested:"建议审阅",required:"需明确审阅"};
  const relations=relationRows.slice(0,200).map(row=>{const fields=professionalFields(row.properties_schema),key=relationKeys.get(row.relation_type_id),cap=capabilities.filter(cap=>cap.relation_key===key).at(-1),effective=new Map<string,Row>();for(const dim of dimensions.filter(dim=>dim.relation_key===key))effective.set(String(dim.dimension_key),dim);return{id:String(row.id),versionId:row.exact_version_id?String(row.exact_version_id):null,revision:Number(row.revision),typeId:String(row.relation_type_id),typeLabel:String(row.type_label),sourceId:String(row.source_card_id),targetId:String(row.target_card_id),sourceLabel:String(row.source_label),targetLabel:String(row.target_label),direction:row.direction as "directed"|"undirected",properties:fields.map(field=>({key:field.key,label:field.name,display:professionalDisplay(row.properties?.[field.key],field,objectLabels,dictionaryLabels)})),settlementLabel:cap&&cap.settlement_capability!=="disabled"?modeLabels[String(cap.state_mode)]??"正式能力需核对":"尚未启用关系结算",dimensions:[...effective.values()].map(dim=>({label:String(dim.label),modeLabel:modeLabels[String(dim.state_mode)]??"历史模式需核对",policyLabel:policyLabels[String(dim.settlement_policy)]??"正式策略需核对"})),available:Boolean(row.version_valid)&&row.type_status==="published",reason:!row.exact_version_id||!row.version_valid?"关系正式版本或端点无效，请明确维护本书关系实例。":row.type_status!=="published"?"关系规格尚未正式发布。":null,action:professionalRelationAction(id)};});
  const state=await readProfessionalState(client,id,objects,relationRows,objectLabels,dictionaryLabels);
  const knowledge=await readProfessionalKnowledge(client,id,objects,objectLabels,dictionaryLabels);
  const milestones=await readProfessionalMilestones(client,id);
  const issues=await readProfessionalIssues(client,id,objects);
  const result:WorldCharacterMaintenanceWorkspace={book,mode:query.mode,focusCardId:query.focusCardId??null,objects,relations,states:state.items,knowledge:knowledge.items,milestones:milestones.items,issues:issues.items,truncated:read.truncated||relationRows.length>200||state.truncated||knowledge.truncated||milestones.truncated||issues.truncated,notes:["资料档案与章节状态是不同事实：修改档案不会替代明确结算。","动机、声音与世界规则按真实正式字段展示；没有字段时不会按名称猜测或自动新增。","AI经统一表单提出候选，作者明确采用到草稿后再正常保存；认知与状态变化仍从来源章节审阅。"]};
  await client.query("COMMIT");return result;
 }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export {readProfessionalState,readProfessionalKnowledge} from "./sources";
