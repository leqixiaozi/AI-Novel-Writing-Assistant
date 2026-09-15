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

const VIEW_KEYS: BookViewKey[] = ["chapters", "clues", "characters", "events", "world", "resources"];

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
  const result=await client.query(`SELECT card.id,card.status,type.type_key FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.space_id=$1 AND card.id=ANY($2::uuid[])`,[spaceId,ids]);
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
    const cards=await client.query(`SELECT card.*,type.type_key,type.name AS card_type_name,version.version AS type_version,version.fields AS type_fields FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.card_type_versions version ON version.id=card.type_version_id WHERE card.space_id=$1 AND card.status='active' ORDER BY type.sort_order,card.title`,[spaceId]);
    const times=await client.query("SELECT * FROM new_design.story_time_positions WHERE space_id=$1 ORDER BY start_order NULLS LAST,updated_at DESC",[spaceId]);
    const placements=await client.query("SELECT * FROM new_design.narrative_placements WHERE space_id=$1 AND status='active' ORDER BY updated_at DESC",[spaceId]);
    const anchors=await client.query("SELECT * FROM new_design.text_anchors WHERE space_id=$1 ORDER BY updated_at DESC",[spaceId]);
    const relations=await client.query(`SELECT relation.* FROM new_design.card_relations relation JOIN new_design.relation_types type ON type.id=relation.relation_type_id WHERE relation.space_id=$1 AND relation.status='active' AND type.relation_key='character_relationship' ORDER BY relation.updated_at DESC`,[spaceId]);
    const configs=await client.query("SELECT * FROM new_design.book_view_configs WHERE book_id=$1 ORDER BY view_key",[bookId]);
    return {bookId,spaceId,cards:cards.rows.map((row)=>({id:String(row.id),cardTypeId:String(row.card_type_id),cardTypeName:String(row.card_type_name),typeKey:String(row.type_key),typeFields:row.type_fields,status:row.status,revision:Number(row.revision),typeVersionId:String(row.type_version_id),typeVersion:Number(row.type_version),title:String(row.title),values:row.values,createdAt:asDate(row.created_at),updatedAt:asDate(row.updated_at),archivedAt:null})),storyTimePositions:times.rows.map(mapTime),narrativePlacements:placements.rows.map(mapPlacement),textAnchors:anchors.rows.map(mapAnchor),characterRelations:relations.rows.map(mapCharacterRelation),viewConfigs:configs.rows.map((row)=>({id:String(row.id),key:row.view_key as BookViewKey,config:row.config,revision:Number(row.revision)}))};
  }finally{client.release();}
}

export async function saveStoryTimePosition(bookId:string,input:{cardId:string;startOrder:number|null;endOrder:number|null;startLabel:string;endLabel:string;uncertainty:string;revision?:number}):Promise<StoryTimePosition>{
  if(input.startOrder!==null&&input.endOrder!==null&&input.endOrder<input.startOrder)throw new NewDesignError("故事结束时间不能早于开始时间。请调整时间顺序后再保存。",422,{endOrder:"结束顺序不能小于开始顺序。"});
  const pool=await getNewDesignPool();const client=await pool.connect();
  try{await client.query("BEGIN");const book=await findBook(client,bookId);await requireCards(client,String(book.space_id),[{id:input.cardId,types:["event"],name:"事件"}]);
    const current=(await client.query("SELECT * FROM new_design.story_time_positions WHERE space_id=$1 AND card_id=$2 FOR UPDATE",[book.space_id,input.cardId])).rows[0];let result;
    if(current){if(Number(current.revision)!==input.revision)throw new NewDesignError("故事时间已在其他视图更新，请刷新后重试。",409);result=await client.query(`UPDATE new_design.story_time_positions SET start_order=$3,end_order=$4,start_label=$5,end_label=$6,uncertainty=$7,revision=revision+1,updated_at=now() WHERE space_id=$1 AND card_id=$2 RETURNING *`,[book.space_id,input.cardId,input.startOrder,input.endOrder,input.startLabel,input.endLabel,input.uncertainty]);}
    else{result=await client.query(`INSERT INTO new_design.story_time_positions(id,space_id,card_id,start_order,end_order,start_label,end_label,uncertainty) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[randomUUID(),book.space_id,input.cardId,input.startOrder,input.endOrder,input.startLabel,input.endLabel,input.uncertainty]);}
    await client.query("COMMIT");return mapTime(result.rows[0]);
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function saveNarrativePlacement(bookId:string,input:{subjectCardId:string;chapterCardId:string;sceneCardId?:string|null;role:NarrativePlacement["role"];note:string;revision?:number}):Promise<NarrativePlacement>{
  const pool=await getNewDesignPool();const client=await pool.connect();
  try{await client.query("BEGIN");const book=await findBook(client,bookId);const requirements=[{id:input.subjectCardId,name:"叙事对象"},{id:input.chapterCardId,types:["chapter"],name:"章节"}];if(input.sceneCardId)requirements.push({id:input.sceneCardId,types:["scene"],name:"场景"});await requireCards(client,String(book.space_id),requirements);
    const current=(await client.query("SELECT * FROM new_design.narrative_placements WHERE space_id=$1 AND subject_card_id=$2 AND role=$3 AND status='active' FOR UPDATE",[book.space_id,input.subjectCardId,input.role])).rows[0];let result;
    if(current){if(Number(current.revision)!==input.revision)throw new NewDesignError("叙事位置已在其他视图更新，请刷新后重试。",409);result=await client.query(`UPDATE new_design.narrative_placements SET chapter_card_id=$4,scene_card_id=$5,note=$6,revision=revision+1,updated_at=now() WHERE space_id=$1 AND subject_card_id=$2 AND role=$3 RETURNING *`,[book.space_id,input.subjectCardId,input.role,input.chapterCardId,input.sceneCardId??null,input.note]);}
    else{result=await client.query(`INSERT INTO new_design.narrative_placements(id,space_id,subject_card_id,chapter_card_id,scene_card_id,role,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[randomUUID(),book.space_id,input.subjectCardId,input.chapterCardId,input.sceneCardId??null,input.role,input.note]);}
    await client.query("COMMIT");return mapPlacement(result.rows[0]);
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function saveCharacterRelation(bookId:string,input:{sourceCardId:string;targetCardId:string;sourceLabel:string;inverseLabel:string;note:string;revision?:number}):Promise<CharacterRelation>{
  if(input.sourceCardId===input.targetCardId)throw new NewDesignError("人物不能与自己建立关系。",422);
  const pool=await getNewDesignPool();const client=await pool.connect();
  try{await client.query("BEGIN");const book=await findBook(client,bookId);await requireCards(client,String(book.space_id),[{id:input.sourceCardId,types:["character"],name:"起点人物"},{id:input.targetCardId,types:["character"],name:"关联人物"}]);
    const relationType=assertFound((await client.query("SELECT * FROM new_design.relation_types WHERE owner_space_id=$1 AND relation_key='character_relationship' AND status='published'",[book.space_id])).rows[0],"本书缺少人物关系规格，请同步最新模板。");
    const canonical=input.sourceCardId<input.targetCardId;const sourceCardId=canonical?input.sourceCardId:input.targetCardId;const targetCardId=canonical?input.targetCardId:input.sourceCardId;const sourceLabel=canonical?input.sourceLabel:input.inverseLabel;const inverseLabel=canonical?input.inverseLabel:input.sourceLabel;
    const current=(await client.query(`SELECT * FROM new_design.card_relations WHERE space_id=$1 AND relation_type_id=$2 AND LEAST(source_card_id,target_card_id)=LEAST($3::uuid,$4::uuid) AND GREATEST(source_card_id,target_card_id)=GREATEST($3::uuid,$4::uuid) AND status='active' FOR UPDATE`,[book.space_id,relationType.id,sourceCardId,targetCardId])).rows[0];let result;
    if(current){if(Number(current.revision)!==input.revision)throw new NewDesignError("人物关系已在其他视图更新，请刷新后重试。",409);result=await client.query("UPDATE new_design.card_relations SET properties=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",[current.id,JSON.stringify({source_label:sourceLabel,inverse_label:inverseLabel,note:input.note})]);}
    else{result=await client.query(`INSERT INTO new_design.card_relations(id,space_id,relation_type_id,source_card_id,target_card_id,properties) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,[randomUUID(),book.space_id,relationType.id,sourceCardId,targetCardId,JSON.stringify({source_label:sourceLabel,inverse_label:inverseLabel,note:input.note})]);}
    await client.query("COMMIT");return mapCharacterRelation(result.rows[0]);
  }catch(error){await client.query("ROLLBACK");if((error as {code?:string}).code==="23505")throw new NewDesignError("这两个人物已经存在一条有效关系，请刷新后编辑原关系。",409);throw error;}finally{client.release();}
}

async function upsertLifecyclePlacement(client:PoolClient,spaceId:string,input:{subjectCardId:string;chapterCardId:string;role:"plant"|"reveal";anchorLabel:string;placementRevision?:number;anchorRevision?:number}){
  const placement=(await client.query("SELECT * FROM new_design.narrative_placements WHERE space_id=$1 AND subject_card_id=$2 AND role=$3 AND status='active' FOR UPDATE",[spaceId,input.subjectCardId,input.role])).rows[0];
  if(placement&&Number(placement.revision)!==input.placementRevision)throw new NewDesignError(`${input.role==="plant"?"埋设":"揭示"}位置已被更新，请刷新后重试。`,409);
  if(placement)await client.query("UPDATE new_design.narrative_placements SET chapter_card_id=$2,scene_card_id=NULL,revision=revision+1,updated_at=now() WHERE id=$1",[placement.id,input.chapterCardId]);
  else await client.query("INSERT INTO new_design.narrative_placements(id,space_id,subject_card_id,chapter_card_id,role) VALUES($1,$2,$3,$4,$5)",[randomUUID(),spaceId,input.subjectCardId,input.chapterCardId,input.role]);
  const anchor=(await client.query("SELECT * FROM new_design.text_anchors WHERE space_id=$1 AND subject_card_id=$2 AND role=$3 FOR UPDATE",[spaceId,input.subjectCardId,input.role])).rows[0];
  if(anchor&&Number(anchor.revision)!==input.anchorRevision)throw new NewDesignError(`${input.role==="plant"?"埋设":"揭示"}正文锚点已被更新，请刷新后重试。`,409);
  if(anchor)await client.query("UPDATE new_design.text_anchors SET chapter_card_id=$2,scene_card_id=NULL,anchor_label=$3,revision=revision+1,updated_at=now() WHERE id=$1",[anchor.id,input.chapterCardId,input.anchorLabel]);
  else await client.query("INSERT INTO new_design.text_anchors(id,space_id,subject_card_id,chapter_card_id,role,anchor_label) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),spaceId,input.subjectCardId,input.chapterCardId,input.role,input.anchorLabel]);
}

export async function saveClueLifecycle(bookId:string,input:{clueCardId:string;plantChapterId:string;revealChapterId:string;plantAnchor:string;revealAnchor:string;plantPlacementRevision?:number;revealPlacementRevision?:number;plantAnchorRevision?:number;revealAnchorRevision?:number}):Promise<BookViewWorkspace>{
  const pool=await getNewDesignPool();const client=await pool.connect();
  try{await client.query("BEGIN");const book=await findBook(client,bookId);await requireCards(client,String(book.space_id),[{id:input.clueCardId,types:["clue_evidence","foreshadow"],name:"线索或伏笔"},{id:input.plantChapterId,types:["chapter"],name:"埋设章节"},{id:input.revealChapterId,types:["chapter"],name:"揭示章节"}]);
    await upsertLifecyclePlacement(client,String(book.space_id),{subjectCardId:input.clueCardId,chapterCardId:input.plantChapterId,role:"plant",anchorLabel:input.plantAnchor,placementRevision:input.plantPlacementRevision,anchorRevision:input.plantAnchorRevision});
    await upsertLifecyclePlacement(client,String(book.space_id),{subjectCardId:input.clueCardId,chapterCardId:input.revealChapterId,role:"reveal",anchorLabel:input.revealAnchor,placementRevision:input.revealPlacementRevision,anchorRevision:input.revealAnchorRevision});
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return getBookViewWorkspace(bookId);
}

export async function saveBookViewConfig(bookId:string,key:BookViewKey,input:{config:Record<string,unknown>;revision:number}):Promise<{id:string;key:BookViewKey;config:Record<string,unknown>;revision:number}>{
  if(!VIEW_KEYS.includes(key))throw new NewDesignError("未知的书籍视图。",422);
  const pool=await getNewDesignPool();const result=await pool.query("UPDATE new_design.book_view_configs SET config=$3::jsonb,revision=revision+1,updated_at=now() WHERE book_id=$1 AND view_key=$2 AND revision=$4 RETURNING *",[bookId,key,JSON.stringify(input.config),input.revision]);
  if(!result.rows[0])throw new NewDesignError("视图设置已在其他页面更新，请刷新后重试。",409);
  return {id:String(result.rows[0].id),key,config:result.rows[0].config,revision:Number(result.rows[0].revision)};
}
