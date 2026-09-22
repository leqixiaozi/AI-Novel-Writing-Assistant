import {settlementRecordCtes,lockedSettlementQuery} from './recordStorage';
import type { PoolClient } from "pg";
import type { FieldDefinition, ChapterSettlementDraft } from "../../../common/contracts";
import type { SettlementEditingCatalog, SettlementFieldChoice, SettlementSubjectChoice } from "../../../common/chapterSettlementEditing";
import { stableHash } from "../aiContracts/integrity";
import { fieldDefinitionSchema } from "../../domain/validation";
import { readBaseline, type EditingRow } from "./editingPolicy";
import {readFrozenSupplementSource} from "./supplementRead";
import {NewDesignError} from "../../domain/errors";
import {resourceCorrectionCandidateCatalog} from '../../../common/resourceSupplements/correction';

const SYSTEM="00000000-0000-4000-8000-000000000001";
function schemas(value:unknown):FieldDefinition[]{
  if(!Array.isArray(value))return[];
  return value.flatMap(item=>{const parsed=fieldDefinitionSchema.safeParse(item);return parsed.success?[parsed.data as FieldDefinition]:[];});
}
function selectOverride(rows:EditingRow[],key:string,value:string,spaceId:string):EditingRow|undefined {
  return rows.find(row=>row[key]===value&&row.space_id===spaceId)??rows.find(row=>row[key]===value&&row.space_id===SYSTEM);
}
function stateCategory(typeKey:string):ChapterSettlementDraft["category"]|null {
  switch(typeKey){case "character":return "character_state";case "prop":return "prop";case "event":return "event";case "foreshadow":return "foreshadow";default:return null;}
}
async function dictionaryNodes(client:PoolClient,field:FieldDefinition,lock:boolean):Promise<SettlementFieldChoice["dictionaryNodes"]>{
  if(field.optionSource?.kind!=="dictionary_tree")return[];
  await lockedSettlementQuery(client,`WITH ${settlementRecordCtes.dictionary_definitions}
SELECT id FROM dictionary_definitions WHERE id=$1 `,[field.optionSource.dictionaryId],lock);
  const rows=await lockedSettlementQuery(client,`WITH ${settlementRecordCtes.dictionary_items},
${settlementRecordCtes.dictionary_item_versions}
SELECT item.id,item.parent_id,item.status,version.id version_id,version.label,version.path_labels FROM dictionary_items item
    JOIN dictionary_item_versions version ON version.id=item.current_version_id WHERE item.dictionary_id=$1 ORDER BY item.sort_order,item.id `,[field.optionSource.dictionaryId],lock);
  return rows.rows.map(row=>({id:String(row.id),parentId:row.parent_id?String(row.parent_id):null,label:String(row.label),path:Array.isArray(row.path_labels)?row.path_labels.map(String):[],versionId:String(row.version_id),status:row.status as "active"|"archived"}));
}
export async function readEditingCatalog(client:PoolClient,session:EditingRow,lock=false):Promise<SettlementEditingCatalog>{
  if(session.adoption_kind==="resource_supplement"){
    const body=(await client.query("SELECT content_hash FROM new_design.chapter_body_versions WHERE id=$1",[session.body_version_id])).rows[0];
    const source=await readFrozenSupplementSource(client,session,String(body?.content_hash??""));
    const frozen={...source.catalog,sessionId:String(session.id),sessionRevision:Number(session.revision)};
    const current=await readEditingCatalog(client,{...session,adoption_kind:"candidate_specification_check"},lock);
    for(const subject of frozen.subjects){
      const live=current.subjects.find(item=>item.id===subject.id&&item.subjectKind===subject.subjectKind);
      const compared=live&&{...live,categories:live.categories.filter(category=>category===(subject.subjectKind==='relation'?'relationship':'prop')),
        fields:live.fields.map(field=>({...field,baseline:subject.fields.find(item=>item.key===field.key)?.baseline}))};
      if(!compared||stableHash(compared)!==stableHash(subject))throw new NewDesignError("原补充资源、字段或字典版本已变化，请保留原清单核对，不能用新规格覆盖。",409);
    }
    if(!(await client.query(`SELECT card.id FROM new_design.cards card JOIN new_design.books book ON book.space_id=card.space_id
      WHERE book.id=$1 AND card.id=$2 AND card.current_version_id=$3 AND card.revision=$4 AND card.status='active'
      ${lock?'FOR SHARE OF card':''}`,[session.book_id,source.resourceScope.characterId,source.resourceScope.characterVersionId,source.resourceScope.characterRevision])).rowCount)
      throw new NewDesignError("原补充人物资料版本已变化，请保留原来源核对。",409);
    return source.contract==='stable_resource_correction_preview_v1'?resourceCorrectionCandidateCatalog(source,String(session.id),Number(session.revision)):frozen;
  }
  const book=(await client.query("SELECT space_id FROM new_design.books WHERE id=$1",[session.book_id])).rows[0],spaceId=String(book?.space_id??"");
  const body=(await client.query("SELECT content_hash FROM new_design.chapter_body_versions WHERE id=$1",[session.body_version_id])).rows[0];
  const cards=(await client.query(`SELECT card.id,card.card_type_id,card.current_version_id,card.type_version_id,card.revision card_revision,
    type.type_key,type.status type_status,type.revision type_revision,type.current_version_id published_version_id,version.fields,COALESCE(current.title,card.title) title
    FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND NOT type.is_internal
    LEFT JOIN new_design.card_type_versions version ON version.id=type.current_version_id AND version.card_type_id=type.id
    LEFT JOIN new_design.card_versions current ON current.id=card.current_version_id
    WHERE card.space_id=$1 AND card.status='active' ORDER BY type.type_key,card.title,card.id ${lock?"FOR SHARE OF card,type":""}`,[spaceId])).rows;
  const types=(await lockedSettlementQuery(client,`WITH ${settlementRecordCtes.state_type_capabilities}
SELECT * FROM state_type_capabilities WHERE space_id=ANY($1::uuid[]) `,[[SYSTEM,spaceId]],lock)).rows;
  const policies=(await lockedSettlementQuery(client,`WITH ${settlementRecordCtes.state_field_policies}
SELECT * FROM state_field_policies WHERE space_id=ANY($1::uuid[]) `,[[SYSTEM,spaceId]],lock)).rows;
  const relationCaps=(await lockedSettlementQuery(client,`WITH ${settlementRecordCtes.state_relation_capabilities}
SELECT * FROM state_relation_capabilities WHERE space_id=ANY($1::uuid[]) `,[[SYSTEM,spaceId]],lock)).rows;
  const dimensions=(await lockedSettlementQuery(client,`WITH ${settlementRecordCtes.state_relation_dimensions}
SELECT * FROM state_relation_dimensions WHERE space_id=ANY($1::uuid[]) `,[[SYSTEM,spaceId]],lock)).rows;
  const scoped=(await client.query(`SELECT definition.id,definition.card_id,definition.card_type_id,definition.scope,definition.field_key,definition.revision,version.id version_id,version.field_schema
    FROM new_design.field_definitions definition JOIN new_design.field_definition_versions version ON version.id=definition.current_version_id
    WHERE definition.space_id=$1 AND definition.status='active' AND definition.scope IN ('book_type','card') ORDER BY definition.created_at,definition.id ${lock?"FOR SHARE OF definition":""}`,[spaceId])).rows;
  const subjects:SettlementSubjectChoice[]=[];
  for(const card of cards){
    const capability=selectOverride(types,"type_key",String(card.type_key),spaceId);
    const effective=new Map(schemas(card.fields).map(field=>[field.key,{field,versionId:String(card.published_version_id),revision:Number(card.type_revision)}]));
    for(const row of scoped.filter(row=>row.card_type_id===card.card_type_id&&(row.scope==="book_type"||row.card_id===card.id))){
      const parsed=schemas([row.field_schema])[0];if(parsed)effective.set(parsed.key,{field:parsed,versionId:String(row.version_id),revision:Number(row.revision)});
    }
    const fields:SettlementFieldChoice[]=[];
    if(card.type_status==="published"&&card.published_version_id&&card.current_version_id){
      for(const {field,versionId,revision} of effective.values()){
        const applicable=policies.filter(row=>row.type_key===card.type_key),policy=selectOverride(applicable,"field_key",field.key,spaceId);
        const tracked=field.stateSettlement==="tracked"||field.stateSettlement==="lifecycle"||field.optionSource?.kind==="dictionary_tree"&&field.optionSource.settleOnChapter;
        const direct=tracked&&capability?.settlement_capability!=="disabled"&&capability?.state_mode!=="none"&&(!policy||!["none","derived"].includes(String(policy.settlement_policy)));
        if(!direct)continue;
        const mode=field.stateSettlement==="lifecycle"||policy?.state_mode==="lifecycle"||capability?.state_mode==="lifecycle"?"lifecycle":policy?.state_mode==="delta"?"delta":"absolute";
        if(mode==="delta"&&field.type!=="number")continue;
        const nodes=await dictionaryNodes(client,field,lock);
        const specificationHash=stableHash({kind:"card",cardId:card.id,typeVersionId:card.published_version_id,fieldVersionId:versionId,fieldRevision:revision,field,capability:capability??null,policy:policy??null,nodes});
        const baseline=await readBaseline(client,session,"card",String(card.id),field.key,field,nodes,lock);
        fields.push({key:field.key,label:field.name,field,mode,specificationHash,typeVersionId:String(card.published_version_id),relationTypeId:null,relationTypeRevision:null,capabilityRevision:capability?Number(capability.revision):null,dimensionRevision:policy?Number(policy.revision):null,dictionaryNodes:nodes,baseline});
      }
    }
    const category=stateCategory(String(card.type_key));
    subjects.push({id:String(card.id),subjectKind:"card",label:String(card.title),typeKey:String(card.type_key),currentVersionId:card.current_version_id?String(card.current_version_id):null,categories:category?["fact","knowledge",category]:["fact","knowledge"],fields,unavailableReason:card.type_status!=="published"?"内容类型没有正式发布版本。":!card.current_version_id?"对象没有正式资料版本。":!fields.length?"没有已发布且允许结算的字段；请在内容类型中配置正式字段。":null});
  }
  const relations=(await client.query(`SELECT relation.id,relation.revision,version.id current_version_id,relation.relation_type_id,type.relation_key,type.name,type.status type_status,type.revision type_revision,type.properties_schema,
    source.title source_title,target.title target_title FROM new_design.card_relations relation JOIN new_design.relation_types type ON type.id=relation.relation_type_id
    LEFT JOIN new_design.card_relation_versions version ON version.id=relation.current_version_id AND version.card_relation_id=relation.id AND version.revision=relation.revision AND version.status=relation.status AND version.properties=relation.properties
    JOIN new_design.cards source ON source.id=relation.source_card_id AND source.space_id=relation.space_id AND source.status='active'
    JOIN new_design.cards target ON target.id=relation.target_card_id AND target.space_id=relation.space_id AND target.status='active'
    WHERE relation.space_id=$1 AND relation.status='active' AND (type.owner_space_id=$1 OR type.owner_space_id IS NULL)
    ORDER BY type.name,relation.id ${lock?"FOR SHARE OF relation,type,source,target":""}`,[spaceId])).rows;
  for(const relation of relations){
    const cap=selectOverride(relationCaps,"relation_key",String(relation.relation_key),spaceId),fields:SettlementFieldChoice[]=[];
    if(relation.type_status==="published"&&relation.current_version_id&&cap&&cap.settlement_capability!=="disabled"&&cap.state_mode!=="none"){
      for(const field of schemas(relation.properties_schema)){
        const dim=selectOverride(dimensions.filter(row=>row.relation_key===relation.relation_key),"dimension_key",field.key,spaceId);
        if(!dim||dim.settlement_policy==="derived"||dim.state_mode==="derived")continue;
        const mode=dim.state_mode==="delta"?"delta":dim.state_mode==="lifecycle"?"lifecycle":"absolute";
        if(mode==="delta"&&field.type!=="number")continue;
        const nodes=await dictionaryNodes(client,field,lock),baseline=await readBaseline(client,session,"relation",String(relation.id),field.key,field,nodes,lock);
        fields.push({key:field.key,label:String(dim.label),field:{...field,name:String(dim.label)},mode,specificationHash:stableHash({kind:"relation",relationTypeId:relation.relation_type_id,relationTypeRevision:relation.type_revision,field,cap,dim,nodes}),typeVersionId:null,relationTypeId:String(relation.relation_type_id),relationTypeRevision:Number(relation.type_revision),capabilityRevision:Number(cap.revision),dimensionRevision:Number(dim.revision),dictionaryNodes:nodes,baseline});
      }
    }
    subjects.push({id:String(relation.id),subjectKind:"relation",label:`${relation.source_title} → ${relation.target_title} · ${relation.name}`,typeKey:`relation:${relation.relation_key}`,currentVersionId:relation.current_version_id?String(relation.current_version_id):null,categories:["relationship"],fields,unavailableReason:relation.type_status!=="published"?"关系规格未正式发布。":!relation.current_version_id?"关系实例缺少正式版本，请在关系配置中明确维护本书实例。":!fields.length?"关系维度缺少正式值类型或可结算能力，请在正式关系规格中补充。":null});
  }
  return{sessionId:String(session.id),bodyVersionId:String(session.body_version_id),bodyContentHash:String(body?.content_hash??""),sessionRevision:Number(session.revision),subjects,objectChoices:cards.filter(card=>card.type_status==="published"&&card.current_version_id).map(card=>({id:String(card.id),label:String(card.title),typeKey:String(card.type_key)})),holderChoices:cards.filter(card=>card.type_key==="character"&&card.type_status==="published"&&card.current_version_id).map(card=>({id:String(card.id),label:String(card.title)})),specificationHash:stableHash(subjects.map(subject=>({id:subject.id,fields:subject.fields.map(field=>field.specificationHash),unavailableReason:subject.unavailableReason})))};
}
