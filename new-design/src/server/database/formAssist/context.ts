import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { FieldDefinition, TreeSelectionRule } from "../../../common/contracts";
import type { FormAssistSnapshot, FormAssistTarget, FormAssistTree } from "../../../common/formAssist";
import { NewDesignError, assertFound } from "../../domain/errors";
import { validateTreeSelection } from "../../../common/treePolicy";
import type {KnowledgeSourceSelection} from "../../../common/knowledgeReference/selection";
import {freezeFormKnowledge} from "./knowledge";
import {findRecordCard,listRecordCards} from "../recordCards";

type Queryable=Pick<PoolClient,"query">;
export function formHash(value:unknown):string {
  const canonical=(item:unknown):unknown=>Array.isArray(item)?item.map(canonical):item&&typeof item==="object"?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,canonical(child)])):item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
const DEFAULT_RULE:TreeSelectionRule={mode:"multiple",rootNodeId:null,depthMode:"whole_tree",relativeDepth:null,leafOnly:false,allowParentSelection:true,showFullPath:true,allowInlineCreate:false,aiSuggestible:true,minSelections:0,maxSelections:null};

export async function freezeFormContext(db:Queryable,target:FormAssistTarget,values:Record<string,unknown>,tagIds:string[],referenceCardIds:string[]=[],referenceKnowledgeSources:KnowledgeSourceSelection[]=[]):Promise<FormAssistSnapshot> {
  const book=assertFound((await db.query("SELECT space_id,status FROM new_design.books WHERE id=$1",[target.bookId])).rows[0],"本书不存在。");
  if(book.status!=="active")throw new NewDesignError("书籍已归档，请先恢复书籍。",409);
  const type=assertFound((await db.query(`SELECT type.type_key,type.current_version_id,type.revision,version.fields FROM new_design.card_types type
    JOIN new_design.card_type_versions version ON version.id=type.current_version_id
    WHERE type.id=$1 AND type.space_id=$2 AND type.status='published'`,[target.cardTypeId,book.space_id])).rows[0],"内容类型不属于本书已发布规格。");
  if(type.current_version_id!==target.typeVersionId)throw new NewDesignError("内容规格已更新，请复核表单后重新生成。",409);
  let card:Record<string,unknown>|null=null;
  if(target.cardId){const found=assertFound((await db.query("SELECT revision,type_version_id,current_version_id FROM new_design.cards WHERE id=$1 AND space_id=$2 AND card_type_id=$3 AND status='active'",[target.cardId,book.space_id,target.cardTypeId])).rows[0],"资料不属于本书可编辑范围。");card=found;if(Number(found.revision)!==target.cardRevision)throw new NewDesignError("资料已在其他页面保存，请先复核；本地草稿会保留。",409);}
  let form:Record<string,unknown>|null=null;
  if(target.formVersionId){const version=await findRecordCard(db,target.formVersionId,"card_group_form_version",{includeArchived:true}),owner=version?await findRecordCard(db,String(version.form_id),"card_group_form",{spaceId:String(book.space_id),includeArchived:true}):null;form=assertFound(version&&owner&&owner.status==='published'&&version.definition?.primaryTypeKey===type.type_key?{definition:version.definition,revision:owner.revision}:null,"填写表单已更新或不属于本书，请复核后重试。");}
  const locals=target.cardId?(await db.query(`SELECT definition.id,definition.field_key,definition.current_version_id,version.field_schema
    FROM new_design.field_definitions definition JOIN new_design.field_definition_versions version ON version.id=definition.current_version_id
    WHERE definition.card_id=$1 AND definition.scope='card' AND definition.status='active' ORDER BY definition.field_key`,[target.cardId])).rows:[];
  const fields=[...(type.fields as FieldDefinition[]),...locals.map(row=>row.field_schema as FieldDefinition)];
  const trees:FormAssistTree[]=[];
  for(const field of fields){const source=field.optionSource;if(source?.kind!=="dictionary_tree")continue;
    const dictionary=assertFound(await findRecordCard(db,source.dictionaryId,"dictionary_definition",{includeArchived:true}),"表单字典已停用或属于其他书籍。");if(dictionary.status==='archived'||dictionary.owner_space_id&&String(dictionary.owner_space_id)!==String(book.space_id))throw new NewDesignError("表单字典已停用或属于其他书籍。",422);
    const itemRows=(await listRecordCards(db,"dictionary_item",{includeArchived:true})).filter(item=>String(item.dictionary_id)===String(dictionary.id)),itemVersions=await listRecordCards(db,"dictionary_item_version",{includeArchived:true}),nodes=itemRows.map(item=>({...item,parent_id:item.parent_id as string|null,label:String(item.label),path_labels:itemVersions.find(version=>String(version.id)===String(item.current_version_id))?.path_labels as string[]|undefined})).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    trees.push({kind:"dictionary",key:field.key,name:dictionary.name,sourceId:dictionary.id,scope:dictionary.scope,revision:Number(dictionary.revision),rule:source.rule,nodes:nodes.map(row=>({id:row.id,parentId:row.parent_id,name:row.label,status:row.status as 'active'|'archived',revision:Number(row.revision),path:row.path_labels??[row.label]}))});
  }
  const bindingRows=(await listRecordCards(db,"card_type_tag_binding",{includeArchived:true})).filter(binding=>String(binding.card_type_id)===target.cardTypeId&&binding.status==='active'),dimensions=await listRecordCards(db,"material_tag_dimension",{includeArchived:true});
  const bindings=bindingRows.map(binding=>{
    const dimension=dimensions.find(row=>String(row.id)===String(binding.dimension_id));
    return {...binding,...dimension,dimension_id:binding.dimension_id as string,owner_space_id:dimension?.owner_space_id as string|null,
      dimension_key:dimension?.dimension_key as string,name:dimension?.name as string,scope:dimension?.scope as string,
      binding_revision:binding.revision,config:binding.config};
  }).filter(binding=>binding.status==='active'&&(!binding.owner_space_id||String(binding.owner_space_id)===String(book.space_id))).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  for(const binding of bindings){const tags=await listRecordCards(db,"material_tag",{includeArchived:true,where:{dimension_id:binding.dimension_id}}),tagVersions=await listRecordCards(db,"material_tag_version",{includeArchived:true}),nodes=tags.flatMap(tag=>{const version=tagVersions.find(item=>item.id===tag.current_version_id);return version?[{...tag,parent_id:tag.parent_id as string|null,name:String(version.name),path_names:version.path_names as string[]|undefined}]:[];}).sort((a,b)=>a.id.localeCompare(b.id));
    trees.push({kind:"tag",key:binding.dimension_key,name:binding.name,sourceId:binding.id,scope:binding.scope,revision:Number(binding.revision),rule:{...DEFAULT_RULE,...binding.config.rule,aiSuggestible:binding.config.includeInAiContext!==false&&binding.config.rule?.aiSuggestible!==false},nodes:nodes.map(row=>({id:row.id,parentId:row.parent_id,name:row.name,status:row.status as 'active'|'archived',revision:Number(row.revision),path:row.path_names??[row.name]}))});
  }
  const relations=target.cardId?(await db.query(`SELECT relation.id,relation.revision,relation.relation_type_id,relation.properties,source.id source_id,source.revision source_revision,source.current_version_id source_version,source.title source_title,source.values source_values,
    destination.id target_id,destination.revision target_revision,destination.current_version_id target_version,destination.title target_title,destination.values target_values
    FROM new_design.card_relations relation JOIN new_design.cards source ON source.id=relation.source_card_id JOIN new_design.cards destination ON destination.id=relation.target_card_id
    WHERE relation.space_id=$1 AND relation.status='active' AND source.space_id=$1 AND destination.space_id=$1 AND (source.id=$2 OR destination.id=$2) ORDER BY relation.id`,[book.space_id,target.cardId])).rows:[];
  const savedTags=target.cardId?(await listRecordCards(db,"material_tag_membership",{spaceId:String(book.space_id),includeArchived:true})).filter(item=>String(item.card_id)===target.cardId&&item.status==='active').sort((a,b)=>String(a.tag_id).localeCompare(String(b.tag_id))).map(item=>({tag_id:item.tag_id,revision:item.revision,current_version_id:item.current_version_id})):[];
  const mounts=[] as Record<string,unknown>[];if(target.cardId){const instances=(await listRecordCards(db,"card_group_form_instance",{spaceId:String(book.space_id),includeArchived:true})).filter(item=>String(item.primary_card_id)===target.cardId),allMounts=await listRecordCards(db,"card_mount",{spaceId:String(book.space_id),includeArchived:true});for(const mount of allMounts.filter(item=>instances.some(instance=>String(instance.id)===String(item.form_instance_id)))){const instance=instances.find(item=>String(item.id)===String(mount.form_instance_id))!,source=(await db.query("SELECT id,title,values,revision,current_version_id FROM new_design.cards WHERE id=$1 AND space_id=$2",[mount.card_id,book.space_id])).rows[0];if(source)mounts.push({...mount,form_version_id:instance.form_version_id,form_revision:instance.revision,source_id:source.id,title:source.title,values:source.values,source_revision:source.revision,source_version:source.current_version_id});}}
  // Source fingerprint excludes unsaved draft values/title, but includes their official inputs and allowed scope.
  const references=(await db.query("SELECT id,title,values,revision,current_version_id,type_version_id FROM new_design.cards WHERE id=ANY($1::uuid[]) AND space_id=$2 AND status='active' ORDER BY id",[referenceCardIds,book.space_id])).rows;
  if(new Set(referenceCardIds).size!==referenceCardIds.length||references.length!==referenceCardIds.length)throw new NewDesignError("参考资料已停用或不属于本书。",422);
  const knowledgeReferences=await freezeFormKnowledge(db,target.bookId,referenceKnowledgeSources);
  const sourceHash=formHash({book,type,card,form,locals,trees,bindings,relations,mounts,savedTags,...(referenceCardIds.length?{references}:{}),...(knowledgeReferences.length?{knowledgeReferences}:{})});
  const draftTags=(await listRecordCards(db,"material_tag",{spaceId:String(book.space_id),includeArchived:true})).filter(item=>tagIds.includes(String(item.id))&&item.status==='active');
  if(new Set(tagIds).size!==tagIds.length||draftTags.length!==tagIds.length)throw new NewDesignError("草稿标签已停用或不属于本书。",422);
  for(const tree of trees.filter(tree=>tree.kind==="tag")){const ids=tagIds.filter(id=>tree.nodes.some(node=>node.id===id)),checked=validateTreeSelection(tree.nodes,{...tree.rule,minSelections:0},ids);if(!checked.valid)throw new NewDesignError(`请修正${tree.name}的草稿选择：${checked.message}`,422);}
  return {target,fields,localFieldKeys:locals.map(row=>String(row.field_key)),values,tagIds,trees,relations:[...relations,...mounts,...references.map(row=>({...row,referenceKind:"author_selected_card"}))],sourceHash,referenceCardIds,...(knowledgeReferences.length?{referenceKnowledgeSources,knowledgeReferences}:{})};
}
