import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {VISUAL_MAX_BYTES} from '../../../common/visualAssets';
import {comicVisualAdoptionSchema,comicVisualUploadSchema,type ComicVisualAdoptionInput,type ComicVisualAdoptionReceipt,type ComicVisualAsset,type ComicVisualAssetVersion,type ComicVisualUploadInput,type ComicVisualUploadReceipt,type ComicVisualWorkspace} from '../../../common/comicVisualAssets';
import {NewDesignError} from '../../domain/errors';
import {requireCardWorkflowTypes,workflowCard} from '../cardWorkflow';
import {getNewDesignPool} from '../runtime';

type Db=Pick<PoolClient,'query'>|Pick<Pool,'query'>;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const sha256=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
const date=(value:unknown)=>new Date(String(value)).toISOString();

async function capable(write=false){
 const db=await getNewDesignPool();await requireCardWorkflowTypes(db,['comic_project','comic_bible'],write);
 const row=(await db.query("SELECT to_regclass('new_design.asset_content_objects') IS NOT NULL contents,to_regclass('new_design.asset_versions') IS NOT NULL versions,to_regclass('new_design.asset_events') IS NOT NULL events")).rows[0];
 if(!row.contents||!row.versions||!row.events)throw new NewDesignError('共享资产账本尚未完整启用。',503);
}

function validateImage(input:ComicVisualUploadInput):{bytes:Buffer;checksum:string}{
 const bytes=Buffer.from(input.base64,'base64');
 if(!bytes.length||bytes.length>VISUAL_MAX_BYTES)throw new NewDesignError('图片大小必须在 1 字节到 10 MiB 之间。',422);
 const png=bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
 const jpeg=bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 const gif=['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'));
 const webp=bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP';
 const matches=input.mimeType==='image/png'?png:input.mimeType==='image/jpeg'?jpeg:input.mimeType==='image/gif'?gif:webp;
 if(!matches)throw new NewDesignError('图片内容与声明格式不一致。',422);
 return {bytes,checksum:sha256(bytes)};
}

function visualVersion(row:Record<string,unknown>):ComicVisualAssetVersion{return{id:String(row.id),assetId:String(row.asset_id),version:Number(row.version),sourceBibleVersionId:String(row.source_bible_version_id),name:String(row.name),description:String(row.description),filename:String(row.filename),mimeType:String(row.mime_type),byteSize:Number(row.byte_size),checksum:String(row.checksum),sourceKind:row.source_kind as ComicVisualAssetVersion['sourceKind'],createdAt:date(row.created_at)};}
async function visualAsset(db:Db,projectId:string,id:string):Promise<ComicVisualAsset>{
 const row=(await db.query('SELECT * FROM new_design.comic_visual_assets WHERE project_id=$1 AND id=$2',[projectId,id])).rows[0];
 if(!row)throw new NewDesignError('漫画视觉素材不存在或不属于该项目。',404);
 const versions=(await db.query('SELECT * FROM new_design.comic_visual_asset_versions WHERE asset_id=$1 ORDER BY version DESC,id DESC',[id])).rows.map(visualVersion);
 return{id:String(row.id),projectId:String(row.project_id),bibleEntityId:String(row.bible_entity_id),assetType:row.asset_type as ComicVisualAsset['assetType'],revision:Number(row.revision),adoptedVersionId:row.adopted_version_id?String(row.adopted_version_id):null,status:row.status as ComicVisualAsset['status'],versions};
}

export async function getComicVisualWorkspace(projectId:string,bibleEntityId:string):Promise<ComicVisualWorkspace>{
 await capable();const db=await(await getNewDesignPool()).connect();
 try{await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const bible=await workflowCard(db,bibleEntityId,'comic_bible');if(String(bible.space_id)!==projectId)throw new NewDesignError('设定对象不存在或不属于该漫画项目。',404);const rows=(await db.query("SELECT id FROM new_design.comic_visual_assets WHERE project_id=$1 AND bible_entity_id=$2 AND status='active' ORDER BY created_at,id",[projectId,bibleEntityId])).rows,assets:ComicVisualAsset[]=[];for(const row of rows)assets.push(await visualAsset(db,projectId,String(row.id)));await db.query('COMMIT');return{projectId,bibleEntityId,assets};}catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}finally{db.release();}
}

export async function readComicVisualUploadOriginal(projectId:string,requestKey:string):Promise<ComicVisualUploadReceipt|null>{
 await capable();const db=await getNewDesignPool(),row=(await db.query('SELECT version.id,version.asset_id FROM new_design.comic_visual_asset_versions version JOIN new_design.comic_visual_assets asset ON asset.id=version.asset_id WHERE asset.project_id=$1 AND version.request_key=$2',[projectId,requestKey])).rows[0];if(!row)return null;const asset=await visualAsset(db,projectId,String(row.asset_id));return{asset,version:asset.versions.find(item=>item.id===row.id)!,requestKey,repeated:true};
}

export async function uploadComicVisualCandidate(projectId:string,raw:ComicVisualUploadInput):Promise<ComicVisualUploadReceipt>{
 const input=comicVisualUploadSchema.parse(raw),file=validateImage(input),inputHash=digest({projectId,...input,base64:undefined,checksum:file.checksum,byteSize:file.bytes.length});await capable(true);const pool=await getNewDesignPool(),db=await pool.connect();let committing=false;
 try{
  await db.query('BEGIN');const previous=(await db.query('SELECT id,asset_id,input_hash FROM new_design.comic_visual_asset_versions WHERE request_key=$1',[input.requestKey])).rows[0];
  if(previous){if(previous.input_hash!==inputHash)throw new NewDesignError('原视觉素材请求已用于不同内容。',409);const asset=await visualAsset(db,projectId,String(previous.asset_id));await db.query('COMMIT');return{asset,version:asset.versions.find(item=>item.id===previous.id)!,requestKey:input.requestKey,repeated:true};}
  await workflowCard(db,projectId,'comic_project',true);
  const bible=await workflowCard(db,input.bibleEntityId,'comic_bible');
  if(String(bible.space_id)!==projectId)throw new NewDesignError('设定对象不存在或不属于该漫画项目。',404);if(!bible.values.adopted_version_id)throw new NewDesignError('请先明确采用角色或场景设定，再添加视觉素材。',422);
  let assetId=input.assetId??randomUUID(),asset=input.assetId?(await db.query('SELECT * FROM new_design.comic_visual_assets WHERE project_id=$1 AND id=$2 FOR UPDATE',[projectId,input.assetId])).rows[0]:null;
  if(input.assetId&&!asset)throw new NewDesignError('漫画视觉素材不存在或不属于该项目。',404);
  if(asset&&(asset.bible_entity_id!==input.bibleEntityId||asset.asset_type!==input.assetType))throw new NewDesignError('视觉素材对象或类型与原记录不一致。',409);
  if(asset&&Number(asset.revision)!==input.expectedRevision)throw new NewDesignError('视觉素材采用状态已变化，请先读取最新版本。',409);
  if(!asset){asset=(await db.query('INSERT INTO new_design.comic_visual_assets(id,project_id,bible_entity_id,asset_type) VALUES($1,$2,$3,$4) RETURNING *',[assetId,projectId,input.bibleEntityId,input.assetType])).rows[0];}
  const next=Number((await db.query('SELECT coalesce(max(version),0)+1 value FROM new_design.comic_visual_asset_versions WHERE asset_id=$1',[assetId])).rows[0].value),versionId=randomUUID();
  await db.query('INSERT INTO new_design.comic_visual_asset_versions(id,project_id,asset_id,bible_entity_id,source_bible_version_id,version,name,description,filename,mime_type,byte_size,checksum,image_data,source_kind,request_key,input_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,\'upload\',$14,$15)',[versionId,projectId,assetId,input.bibleEntityId,bible.values.adopted_version_id,next,input.name,input.description,input.filename,input.mimeType,file.bytes.length,file.checksum,file.bytes,input.requestKey,inputHash]);
  const result=await visualAsset(db,projectId,assetId);committing=true;await db.query('COMMIT');return{asset:result,version:result.versions.find(item=>item.id===versionId)!,requestKey:input.requestKey,repeated:false};
 }catch(error){await db.query('ROLLBACK').catch(()=>undefined);if(committing)throw new NewDesignError('视觉素材候选结果未知，请只读核对原请求。',503);if((error as {code?:string}).code==='23505'){const receipt=await readComicVisualUploadOriginal(projectId,input.requestKey);if(receipt){const row=(await pool.query('SELECT input_hash FROM new_design.comic_visual_asset_versions WHERE id=$1',[receipt.version.id])).rows[0];if(row?.input_hash===inputHash)return receipt;}throw new NewDesignError('原视觉素材请求键已被使用。',409);}throw error;}finally{db.release();}
}

export async function readComicVisualAdoptionOriginal(projectId:string,requestKey:string):Promise<ComicVisualAdoptionReceipt|null>{
 await capable();const db=await getNewDesignPool(),row=(await db.query('SELECT asset_id,version_id,revision FROM new_design.comic_visual_asset_adoptions WHERE project_id=$1 AND request_key=$2',[projectId,requestKey])).rows[0];return row?{asset:await visualAsset(db,projectId,String(row.asset_id)),adoptedVersionId:String(row.version_id),adoptionRevision:Number(row.revision),requestKey,repeated:true}:null;
}

export async function adoptComicVisualVersion(projectId:string,assetId:string,raw:ComicVisualAdoptionInput):Promise<ComicVisualAdoptionReceipt>{
 const input=comicVisualAdoptionSchema.parse(raw),inputHash=digest({projectId,assetId,...input});await capable(true);const pool=await getNewDesignPool(),db=await pool.connect();let committing=false;
 try{
  await db.query('BEGIN');const previous=(await db.query('SELECT asset_id,version_id,revision,input_hash FROM new_design.comic_visual_asset_adoptions WHERE request_key=$1',[input.requestKey])).rows[0];
  if(previous){if(previous.input_hash!==inputHash||previous.asset_id!==assetId)throw new NewDesignError('原视觉素材采用请求已用于不同对象。',409);const asset=await visualAsset(db,projectId,assetId);await db.query('COMMIT');return{asset,adoptedVersionId:String(previous.version_id),adoptionRevision:Number(previous.revision),requestKey:input.requestKey,repeated:true};}
  const asset=(await db.query('SELECT * FROM new_design.comic_visual_assets WHERE project_id=$1 AND id=$2 AND status=\'active\' FOR UPDATE',[projectId,assetId])).rows[0];if(!asset)throw new NewDesignError('漫画视觉素材不存在或不属于该项目。',404);if(Number(asset.revision)!==input.expectedRevision)throw new NewDesignError('视觉素材采用状态已变化，请先读取最新版本。',409);
  const version=(await db.query('SELECT * FROM new_design.comic_visual_asset_versions WHERE asset_id=$1 AND id=$2',[assetId,input.versionId])).rows[0];if(!version)throw new NewDesignError('视觉素材候选不存在或属于其他对象。',404);
  const bible=await workflowCard(db,String(asset.bible_entity_id),'comic_bible');if(String(bible.space_id)!==projectId||bible.values.adopted_version_id!==version.source_bible_version_id)throw new NewDesignError('角色或场景设定已变化，请基于当前采用设定重新准备视觉素材。',409);
  const revision=Number(asset.revision)+1;await db.query('UPDATE new_design.comic_visual_assets SET adopted_version_id=$2,revision=$3,updated_at=now() WHERE id=$1',[assetId,input.versionId,revision]);await db.query('INSERT INTO new_design.comic_visual_asset_adoptions(id,project_id,asset_id,version_id,revision,request_key,input_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),projectId,assetId,input.versionId,revision,input.requestKey,inputHash]);const result=await visualAsset(db,projectId,assetId);committing=true;await db.query('COMMIT');return{asset:result,adoptedVersionId:input.versionId,adoptionRevision:revision,requestKey:input.requestKey,repeated:false};
 }catch(error){await db.query('ROLLBACK').catch(()=>undefined);if(committing)throw new NewDesignError('视觉素材采用结果未知，请只读核对原请求。',503);if((error as {code?:string}).code==='23505'){const receipt=await readComicVisualAdoptionOriginal(projectId,input.requestKey);if(receipt){const row=(await pool.query('SELECT input_hash FROM new_design.comic_visual_asset_adoptions WHERE request_key=$1',[input.requestKey])).rows[0];if(row?.input_hash===inputHash)return receipt;}}throw error;}finally{db.release();}
}

export async function readComicVisualContent(projectId:string,assetId:string,versionId:string):Promise<{bytes:Buffer;mimeType:string;checksum:string;filename:string}>{
 await capable();const row=(await(await getNewDesignPool()).query('SELECT version.image_data,version.mime_type,version.checksum,version.filename FROM new_design.comic_visual_asset_versions version JOIN new_design.comic_visual_assets asset ON asset.id=version.asset_id WHERE asset.project_id=$1 AND asset.id=$2 AND version.id=$3',[projectId,assetId,versionId])).rows[0];if(!row)throw new NewDesignError('漫画视觉素材版本不存在。',404);const bytes=Buffer.from(row.image_data);if(bytes.length<1||bytes.length>VISUAL_MAX_BYTES||sha256(bytes)!==row.checksum)throw new NewDesignError('漫画视觉素材内容校验失败，原版本保留但停止读取。',409);return{bytes,mimeType:String(row.mime_type),checksum:String(row.checksum),filename:String(row.filename)};
}
