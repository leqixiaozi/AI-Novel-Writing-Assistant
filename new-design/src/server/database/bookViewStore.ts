import {listRecordCards,requireRecordCard,createRecordCard,replaceRecordCard} from "./recordCards";
import {recordWorkflowAction} from "./cardWorkflow";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  BookViewKey,
  BookViewWorkspace,
  CharacterRelation,
  NarrativePlacement,
  StoryTimePosition,
  TextAnchor,
} from "../../common/contracts";
import { NewDesignError, assertFound } from "../domain/errors";
import { getNewDesignPool } from "./runtime";
import { saveLegacyStoryTimeFromView } from "./storyTimeline";

const VIEW_KEYS: BookViewKey[] = ["chapters", "characters", "relations", "events", "clues", "props", "states", "rules", "comparison", "quality", "world", "resources"];
export type StoryTimeInput={cardId:string;startOrder:number|null;endOrder:number|null;startLabel:string;endLabel:string;uncertainty:string;revision?:number};
export type NarrativePlacementInput={subjectCardId:string;chapterCardId:string;sceneCardId?:string|null;role:NarrativePlacement["role"];note:string;revision?:number};
export type CharacterRelationInput={sourceCardId:string;targetCardId:string;sourceLabel:string;inverseLabel:string;note:string;revision?:number};
export type ClueLifecycleInput={clueCardId:string;plantChapterId:string;revealChapterId:string;plantAnchor:string;revealAnchor:string;plantPlacementRevision?:number;revealPlacementRevision?:number;plantAnchorRevision?:number;revealAnchorRevision?:number};

function asDate(value: unknown): string { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }
function asNumber(value: unknown): number | null { return value === null || value === undefined ? null : Number(value); }

function mapTime(row: Record<string, unknown>): StoryTimePosition {
  return { id:String(row.id),cardId:String(row.card_id),startOrder:asNumber(row.start_order),endOrder:asNumber(row.end_order),startLabel:String(row.start_label??""),endLabel:String(row.end_label??""),uncertainty:String(row.uncertainty??""),revision:Number(row.revision),updatedAt:asDate(row.updated_at) };
}
function mapPlacement(row: Record<string, unknown>): NarrativePlacement {
  return { id:String(row.id),subjectCardId:String(row.subject_card_id),chapterCardId:String(row.chapter_card_id),sceneCardId:row.scene_card_id?String(row.scene_card_id):null,role:row.role as NarrativePlacement["role"],note:String(row.note??""),revision:Number(row.revision),updatedAt:asDate(row.updated_at) };
}
function mapAnchor(row: Record<string, unknown>): TextAnchor {
  return { id:String(row.id),subjectCardId:String(row.subject_card_id),chapterCardId:String(row.chapter_card_id),sceneCardId:row.scene_card_id?String(row.scene_card_id):null,role:row.role as TextAnchor["role"],anchorLabel:String(row.anchor_label??""),revision:Number(row.revision),updatedAt:asDate(row.updated_at) };
}
function mapCharacterRelation(row: Record<string, unknown>): CharacterRelation {
  const properties=(row.properties??{}) as Record<string,unknown>;
  return { id:String(row.id),sourceCardId:String(row.source_card_id),targetCardId:String(row.target_card_id),sourceLabel:String(properties.source_label??""),inverseLabel:String(properties.inverse_label??""),note:String(properties.note??""),revision:Number(row.revision),updatedAt:asDate(row.updated_at) };
}

async function findBook(client: PoolClient, bookId: string) {
  return assertFound((await client.query("SELECT * FROM new_design.books WHERE id=$1 AND status='active'",[bookId])).rows[0],"书籍不存在或已归档。");
}

async function requireCards(client:PoolClient,spaceId:string,requirements:Array<{id:string;types?:string[];name:string}>) {
  const ids=[...new Set(requirements.map((item)=>item.id))];
  const result=await client.query(`SELECT card.id,card.status,type.type_key FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.space_id=$1 AND NOT type.is_internal AND card.id=ANY($2::uuid[])`,[spaceId,ids]);
  const byId=new Map(result.rows.map((row)=>[String(row.id),row]));
  for(const requirement of requirements){
    const row=byId.get(requirement.id);
    if(!row)throw new NewDesignError(`${requirement.name}不属于当前书籍。`,422);
    if(row.status!=="active")throw new NewDesignError(`${requirement.name}已归档，不能建立或修改关联。`,422);
    if(requirement.types&&!requirement.types.includes(String(row.type_key)))throw new NewDesignError(`${requirement.name}类型不符合当前操作。`,422);
  }
}

export async function getBookViewWorkspace(bookId:string):Promise<BookViewWorkspace>{
  const pool=await getNewDesignPool();const client=await pool.connect();
  try{
    const book=await findBook(client,bookId);const spaceId=String(book.space_id);
    const cards=await client.query(`SELECT card.*,type.type_key,type.name AS card_type_name,version.version AS type_version,version.fields AS type_fields FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.card_type_versions version ON version.id=card.type_version_id WHERE card.space_id=$1 AND card.status='active' AND NOT type.is_internal ORDER BY type.sort_order,card.title`,[spaceId]);
    const times={rows:(await listRecordCards(client,"story_time_position",{spaceId})).sort((a,b)=>(a.start_order==null?Infinity:Number(a.start_order))-(b.start_order==null?Infinity:Number(b.start_order))||asDate(b.updated_at).localeCompare(asDate(a.updated_at)))};
    const placements={rows:(await listRecordCards(client,"narrative_placement",{spaceId,where:{status:"active"}})).sort((a,b)=>asDate(b.updated_at).localeCompare(asDate(a.updated_at)))};
    const anchors=await client.query("SELECT * FROM new_design.text_anchors WHERE space_id=$1 ORDER BY updated_at DESC",[spaceId]);
    const relations=await client.query(`SELECT relation.* FROM new_design.card_relations relation JOIN new_design.relation_types type ON type.id=relation.relation_type_id WHERE relation.space_id=$1 AND relation.status='active' AND type.relation_key='character_relationship' ORDER BY relation.updated_at DESC`,[spaceId]);
    const configs={rows:(await listRecordCards(client,"book_view_config",{where:{book_id:bookId}})).sort((a,b)=>String(a.view_key).localeCompare(String(b.view_key)))};
    return {bookId,spaceId,cards:cards.rows.map((row)=>({id:String(row.id),cardTypeId:String(row.card_type_id),cardTypeName:String(row.card_type_name),typeKey:String(row.type_key),typeFields:row.type_fields,status:row.status,revision:Number(row.revision),typeVersionId:String(row.type_version_id),typeVersion:Number(row.type_version),title:String(row.title),values:row.values,createdAt:asDate(row.created_at),updatedAt:asDate(row.updated_at),archivedAt:null})),storyTimePositions:times.rows.map(mapTime),narrativePlacements:placements.rows.map(mapPlacement),textAnchors:anchors.rows.map(mapAnchor),characterRelations:relations.rows.map(mapCharacterRelation),viewConfigs:configs.rows.map((row)=>({id:String(row.id),key:row.view_key as BookViewKey,config:row.config,revision:Number(row.revision)}))};
  }finally{client.release();}
}

export async function applyStoryTimePosition(client:PoolClient,bookId:string,input:StoryTimeInput):Promise<StoryTimePosition>{
  if(input.startOrder!==null&&input.endOrder!==null&&input.endOrder<input.startOrder)throw new NewDesignError("故事结束时间不能早于开始时间。请调整时间顺序后再保存。",422,{endOrder:"结束顺序不能小于开始顺序。"});
  const book=await findBook(client,bookId);await requireCards(client,String(book.space_id),[{id:input.cardId,types:["event"],name:"事件"}]);
  const current=(await listRecordCards(client,"story_time_position",{spaceId:String(book.space_id),where:{card_id:input.cardId},lock:true}))[0];
  if(current&&Number(current.revision)!==input.revision)throw new NewDesignError("故事时间已在其他视图更新，请刷新后重试。",409);
  await saveLegacyStoryTimeFromView(client,bookId,{eventCardId:input.cardId,startOrder:input.startOrder,endOrder:input.endOrder,startLabel:input.startLabel,endLabel:input.endLabel,uncertainty:input.uncertainty});
  return mapTime(assertFound((await listRecordCards(client,"story_time_position",{spaceId:String(book.space_id),where:{card_id:input.cardId}}))[0],"故事时间保存失败。"));
}

export async function saveStoryTimePosition(bookId:string,input:StoryTimeInput):Promise<StoryTimePosition>{
  const pool=await getNewDesignPool();const client=await pool.connect();
  try{await client.query("BEGIN");const result=await applyStoryTimePosition(client,bookId,input);await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function applyNarrativePlacement(client:PoolClient,bookId:string,input:NarrativePlacementInput):Promise<NarrativePlacement>{
  const book=await findBook(client,bookId);const requirements:Array<{id:string;types?:string[];name:string}>=[{id:input.subjectCardId,name:"叙事对象"},{id:input.chapterCardId,types:["chapter"],name:"章节"}];if(input.sceneCardId)requirements.push({id:input.sceneCardId,types:["scene"],name:"场景"});await requireCards(client,String(book.space_id),requirements);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`narrative-placement:${book.space_id}:${input.subjectCardId}:${input.role}`]);
  const current=(await listRecordCards(client,"narrative_placement",{spaceId:String(book.space_id),where:{subject_card_id:input.subjectCardId,role:input.role,status:"active"},lock:true}))[0];
  if(current&&current.revision!==input.revision)throw new NewDesignError("叙事位置已在其他视图更新，请刷新后重试。",409);
  const values={...(current??{}),space_id:book.space_id,subject_card_id:input.subjectCardId,chapter_card_id:input.chapterCardId,scene_card_id:input.sceneCardId??null,role:input.role,note:input.note,status:"active",revision:current?current.revision+1:1,updated_at:new Date().toISOString()};
  const result=current?await replaceRecordCard(client,{id:current.recordCardId,spaceId:current.recordSpaceId,typeKey:"narrative_placement",values}):await createRecordCard(client,{spaceId:String(book.space_id),typeKey:"narrative_placement",title:"叙事位置",values});
  return mapPlacement(result);
}

export async function saveNarrativePlacement(bookId:string,input:NarrativePlacementInput):Promise<NarrativePlacement>{
  const pool=await getNewDesignPool();const client=await pool.connect();
  try{await client.query("BEGIN");const result=await applyNarrativePlacement(client,bookId,input);await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function applyCharacterRelation(client:PoolClient,bookId:string,input:CharacterRelationInput):Promise<CharacterRelation>{
  if(input.sourceCardId===input.targetCardId)throw new NewDesignError("人物不能与自己建立关系。",422);
  const book=await findBook(client,bookId);await requireCards(client,String(book.space_id),[{id:input.sourceCardId,types:["character"],name:"起点人物"},{id:input.targetCardId,types:["character"],name:"关联人物"}]);
  const relationType=assertFound((await client.query("SELECT * FROM new_design.relation_types WHERE owner_space_id=$1 AND relation_key='character_relationship' AND status='published'",[book.space_id])).rows[0],"本书缺少人物关系规格，请同步最新模板。");
  const canonical=input.sourceCardId<input.targetCardId;const sourceCardId=canonical?input.sourceCardId:input.targetCardId;const targetCardId=canonical?input.targetCardId:input.sourceCardId;const sourceLabel=canonical?input.sourceLabel:input.inverseLabel;const inverseLabel=canonical?input.inverseLabel:input.sourceLabel;
  const current=(await client.query(`SELECT * FROM new_design.card_relations WHERE space_id=$1 AND relation_type_id=$2 AND LEAST(source_card_id,target_card_id)=LEAST($3::uuid,$4::uuid) AND GREATEST(source_card_id,target_card_id)=GREATEST($3::uuid,$4::uuid) AND status='active' FOR UPDATE`,[book.space_id,relationType.id,sourceCardId,targetCardId])).rows[0];let relation;
  const properties={source_label:sourceLabel,inverse_label:inverseLabel,note:input.note};
  if(current){if(Number(current.revision)!==input.revision)throw new NewDesignError("人物关系已在其他视图更新，请刷新后重试。",409);relation=(await client.query("UPDATE new_design.card_relations SET properties=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",[current.id,JSON.stringify(properties)])).rows[0];}
  else{relation=(await client.query(`INSERT INTO new_design.card_relations(id,space_id,relation_type_id,source_card_id,target_card_id,properties,current_version_id,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,NULL,'user') RETURNING *`,[randomUUID(),book.space_id,relationType.id,sourceCardId,targetCardId,JSON.stringify(properties)])).rows[0];}
  const sourceVersions=assertFound((await client.query("SELECT source.current_version_id source_version_id,target.current_version_id target_version_id FROM new_design.cards source JOIN new_design.cards target ON target.id=$2 WHERE source.id=$1",[sourceCardId,targetCardId])).rows[0],"人物关系来源版本不可用。");
  const versionId=randomUUID();await client.query(`INSERT INTO new_design.card_relation_versions(id,card_relation_id,revision,source_card_version_id,target_card_version_id,status,properties,created_by) VALUES($1,$2,$3,$4,$5,'active',$6::jsonb,'user')`,[versionId,relation.id,relation.revision,sourceVersions.source_version_id,sourceVersions.target_version_id,JSON.stringify(properties)]);await client.query("UPDATE new_design.card_relations SET current_version_id=$2 WHERE id=$1",[relation.id,versionId]);
  return mapCharacterRelation({...relation,current_version_id:versionId});
}

export async function saveCharacterRelation(bookId:string,input:CharacterRelationInput):Promise<CharacterRelation>{
  const pool=await getNewDesignPool();const client=await pool.connect();
  try{await client.query("BEGIN");const result=await applyCharacterRelation(client,bookId,input);await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");if((error as {code?:string}).code==="23505")throw new NewDesignError("这两个人物已经存在一条有效关系，请刷新后编辑原关系。",409);throw error;}finally{client.release();}
}

async function upsertLifecyclePlacement(client:PoolClient,spaceId:string,input:{subjectCardId:string;chapterCardId:string;role:"plant"|"reveal";anchorLabel:string;placementRevision?:number;anchorRevision?:number}){
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`narrative-placement:${spaceId}:${input.subjectCardId}:${input.role}`]);
  const placement=(await listRecordCards(client,"narrative_placement",{spaceId,where:{subject_card_id:input.subjectCardId,role:input.role,status:"active"},lock:true}))[0];
  if(placement&&Number(placement.revision)!==input.placementRevision)throw new NewDesignError(`${input.role==="plant"?"埋设":"揭示"}位置已被更新，请刷新后重试。`,409);
  const values={...(placement??{}),space_id:spaceId,subject_card_id:input.subjectCardId,chapter_card_id:input.chapterCardId,scene_card_id:null,role:input.role,note:placement?.note??"",status:"active",revision:placement?placement.revision+1:1,updated_at:new Date().toISOString()};
  if(placement)await replaceRecordCard(client,{id:placement.recordCardId,spaceId,typeKey:"narrative_placement",values});
  else await createRecordCard(client,{spaceId,typeKey:"narrative_placement",title:"线索位置",values});
  const anchor=(await client.query("SELECT * FROM new_design.text_anchors WHERE space_id=$1 AND subject_card_id=$2 AND role=$3 FOR UPDATE",[spaceId,input.subjectCardId,input.role])).rows[0];
  if(anchor&&Number(anchor.revision)!==input.anchorRevision)throw new NewDesignError(`${input.role==="plant"?"埋设":"揭示"}正文锚点已被更新，请刷新后重试。`,409);
  if(anchor)await client.query("UPDATE new_design.text_anchors SET chapter_card_id=$2,scene_card_id=NULL,anchor_label=$3,revision=revision+1,updated_at=now() WHERE id=$1",[anchor.id,input.chapterCardId,input.anchorLabel]);
  else await client.query("INSERT INTO new_design.text_anchors(id,space_id,subject_card_id,chapter_card_id,role,anchor_label) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),spaceId,input.subjectCardId,input.chapterCardId,input.role,input.anchorLabel]);
}

export async function applyClueLifecycle(client:PoolClient,bookId:string,input:ClueLifecycleInput):Promise<void>{
  const book=await findBook(client,bookId);await requireCards(client,String(book.space_id),[{id:input.clueCardId,types:["clue_evidence","foreshadow"],name:"线索或伏笔"},{id:input.plantChapterId,types:["chapter"],name:"埋设章节"},{id:input.revealChapterId,types:["chapter"],name:"揭示章节"}]);
  await upsertLifecyclePlacement(client,String(book.space_id),{subjectCardId:input.clueCardId,chapterCardId:input.plantChapterId,role:"plant",anchorLabel:input.plantAnchor,placementRevision:input.plantPlacementRevision,anchorRevision:input.plantAnchorRevision});
  await upsertLifecyclePlacement(client,String(book.space_id),{subjectCardId:input.clueCardId,chapterCardId:input.revealChapterId,role:"reveal",anchorLabel:input.revealAnchor,placementRevision:input.revealPlacementRevision,anchorRevision:input.revealAnchorRevision});
}

export async function saveClueLifecycle(bookId:string,input:ClueLifecycleInput):Promise<BookViewWorkspace>{
  const pool=await getNewDesignPool();const client=await pool.connect();
  try{await client.query("BEGIN");await applyClueLifecycle(client,bookId,input);await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return getBookViewWorkspace(bookId);
}

export async function saveBookViewConfig(bookId:string,key:BookViewKey,input:{config:Record<string,unknown>;revision:number}):Promise<{id:string;key:BookViewKey;config:Record<string,unknown>;revision:number}>{
  if(!VIEW_KEYS.includes(key))throw new NewDesignError("未知的书籍视图。",422);
  const client=await(await getNewDesignPool()).connect();
  try{
    await client.query("BEGIN");const book=await findBook(client,bookId);
    const current=(await listRecordCards(client,"book_view_config",{where:{book_id:bookId,view_key:key},lock:true}))[0];
    if(!current||current.revision!==input.revision)throw new NewDesignError("视图设置已在其他页面更新，请刷新后重试。",409);
    const result=await replaceRecordCard(client,{id:current.recordCardId,spaceId:current.recordSpaceId,typeKey:"book_view_config",values:{...current,config:input.config,revision:current.revision+1,updated_at:new Date().toISOString()}});
    if(result.smart_view_id){
      const view=await requireRecordCard(client,String(result.smart_view_id),"smart_view","关联智能视图不存在。",{lock:true}),previous=await requireRecordCard(client,String(view.current_version_id),"smart_view_version","智能视图版本不存在。");
      if(view.book_id!==bookId||view.space_id!==book.space_id)throw new NewDesignError("关联视图不属于本书。",409);
      const versionId=randomUUID(),revision=Number(view.revision)+1,sortField=input.config.sort==="title"?"title":input.config.sort==="start_order"?"story_time":"updated_at",direction=input.config.sort==="updated_desc"?"desc":"asc";
      await createRecordCard(client,{id:versionId,spaceId:view.recordSpaceId,typeKey:"smart_view_version",title:String(previous.name),values:{id:versionId,smart_view_id:view.id,version:revision,name:previous.name,description:previous.description,filter_ast:previous.filter_ast,sort_config:[{field:sortField,direction}],grouping:{field:input.config.groupBy??"content_type"},display_columns:previous.display_columns,layout:{mode:input.config.display??"list",legacyConfig:input.config},created_by:"legacy_view_config"}});
      await replaceRecordCard(client,{id:view.recordCardId,spaceId:view.recordSpaceId,typeKey:"smart_view",values:{...view,revision,current_version_id:versionId,updated_by:"legacy_view_config",updated_at:new Date().toISOString()}});
      await client.query("SELECT new_design.register_dependency_resource('smart_view_version',$1,$2)",[view.id,versionId]);
      await recordWorkflowAction(client,{cardId:view.recordCardId,actionKey:"material.smart_view.revise",payload:{space_id:view.space_id,book_id:bookId,subject_kind:"smart_view",subject_id:view.id,action:"revise",expected_revision:view.revision,result_version_id:versionId,detail:{legacyCompatible:true},idempotency_key:`legacy-view:${result.id}:${result.revision}`,created_by:"legacy_view_config"}});
    }
    await client.query("COMMIT");return{id:result.id,key,config:result.config,revision:result.revision};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
