import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {VISUAL_MAX_BYTES} from '../../../common/visualAssets';
import {comicVisualAdoptionSchema,comicVisualUploadSchema,type ComicVisualAdoptionInput,type ComicVisualAdoptionReceipt,type ComicVisualAsset,type ComicVisualAssetVersion,type ComicVisualUploadInput,type ComicVisualUploadReceipt,type ComicVisualWorkspace} from '../../../common/comicVisualAssets';
import {NewDesignError,assertFound} from '../../domain/errors';
import {recordWorkflowAction,requireCardWorkflowTypes,workflowActionByRequest,workflowCard} from '../cardWorkflow';
import { createRecordCard, listRecordCards, replaceRecordCard, type RecordCardRow } from '../recordCards';
import {getNewDesignPool} from '../runtime';
import {DEFAULT_SPACE_ID} from '../store';
import {decodeVisualUpload,persistVisualBytes,readVisualBytes,validateVisualBytes} from '../visualAssets/files';

type Db=Pick<PoolClient,'query'>|Pick<Pool,'query'>;
const ASSET_TYPE='comic_visual_asset';
const VERSION_TYPE='comic_visual_asset_version';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const sha256=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
const date=(value:unknown)=>new Date(String(value)).toISOString();

async function capable(write=false){
  const db=await getNewDesignPool();
  await requireCardWorkflowTypes(db,['comic_project','comic_bible',ASSET_TYPE,VERSION_TYPE],write);
  const row=(await db.query("SELECT to_regclass('new_design.asset_content_objects') IS NOT NULL contents")).rows[0];
  if(!row.contents)throw new NewDesignError('共享资产内容账本尚未完整启用。',503);
}

function visualVersion(row:Record<string,unknown>):ComicVisualAssetVersion{
  return{id:String(row.id),assetId:String(row.asset_id),version:Number(row.version),sourceBibleVersionId:String(row.source_bible_version_id),name:String(row.name),description:String(row.description),filename:String(row.filename),mimeType:String(row.mime_type),byteSize:Number(row.byte_size),checksum:String(row.checksum),sourceKind:row.source_kind as ComicVisualAssetVersion['sourceKind'],createdAt:date(row.created_at)};
}

async function versionRows(db:Db,assetId?:string){
  const rows=await listRecordCards(db,VERSION_TYPE);
  return rows.filter(row=>!assetId||row.asset_id===assetId).sort((left,right)=>Number(right.version)-Number(left.version)||String(right.id).localeCompare(String(left.id)));
}

async function assetRow(db:Db,projectId:string,id:string,lock=false){
  const rows=await listRecordCards(db,ASSET_TYPE,{lock}),row=rows.find(item=>item.id===id&&item.project_id===projectId);
  if(!row)throw new NewDesignError('漫画视觉素材不存在或不属于该项目。',404);
  return row;
}

async function visualAsset(db:Db,projectId:string,id:string):Promise<ComicVisualAsset>{
  const row=await assetRow(db,projectId,id),versions=(await versionRows(db,id)).map(visualVersion);
  return{id:String(row.id),projectId:String(row.project_id),bibleEntityId:String(row.bible_entity_id),assetType:row.asset_type as ComicVisualAsset['assetType'],revision:Number(row.revision),adoptedVersionId:row.adopted_version_id?String(row.adopted_version_id):null,status:row.status as ComicVisualAsset['status'],versions};
}

export async function getComicVisualWorkspace(projectId:string,bibleEntityId:string):Promise<ComicVisualWorkspace>{
  await capable();
  const pool=await getNewDesignPool(),db=await pool.connect();
  try{
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const bible=await workflowCard(db,bibleEntityId,'comic_bible');
    if(String(bible.space_id)!==projectId)throw new NewDesignError('设定对象不存在或不属于该漫画项目。',404);
    const rows=(await listRecordCards(db,ASSET_TYPE)).filter(row=>row.project_id===projectId&&row.bible_entity_id===bibleEntityId&&row.status==='active'),assets:ComicVisualAsset[]=[];
    for(const row of rows)assets.push(await visualAsset(db,projectId,String(row.id)));
    await db.query('COMMIT');
    return{projectId,bibleEntityId,assets};
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}finally{db.release();}
}

export async function readComicVisualUploadOriginal(projectId:string,requestKey:string):Promise<ComicVisualUploadReceipt|null>{
  await capable();
  const db=await getNewDesignPool(),action=await workflowActionByRequest(db,requestKey);
  let row:RecordCardRow|undefined;
  if(action?.action_key==='comic_visual.candidate')row=(await versionRows(db)).find(item=>item.id===action.payload?.versionId);
  if(!row)row=(await versionRows(db)).find(item=>item.request_key===requestKey&&item.project_id===projectId);
  if(!row)return null;
  const asset=await visualAsset(db,projectId,String(row.asset_id));
  return{asset,version:assertFound(asset.versions.find(item=>item.id===row!.id),'原视觉素材版本不存在。'),requestKey,repeated:true};
}

export async function uploadComicVisualCandidate(projectId:string,raw:ComicVisualUploadInput):Promise<ComicVisualUploadReceipt>{
  const input=comicVisualUploadSchema.parse(raw),file=decodeVisualUpload(input),inputHash=digest({projectId,...input,base64:undefined,checksum:file.checksum,byteSize:file.byteSize});
  await capable(true);
  const pool=await getNewDesignPool(),db=await pool.connect();
  let committing=false;
  try{
    await db.query('BEGIN');
    const previous=await readComicVisualUploadOriginal(projectId,input.requestKey);
    if(previous){
      const stored=(await versionRows(db)).find(item=>item.id===previous.version.id);
      if(stored?.input_hash!==inputHash)throw new NewDesignError('原视觉素材请求已用于不同内容。',409);
      await db.query('COMMIT');
      return previous;
    }
    await workflowCard(db,projectId,'comic_project',true);
    const bible=await workflowCard(db,input.bibleEntityId,'comic_bible');
    if(String(bible.space_id)!==projectId)throw new NewDesignError('设定对象不存在或不属于该漫画项目。',404);
    if(!bible.values.adopted_version_id)throw new NewDesignError('请先明确采用角色或场景设定，再添加视觉素材。',422);
    const assets=await listRecordCards(db,ASSET_TYPE,{lock:true});
    let asset=input.assetId?assets.find(item=>item.id===input.assetId&&item.project_id===projectId):undefined;
    if(input.assetId&&!asset)throw new NewDesignError('漫画视觉素材不存在或不属于该项目。',404);
    if(asset&&(asset.bible_entity_id!==input.bibleEntityId||asset.asset_type!==input.assetType))throw new NewDesignError('视觉素材对象或类型与原记录不一致。',409);
    if(asset&&Number(asset.revision)!==input.expectedRevision)throw new NewDesignError('视觉素材采用状态已变化，请先读取最新版本。',409);
    const assetId=input.assetId??randomUUID();
    if(!asset)asset=await createRecordCard(db,{spaceId:DEFAULT_SPACE_ID,typeKey:ASSET_TYPE,title:input.name,values:{id:assetId,project_id:projectId,bible_entity_id:input.bibleEntityId,asset_type:input.assetType,revision:0,adopted_version_id:null,status:'active'}});
    await persistVisualBytes(file);
    const existing=(await db.query("SELECT * FROM new_design.asset_content_objects WHERE checksum_algorithm='sha256' AND checksum=$1 AND byte_size=$2",[file.checksum,file.byteSize])).rows[0];
    let contentId:string;
    if(existing){
      if(existing.storage_kind!=='managed_file'||existing.storage_provider!=='local'||existing.storage_locator!==`visual-assets/${file.locator}`||existing.mime_type!==input.mimeType)throw new NewDesignError('相同图片内容已登记到其他存储位置。',409);
      contentId=String(existing.id);
    }else{
      contentId=randomUUID();
      await db.query("INSERT INTO new_design.asset_content_objects(id,checksum,byte_size,mime_type,storage_kind,storage_provider,storage_locator,integrity_state,last_verified_at,created_by) VALUES($1,$2,$3,$4,'managed_file','local',$5,'verified',now(),'comic-visual')",[contentId,file.checksum,file.byteSize,input.mimeType,`visual-assets/${file.locator}`]);
    }
    const next=Math.max(0,...(await versionRows(db,assetId)).map(item=>Number(item.version)))+1,versionId=randomUUID();
    await createRecordCard(db,{spaceId:DEFAULT_SPACE_ID,typeKey:VERSION_TYPE,title:input.name,values:{id:versionId,project_id:projectId,asset_id:assetId,bible_entity_id:input.bibleEntityId,source_bible_version_id:bible.values.adopted_version_id,version:next,name:input.name,description:input.description,filename:input.filename,mime_type:input.mimeType,byte_size:file.byteSize,checksum:file.checksum,content_object_id:contentId,source_kind:'upload',request_key:input.requestKey,input_hash:inputHash}});
    await recordWorkflowAction(db,{cardId:asset.recordCardId,actionKey:'comic_visual.candidate',requestKey:input.requestKey,inputHash,payload:{projectId,versionId}});
    const result=await visualAsset(db,projectId,assetId);
    committing=true;
    await db.query('COMMIT');
    return{asset:result,version:assertFound(result.versions.find(item=>item.id===versionId),'视觉素材候选未保存。'),requestKey:input.requestKey,repeated:false};
  }catch(error){
    await db.query('ROLLBACK').catch(()=>undefined);
    if(committing)throw new NewDesignError('视觉素材候选结果未知，请只读核对原请求。',503);
    if((error as {code?:string}).code==='23505'){
      const receipt=await readComicVisualUploadOriginal(projectId,input.requestKey);
      if(receipt)return receipt;
      throw new NewDesignError('原视觉素材请求键已被使用。',409);
    }
    throw error;
  }finally{db.release();}
}

export async function readComicVisualAdoptionOriginal(projectId:string,requestKey:string):Promise<ComicVisualAdoptionReceipt|null>{
  await capable();
  const db=await getNewDesignPool(),action=await workflowActionByRequest(db,requestKey);
  if(!action||action.action_key!=='comic_visual.adopt'||action.payload?.projectId!==projectId)return null;
  const assetId=String(action.payload.assetId),versionId=String(action.payload.versionId),revision=Number(action.payload.revision);
  return{asset:await visualAsset(db,projectId,assetId),adoptedVersionId:versionId,adoptionRevision:revision,requestKey,repeated:true};
}

export async function adoptComicVisualVersion(projectId:string,assetId:string,raw:ComicVisualAdoptionInput):Promise<ComicVisualAdoptionReceipt>{
  const input=comicVisualAdoptionSchema.parse(raw),inputHash=digest({projectId,assetId,...input});
  await capable(true);
  const pool=await getNewDesignPool(),db=await pool.connect();
  let committing=false;
  try{
    await db.query('BEGIN');
    const previous=await workflowActionByRequest(db,input.requestKey);
    if(previous){
      if(previous.action_key!=='comic_visual.adopt'||previous.input_hash!==inputHash||previous.payload?.assetId!==assetId)throw new NewDesignError('原视觉素材采用请求已用于不同对象。',409);
      const result=await readComicVisualAdoptionOriginal(projectId,input.requestKey);
      await db.query('COMMIT');
      return assertFound(result,'原视觉素材采用记录不存在。');
    }
    const asset=await assetRow(db,projectId,assetId,true);
    if(asset.status!=='active')throw new NewDesignError('漫画视觉素材不存在或不属于该项目。',404);
    if(Number(asset.revision)!==input.expectedRevision)throw new NewDesignError('视觉素材采用状态已变化，请先读取最新版本。',409);
    const candidate=(await versionRows(db,assetId)).find(item=>item.id===input.versionId);
    if(!candidate)throw new NewDesignError('视觉素材候选不存在或属于其他对象。',404);
    const bible=await workflowCard(db,String(asset.bible_entity_id),'comic_bible');
    if(String(bible.space_id)!==projectId||bible.values.adopted_version_id!==candidate.source_bible_version_id)throw new NewDesignError('角色或场景设定已变化，请基于当前采用设定重新准备视觉素材。',409);
    const revision=Number(asset.revision)+1;
    await replaceRecordCard(db,{id:asset.recordCardId,spaceId:asset.recordSpaceId,typeKey:ASSET_TYPE,title:String(candidate.name),values:{id:assetId,project_id:projectId,bible_entity_id:asset.bible_entity_id,asset_type:asset.asset_type,revision,adopted_version_id:input.versionId,status:'active'}});
    await recordWorkflowAction(db,{cardId:asset.recordCardId,actionKey:'comic_visual.adopt',requestKey:input.requestKey,inputHash,payload:{projectId,assetId,versionId:input.versionId,revision}});
    const result=await visualAsset(db,projectId,assetId);
    committing=true;
    await db.query('COMMIT');
    return{asset:result,adoptedVersionId:input.versionId,adoptionRevision:revision,requestKey:input.requestKey,repeated:false};
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);if(committing)throw new NewDesignError('视觉素材采用结果未知，请只读核对原请求。',503);throw error;}finally{db.release();}
}

export async function readComicVisualContent(projectId:string,assetId:string,versionId:string):Promise<{bytes:Buffer;mimeType:string;checksum:string;filename:string}>{
  await capable();
  const db=await getNewDesignPool(),row=(await versionRows(db,assetId)).find(item=>item.id===versionId&&item.project_id===projectId);
  if(!row)throw new NewDesignError('漫画视觉素材版本不存在。',404);
  let bytes:Buffer;
  if(row.content_object_id){
    const content=assertFound((await db.query("SELECT * FROM new_design.asset_content_objects WHERE id=$1 AND storage_kind='managed_file' AND storage_provider='local'",[row.content_object_id])).rows[0],'漫画视觉素材内容不存在。'),locator=String(content.storage_locator);
    if(!locator.startsWith('visual-assets/'))throw new NewDesignError('漫画视觉素材不是受管图片。',422);
    bytes=await readVisualBytes(locator.slice(14),String(content.checksum),Number(content.byte_size),content.mime_type);
  }else{
    const encoded=String(row.image_data??'');
    bytes=encoded.startsWith('\\x')?Buffer.from(encoded.slice(2),'hex'):Buffer.from(encoded,'base64');
    validateVisualBytes(bytes,row.mime_type);
  }
  if(bytes.length<1||bytes.length>VISUAL_MAX_BYTES||sha256(bytes)!==row.checksum)throw new NewDesignError('漫画视觉素材内容校验失败，原版本保留但停止读取。',409);
  return{bytes,mimeType:String(row.mime_type),checksum:String(row.checksum),filename:String(row.filename)};
}
