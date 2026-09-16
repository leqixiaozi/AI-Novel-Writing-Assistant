import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { PROMPT_COMPONENT_RESOURCE_SPACE_ID } from "../../../common/contracts";
import type { CompositionCatalog,CompositionRecipe,CompositionSettings,CompositionSources,SaveCompositionInput,SaveCompositionResult } from "../../../common/promptComposition";
import { getPromptCatalog } from "../promptManagement";
import { listBooks } from "../templateStore";
import { listCardTypes,listCardTypeVersions } from "../store";
import { stableHash } from "../aiContracts";
import { NewDesignError,assertFound } from "../../domain/errors";
import { database,iso,lock,type CompositionDatabaseContext } from "./database";
import { settingsSchema,saveSchema,TASK_FAMILIES,variableSchema } from "./policy";
import type { ExactCompositionComponent,ExactCompositionSource,LoadedCompositionRecipe } from "./contracts";

type Row=Record<string,any>;
const marker="x-new-design-composition";
async function recipeVersion(client:PoolClient,recipe:Row,version:Row):Promise<CompositionRecipe>{
  const metadata=version.variables_schema?.[marker],bindingRows=(await client.query("SELECT binding.* FROM new_design.prompt_recipe_slot_components binding JOIN new_design.prompt_recipe_slots slot ON slot.id=binding.slot_id WHERE binding.recipe_version_id=$1 ORDER BY slot.sort_order,binding.sort_order,binding.id",[version.id])).rows;
  const parsed=settingsSchema.safeParse({taskType:metadata?.taskType,components:bindingRows.map(row=>({cardId:row.component_card_id,versionId:row.component_version_id,enabled:row.enabled})),variables:metadata?.variables,context:metadata?.context});
  const slots=(await client.query("SELECT * FROM new_design.prompt_recipe_slots WHERE recipe_version_id=$1 ORDER BY sort_order",[version.id])).rows;
  const recognized=metadata?.format===1&&typeof metadata.name==="string"&&typeof metadata.description==="string"&&parsed.success&&stableHash(Object.fromEntries(Object.entries(version.variables_schema??{}).filter(([key])=>key!==marker)))===stableHash(variableSchema(parsed.data))&&Object.keys(metadata??{}).every(key=>["format","taskType","variables","context","name","description"].includes(key))&&slots.length===2&&slots[0].slot_key==="author_additions"&&slots[0].sort_order===0&&slots[0].required===false&&stableHash(slots[0].allowed_content_types)===stableHash(["prompt_component"])&&stableHash(slots[0].variable_contract)===stableHash({required:parsed.data.variables.map(item=>item.key)})&&slots[1].slot_key==="explicit_context"&&slots[1].sort_order===1&&slots[1].required===false&&stableHash(slots[1].allowed_content_types)===stableHash(["card_version"])&&stableHash(slots[1].variable_contract)===stableHash({})&&bindingRows.every((row,index)=>row.slot_id===slots[0].id&&row.sort_order===index&&row.required===false);
  const safe:CompositionSettings=parsed.success?parsed.data:{taskType:"directions",components:[],variables:[],context:{bookId:null,sources:[]}};
  return {...safe,id:recipe.id,name:recognized?String(metadata.name):recipe.name,description:recognized?String(metadata.description):recipe.description,revision:Number(recipe.revision),versionId:version.id,version:Number(version.version),publishedVersionId:recipe.published_version_id??null,editable:recognized,configurationIssue:recognized?null:"此历史组合包含未支持的合同或参数，请查看原版本；不能静默替换。"};
}
async function loadVersion(client:PoolClient,id:string,versionId?:string):Promise<{recipe:Row;version:Row;summary:CompositionRecipe}>{
  const recipe=assertFound((await client.query("SELECT * FROM new_design.prompt_recipes WHERE id=$1 AND left(recipe_key,12)='composition_'",[id])).rows[0],"提示词组合不存在。");
  const version=assertFound((await client.query("SELECT * FROM new_design.prompt_recipe_versions WHERE id=$1 AND recipe_id=$2",[versionId??recipe.current_version_id,id])).rows[0],"提示词组合版本不存在。");
  return {recipe,version,summary:await recipeVersion(client,recipe,version)};
}
export async function loadCompositionRecipeVersion(id:string,versionId:string,context?:CompositionDatabaseContext):Promise<LoadedCompositionRecipe>{
  return database(context,async client=>{
    const loaded=await loadVersion(client,id,versionId);if(!loaded.summary.editable)throw new NewDesignError(loaded.summary.configurationIssue!,422);if(loaded.recipe.status!=="active"||loaded.version.status==="rejected")throw new NewDesignError("组合已归档或版本被驳回，不能发起新预览。",422);
    const exact=await loadExactReferences(client,loaded.summary);
    return {recipe:loaded.summary,...exact};
  });
}
export async function loadExactReferences(client:PoolClient,settings:CompositionSettings):Promise<{components:ExactCompositionComponent[];sources:ExactCompositionSource[]}>{
  const components:ExactCompositionComponent[]=[],sources:ExactCompositionSource[]=[];
  for(const binding of settings.components){
    const row=assertFound((await client.query("SELECT card.status,card.space_id,version.title,version.values,type.type_key FROM new_design.card_versions version JOIN new_design.cards card ON card.id=version.card_id JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.id=$1 AND version.id=$2",[binding.cardId,binding.versionId])).rows[0],"提示词组件精确版本不存在。");
    if(row.space_id!==PROMPT_COMPONENT_RESOURCE_SPACE_ID||row.type_key!=="prompt_component"||row.status!=="active")throw new NewDesignError("提示词组件不属于提示词资源或已归档，请重新选择组件。",422);
    const values=row.values??{},families=Array.isArray(values.task_families)?values.task_families:[];
    if(binding.enabled&&(values.enabled!==true||families.length&&!families.some((value:unknown)=>TASK_FAMILIES[settings.taskType].includes(String(value)))))throw new NewDesignError(`“${row.title}”已停用或不适用于此任务，请停用该引用或重新选择组件。`,422);
    if(typeof values.content!=="string"||!values.content.trim())throw new NewDesignError(`“${row.title}”缺少可用组件内容。`,422);
    components.push({...binding,title:row.title,content:values.content,componentType:String(values.component_type??"optional_addition"),taskFamilies:families,trustLevel:String(values.trust_level??"untrusted_data")});
  }
  if(settings.context.bookId){
    const book=assertFound((await client.query("SELECT space_id FROM new_design.books WHERE id=$1 AND status='active'",[settings.context.bookId])).rows[0],"参考书籍不存在或已归档。");
    for(const source of settings.context.sources){
      const row=assertFound((await client.query("SELECT card.status,card.space_id,version.title,version.values,type.type_key FROM new_design.card_versions version JOIN new_design.cards card ON card.id=version.card_id JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.id=$1 AND version.id=$2",[source.cardId,source.versionId])).rows[0],"上下文资料精确版本不存在。");
      if(row.space_id!==book.space_id||row.status!=="active"||row.type_key==="prompt_component")throw new NewDesignError("参考资料属于其他书籍、已归档或不是书内资料，请重新选择。",422);
      sources.push({...source,title:row.title,typeKey:row.type_key,values:row.values??{}});
    }
  }else if(settings.context.sources.length)throw new NewDesignError("参考资料必须属于明确选定的书籍。",422);
  return {components,sources};
}
export async function getCompositionCatalog():Promise<CompositionCatalog>{
  const [prompts,books,types,recipes,rankingSnapshots]=await Promise.all([
    getPromptCatalog(),listBooks(),listCardTypes(),database(undefined,async client=>{const rows=(await client.query("SELECT * FROM new_design.prompt_recipes WHERE left(recipe_key,12)='composition_' AND status='active' ORDER BY updated_at DESC,id")).rows;const results:CompositionRecipe[]=[];for(const row of rows){const version=assertFound((await client.query("SELECT * FROM new_design.prompt_recipe_versions WHERE id=$1",[row.current_version_id])).rows[0],"提示词组合当前版本不存在。");results.push(await recipeVersion(client,row,version));}return results;}),
    database(undefined,async client=>(await client.query("SELECT snapshot.id,snapshot.platform,snapshot.list_label,snapshot.captured_at FROM new_design.market_source_snapshots snapshot WHERE snapshot.status='succeeded' AND EXISTS(SELECT 1 FROM new_design.market_ranking_items item WHERE item.snapshot_id=snapshot.id) ORDER BY snapshot.captured_at DESC,snapshot.id LIMIT 100")).rows.map(row=>({id:row.id,label:`${row.platform} · ${row.list_label} · ${iso(row.captured_at).slice(0,10)}`}))),
  ]);
  const published=[];for(const type of types.filter(item=>item.status==="published"&&item.currentVersionId)){const version=assertFound((await listCardTypeVersions(type.id)).find(item=>item.id===type.currentVersionId),"内容类型发布规格未读取。");published.push({...type,fields:version.fields});}
  const currentIds=await database(undefined,async client=>new Map<string,string>((await client.query("SELECT id,current_version_id FROM new_design.cards WHERE space_id=$1 AND status='active' AND current_version_id IS NOT NULL",[PROMPT_COMPONENT_RESOURCE_SPACE_ID])).rows.map(row=>[row.id,row.current_version_id])));
  return {recipes,prompts:{...prompts,components:prompts.components.filter(item=>currentIds.has(item.id)).map(item=>({...item,currentVersionId:currentIds.get(item.id)!}))},books,types:published,rankingSnapshots};
}
export async function getCompositionSources(bookId:string,context?:CompositionDatabaseContext):Promise<CompositionSources>{
  return database(context,async client=>{
    assertFound((await client.query("SELECT id FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0],"请选择可用书籍后读取资料。");
    const rows=(await client.query("SELECT card.*,type.name AS type_name,version.version AS type_version FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.card_type_versions version ON version.id=card.type_version_id WHERE card.space_id=(SELECT space_id FROM new_design.books WHERE id=$1) AND card.status='active' AND card.current_version_id IS NOT NULL ORDER BY type.sort_order,card.title,card.id LIMIT 201",[bookId])).rows;
    return {bookId,truncated:rows.length>200,cards:rows.slice(0,200).map(row=>({id:row.id,cardTypeId:row.card_type_id,cardTypeName:row.type_name,title:row.title,status:row.status,revision:Number(row.revision),typeVersionId:row.type_version_id,typeVersion:Number(row.type_version),values:row.values??{},currentVersionId:row.current_version_id,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),archivedAt:null}))};
  });
}
export async function readCompositionSaveByRequest(key:string,context?:CompositionDatabaseContext):Promise<SaveCompositionResult|null>{
  return database(context,async client=>{await lock(client,`save-key:${key}`);const receipt=(await client.query("SELECT * FROM new_design.ai_contract_publications WHERE idempotency_key=$1 AND entity_kind='prompt_recipe' AND actor='prompt_composition'",[key])).rows[0];if(!receipt)return null;const {recipe,version,summary}=await loadVersion(client,receipt.entity_id,receipt.to_version_id);return {recipe:summary,savedVersionId:version.id,savedVersion:Number(version.version),active:recipe.status==="active"&&recipe.published_version_id===version.id,repeated:true};},true);
}
export async function saveComposition(value:SaveCompositionInput,context?:CompositionDatabaseContext):Promise<SaveCompositionResult>{
  const input=saveSchema.parse(value),hash=stableHash(input);
  return database(context,async client=>{
    await lock(client,`save-key:${input.idempotencyKey}`);
    const receipt=(await client.query("SELECT * FROM new_design.ai_contract_publications WHERE idempotency_key=$1",[input.idempotencyKey])).rows[0];
    if(receipt){if(receipt.entity_kind!=="prompt_recipe"||receipt.actor!=="prompt_composition")throw new NewDesignError("此保存请求标识已用于其他操作。",409);const loaded=await loadVersion(client,receipt.entity_id,receipt.to_version_id);if(loaded.version.content_hash!==hash)throw new NewDesignError("同一保存请求不能提交不同的组合内容。请核对服务器结果。",409);return {recipe:loaded.summary,savedVersionId:loaded.version.id,savedVersion:Number(loaded.version.version),active:loaded.recipe.status==="active"&&loaded.recipe.published_version_id===loaded.version.id,repeated:true};}
    let recipe:Row;
    if(input.id){await lock(client,`recipe:${input.id}`);recipe=assertFound((await client.query("SELECT * FROM new_design.prompt_recipes WHERE id=$1 AND left(recipe_key,12)='composition_' FOR UPDATE",[input.id])).rows[0],"提示词组合不存在。");const current=await loadVersion(client,input.id);if(!current.summary.editable)throw new NewDesignError("此历史组合包含未支持参数，不能静默覆盖。请保留原组合并新建组合。",409);if(recipe.status!=="active"||Number(recipe.revision)!==input.expectedRevision)throw new NewDesignError("组合已更新或归档，请核对服务器结果后保存。",409);}
    else recipe=(await client.query("INSERT INTO new_design.prompt_recipes(id,recipe_key,name,description) VALUES($1,$2,$3,$4) RETURNING *",[randomUUID(),`composition_${randomUUID().replaceAll("-","")}`,input.name,input.description])).rows[0];
    await loadExactReferences(client,input);
    const versionId=randomUUID(),number=Number((await client.query("SELECT COALESCE(max(version),0)+1 AS version FROM new_design.prompt_recipe_versions WHERE recipe_id=$1",[recipe.id])).rows[0].version),schema={...variableSchema(input),[marker]:{format:1,taskType:input.taskType,variables:input.variables,context:input.context,name:input.name,description:input.description}};
    await client.query("INSERT INTO new_design.prompt_recipe_versions(id,recipe_id,version,base_version_id,source,status,variables_schema,content_hash,created_by) VALUES($1,$2,$3,$4,'manual','draft',$5::jsonb,$6,'prompt_composition')",[versionId,recipe.id,number,recipe.current_version_id,JSON.stringify(schema),hash]);
    const slotId=randomUUID();await client.query("INSERT INTO new_design.prompt_recipe_slots(id,recipe_version_id,slot_key,sort_order,required,allowed_content_types,variable_contract) VALUES($1,$2,'author_additions',0,false,ARRAY['prompt_component'],$3::jsonb)",[slotId,versionId,JSON.stringify({required:input.variables.map(item=>item.key)})]);
    await client.query("INSERT INTO new_design.prompt_recipe_slots(id,recipe_version_id,slot_key,sort_order,required,allowed_content_types,variable_contract) VALUES($1,$2,'explicit_context',1,false,ARRAY['card_version'],'{}'::jsonb)",[randomUUID(),versionId]);
    for(const [index,binding]of input.components.entries())await client.query("INSERT INTO new_design.prompt_recipe_slot_components(id,recipe_version_id,slot_id,component_card_id,component_version_id,sort_order,required,enabled) VALUES($1,$2,$3,$4,$5,$6,false,$7)",[randomUUID(),versionId,slotId,binding.cardId,binding.versionId,index,binding.enabled]);
    if(recipe.published_version_id)await client.query("UPDATE new_design.prompt_recipe_versions SET status='superseded' WHERE id=$1",[recipe.published_version_id]);
    await client.query("UPDATE new_design.prompt_recipe_versions SET status='published' WHERE id=$1",[versionId]);
    const previous=recipe.published_version_id,revision=Number(recipe.revision)+(recipe.current_version_id?2:1);
    recipe=(await client.query("UPDATE new_design.prompt_recipes SET name=$2,description=$3,current_version_id=$4,published_version_id=$4,revision=$5,updated_at=now() WHERE id=$1 RETURNING *",[recipe.id,input.name,input.description,versionId,revision])).rows[0];
    await client.query("INSERT INTO new_design.ai_contract_publications(id,entity_kind,entity_id,from_version_id,to_version_id,entity_revision,action,actor,idempotency_key) VALUES($1,'prompt_recipe',$2,$3,$4,$5,'publish','prompt_composition',$6)",[randomUUID(),recipe.id,previous,versionId,revision,input.idempotencyKey]);
    const version=(await client.query("SELECT * FROM new_design.prompt_recipe_versions WHERE id=$1",[versionId])).rows[0];return {recipe:await recipeVersion(client,recipe,version),savedVersionId:versionId,savedVersion:number,active:true,repeated:false};
  },true);
}
