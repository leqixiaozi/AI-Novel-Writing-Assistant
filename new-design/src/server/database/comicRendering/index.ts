import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {comicRenderAdoptionSchema,type ComicRenderAdoptionInput,type ComicRenderAdoptionReceipt,type ComicRenderBatch,type ComicRenderTarget,type ComicRenderVersion,type ComicRenderWorkspace} from '../../../common/comicRendering';
import type {ImageGenerationReply} from '../../../common/imageGeneration';
import {NewDesignError,assertFound} from '../../domain/errors';
import {appendWorkflowVersion,recordWorkflowAction,requireCardWorkflowTypes,workflowActionByRequest,workflowCard} from '../cardWorkflow';
import {createRecordCard,listRecordCards} from '../recordCards';
import {getNewDesignPool} from '../runtime';
import {DEFAULT_SPACE_ID} from '../store';
import {decodeVisualUpload,persistVisualBytes,readVisualBytes} from '../visualAssets/files';

type Db=Pick<PoolClient,'query'>|Pick<Pool,'query'>;
type Row=Record<string,any>;
const TARGET_TYPE='comic_render_target';
const VISUAL_ASSET_TYPE='comic_visual_asset';
const stable=(value:unknown):string=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'?`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`:JSON.stringify(value);
export const comicStableHash=(value:unknown)=>createHash('sha256').update(stable(value),'utf8').digest('hex');
const date=(value:unknown)=>new Date(String(value)).toISOString();

async function capable(write=false){
  const db=await getNewDesignPool();
  await requireCardWorkflowTypes(db,['comic_project','comic_episode','comic_panel_script','comic_bible',TARGET_TYPE,VISUAL_ASSET_TYPE],write);
  const row=(await db.query("SELECT to_regclass('new_design.media_jobs') IS NOT NULL jobs,to_regclass('new_design.media_outputs') IS NOT NULL outputs,to_regclass('new_design.asset_content_objects') IS NOT NULL contents")).rows[0];
  if(!row.jobs||!row.outputs||!row.contents)throw new NewDesignError('共享媒体账本尚未完整启用。',503);
}

function version(row:Row):ComicRenderVersion{
  const metadata=row.metadata as Row;
  return{
    id:String(row.id),projectId:String(metadata.projectId),episodeId:metadata.episodeId?String(metadata.episodeId):null,
    panelId:metadata.targetKind==='panel'?String(metadata.targetId):null,
    bibleEntityId:metadata.targetKind==='bible'?String(metadata.targetId):null,
    assetType:metadata.assetType?String(metadata.assetType):null,version:Number(metadata.version),
    factSnapshotId:String(metadata.factSnapshotId),contentObjectId:String(metadata.contentObjectId),
    mimeType:String(row.mime_type),checksum:String(row.checksum),byteSize:Number(row.byte_size),
    sourceKind:'ai_candidate',createdAt:date(row.created_at),
    imageUrl:`/api/new-design/comic/projects/${metadata.projectId}/render-versions/${row.id}/content`,
  };
}

async function renderOutputs(db:Db,whereSql='',params:unknown[]=[]):Promise<Row[]>{
  return(await db.query(`SELECT output.*,content.mime_type,content.checksum,content.byte_size,content.storage_locator
    FROM new_design.media_outputs output
    JOIN new_design.media_jobs job ON job.id=output.job_id AND job.media_kind='comic_render'
    JOIN new_design.asset_content_objects content ON content.id=(output.metadata->>'contentObjectId')::uuid
    WHERE output.output_kind='comic_render' ${whereSql}
    ORDER BY output.created_at,output.id`,params)).rows;
}

async function target(db:Db,projectId:string,targetKind:'panel'|'bible',targetId:string,assetType=''):Promise<ComicRenderTarget>{
  const states=await listRecordCards(db,TARGET_TYPE),state=states.find(item=>item.project_id===projectId&&item.target_kind===targetKind&&item.target_id===targetId&&String(item.asset_type??'')===assetType);
  const rows=(await renderOutputs(db,"AND output.metadata->>'projectId'=$1 AND output.metadata->>'targetKind'=$2 AND output.metadata->>'targetId'=$3 AND coalesce(output.metadata->>'assetType','')=$4",[projectId,targetKind,targetId,assetType])).sort((left,right)=>Number(right.metadata.version)-Number(left.metadata.version));
  return{targetKind,targetId,revision:Number(state?.revision??0),adoptedVersionId:state?.adopted_version_id?String(state.adopted_version_id):null,versions:rows.map(version)};
}

async function batch(db:Db,id:string):Promise<ComicRenderBatch>{
  const row=assertFound((await db.query("SELECT * FROM new_design.media_jobs WHERE id=$1 AND media_kind='comic_render'",[id])).rows[0],'成图批次不存在。'),input=row.input as Row;
  const versions=(await renderOutputs(db,'AND output.job_id=$1',[id])).map(version);
  return{id:String(row.id),projectId:String(input.projectId),episodeId:input.episodeId?String(input.episodeId):null,panelSetId:input.panelSetId?String(input.panelSetId):null,requestKey:String(row.request_key),status:row.status,totalCount:Number(input.totalCount??0),completedCount:Number(input.completedCount??0),stopPosition:input.stopPosition===null||input.stopPosition===undefined?null:Number(input.stopPosition),lastError:String(input.lastError??''),versions,createdAt:date(row.created_at)};
}

export async function getComicRenderWorkspace(projectId:string,episodeId?:string,bibleEntityId?:string,assetType=''):Promise<ComicRenderWorkspace>{
  await capable();
  const db=await getNewDesignPool();
  await workflowCard(db,projectId,'comic_project');
  let panelSetId:string|null=null,targets:ComicRenderTarget[]=[];
  if(episodeId){
    const episode=await workflowCard(db,episodeId,'comic_episode');
    if(String(episode.space_id)!==projectId)throw new NewDesignError('漫画分话不存在。',404);
    const script=(await db.query("SELECT card.values FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='comic_panel_script' WHERE card.space_id=$1 AND card.values->>'episode_id'=$2 AND card.status='active'",[projectId,episodeId])).rows[0];
    panelSetId=script?.values?.adopted_version_id?String(script.values.adopted_version_id):null;
    if(panelSetId){
      const selected=assertFound((await db.query('SELECT values FROM new_design.card_versions WHERE id=$1',[panelSetId])).rows[0],'采用的分格脚本不存在。');
      for(const panel of selected.values.panels??[])targets.push(await target(db,projectId,'panel',String(panel.id)));
    }
  }else if(bibleEntityId)targets=[await target(db,projectId,'bible',bibleEntityId,assetType)];
  const rows=(await db.query("SELECT id FROM new_design.media_jobs WHERE media_kind='comic_render' AND input->>'projectId'=$1 AND ($2::uuid IS NULL OR input->>'episodeId'=$2::text) ORDER BY created_at DESC,id DESC LIMIT 30",[projectId,episodeId??null])).rows,batches=[];
  for(const row of rows)batches.push(await batch(db,String(row.id)));
  return{projectId,episodeId:episodeId??null,panelSetId,targets,batches};
}

export async function readComicRenderBatchOriginal(projectId:string,requestKey:string){
  await capable();
  const db=await getNewDesignPool(),row=(await db.query("SELECT id FROM new_design.media_jobs WHERE media_kind='comic_render' AND input->>'projectId'=$1 AND request_key=$2",[projectId,requestKey])).rows[0];
  return row?batch(db,String(row.id)):null;
}

export async function panelFacts(db:Db,projectId:string,panelId:string){
  const row=assertFound((await db.query(`SELECT version.id set_id,version.values,episode.values episode_values
    FROM new_design.card_versions version
    JOIN new_design.cards script ON script.id=version.card_id AND script.space_id=$1 AND script.values->>'adopted_version_id'=version.id::text
    JOIN new_design.card_types script_type ON script_type.id=script.card_type_id AND script_type.type_key='comic_panel_script'
    JOIN new_design.cards episode ON episode.id=(version.values->>'episode_id')::uuid
    WHERE version.values @> jsonb_build_object('panels',jsonb_build_array(jsonb_build_object('id',$2::text)))`,[projectId,panelId])).rows[0],'漫画分格不存在。');
  const values=row.values as Row,panel=assertFound((values.panels as Row[]).find(item=>String(item.id)===panelId),'漫画分格不存在。');
  if(String(row.episode_values.adopted_version_id)!==String(values.episode_version_id))throw new NewDesignError('该分格已不是当前采用脚本，不能成图或采用旧图。',409);
  const bibles=(await db.query(`SELECT card.id,card.values->>'kind' kind,card.values->>'adopted_version_id' adopted_version_id,version.values->'content' content
    FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key='comic_bible'
    JOIN new_design.card_versions version ON version.id=(card.values->>'adopted_version_id')::uuid
    WHERE card.space_id=$1 AND card.status='active' ORDER BY card.values->>'kind',card.id`,[projectId])).rows.map((item:Row)=>({id:String(item.id),kind:item.kind,versionId:String(item.adopted_version_id),content:item.content}));
  const visualAssets=await listRecordCards(db,VISUAL_ASSET_TYPE),visuals=visualAssets.filter(item=>item.project_id===projectId&&item.status==='active'&&item.adopted_version_id).map(item=>({bibleEntityId:String(item.bible_entity_id),assetType:item.asset_type,versionId:String(item.adopted_version_id)}));
  const renderStates=await listRecordCards(db,TARGET_TYPE),generatedVisuals=renderStates.filter(item=>item.project_id===projectId&&item.target_kind==='bible'&&item.adopted_version_id).map(item=>({bibleEntityId:String(item.target_id),assetType:item.asset_type,versionId:String(item.adopted_version_id)}));
  return{panelSetId:String(row.set_id),episodeId:String(values.episode_id),episodeVersionId:String(values.episode_version_id),panel:{id:String(panel.id),order:Number(panel.order),panelType:String(panel.panelType),action:String(panel.action),dialogues:panel.dialogues,characterRefs:panel.characterRefs,sceneRef:panel.sceneRef,visualPrompt:String(panel.visualPrompt),focus:panel.focus},bibles,visuals:[...visuals,...generatedVisuals]};
}

export async function bibleFacts(db:Db,projectId:string,entityId:string,versionId:string,assetType:string){
  const card=await workflowCard(db,entityId,'comic_bible');
  if(String(card.space_id)!==projectId||String(card.values.adopted_version_id)!==versionId)throw new NewDesignError('角色或场景设定已变化，请按当前采用版本重新生成。',409);
  const row=assertFound((await db.query('SELECT values FROM new_design.card_versions WHERE id=$1 AND card_id=$2',[versionId,entityId])).rows[0],'漫画设定不存在或尚未采用。');
  return{entityId,kind:card.values.kind,bibleVersionId:versionId,assetType,content:row.values.content};
}

async function registerBatch(input:{projectId:string;episodeId?:string;panelSetId?:string;requestKey:string;connectionVersionId:string;size:string;inputHash:string;totalCount:number}){
  await capable(true);
  const db=await getNewDesignPool(),existing=(await db.query('SELECT * FROM new_design.media_jobs WHERE request_key=$1',[input.requestKey])).rows[0];
  if(existing){if(existing.media_kind!=='comic_render'||existing.input_hash!==input.inputHash)throw new NewDesignError('原成图批次请求已用于不同输入。',409);return batch(db,String(existing.id));}
  const id=randomUUID(),subjectCardId=input.episodeId??input.projectId,jobInput={projectId:input.projectId,episodeId:input.episodeId??null,panelSetId:input.panelSetId??null,connectionVersionId:input.connectionVersionId,imageSize:input.size,totalCount:input.totalCount,completedCount:0,stopPosition:null,lastError:''};
  await db.query("INSERT INTO new_design.media_jobs(id,media_kind,subject_card_id,request_key,input_hash,status,input) VALUES($1,'comic_render',$2,$3,$4,'running',$5::jsonb)",[id,subjectCardId,input.requestKey,input.inputHash,JSON.stringify(jobInput)]);
  return batch(db,id);
}

export async function registerComicRenderBatch(input:{projectId:string;episodeId:string;panelSetId:string;requestKey:string;connectionVersionId:string;size:string;inputHash:string;totalCount:number}){
  return registerBatch(input);
}

export async function registerComicBibleBatch(input:{projectId:string;requestKey:string;connectionVersionId:string;size:string;inputHash:string}){
  return registerBatch({...input,totalCount:1});
}

export async function saveComicRenderVersion(input:{batchId:string;projectId:string;targetKind:'panel'|'bible';targetId:string;episodeId:string|null;assetType:string|null;facts:Record<string,unknown>;prompt:string;reply:ImageGenerationReply}){
  const db=await getNewDesignPool(),job=assertFound((await db.query("SELECT * FROM new_design.media_jobs WHERE id=$1 AND media_kind='comic_render' AND input->>'projectId'=$2",[input.batchId,input.projectId])).rows[0],'成图批次不存在。');
  const sourceHash=comicStableHash(input.facts),file=decodeVisualUpload({base64:input.reply.base64,mimeType:input.reply.mimeType});
  await persistVisualBytes(file);
  const existingContent=(await db.query("SELECT id FROM new_design.asset_content_objects WHERE checksum_algorithm='sha256' AND checksum=$1 AND byte_size=$2",[file.checksum,file.byteSize])).rows[0],contentId=existingContent?String(existingContent.id):randomUUID();
  if(!existingContent)await db.query("INSERT INTO new_design.asset_content_objects(id,checksum,byte_size,mime_type,storage_kind,storage_provider,storage_locator,integrity_state,last_verified_at,created_by) VALUES($1,$2,$3,$4,'managed_file','local',$5,'verified',now(),'comic-rendering')",[contentId,file.checksum,file.byteSize,file.mimeType,`visual-assets/${file.locator}`]);
  const prior=await renderOutputs(db,"AND output.metadata->>'projectId'=$1 AND output.metadata->>'targetKind'=$2 AND output.metadata->>'targetId'=$3 AND coalesce(output.metadata->>'assetType','')=$4",[input.projectId,input.targetKind,input.targetId,input.assetType??'']),next=Math.max(0,...prior.map(item=>Number(item.metadata.version)))+1,id=randomUUID(),factSnapshotId=randomUUID();
  const metadata={projectId:input.projectId,episodeId:input.episodeId,targetKind:input.targetKind,targetId:input.targetId,assetType:input.assetType,version:next,factSnapshotId,contentObjectId:contentId,sourceSnapshot:input.facts,sourceHash,prompt:input.prompt};
  const row=(await db.query("INSERT INTO new_design.media_outputs(id,job_id,output_kind,metadata) VALUES($1,$2,'comic_render',$3::jsonb) RETURNING *",[id,input.batchId,JSON.stringify(metadata)])).rows[0];
  const states=await listRecordCards(db,TARGET_TYPE),state=states.find(item=>item.project_id===input.projectId&&item.target_kind===input.targetKind&&item.target_id===input.targetId&&String(item.asset_type??'')===String(input.assetType??''));
  if(!state)await createRecordCard(db,{spaceId:DEFAULT_SPACE_ID,typeKey:TARGET_TYPE,title:`漫画成图目标 · ${input.targetKind}:${input.targetId}`,values:{project_id:input.projectId,target_kind:input.targetKind,target_id:input.targetId,asset_type:input.assetType??'',adopted_version_id:null,revision:0}});
  await db.query("UPDATE new_design.media_jobs SET input=jsonb_set(input,'{completedCount}',to_jsonb(coalesce((input->>'completedCount')::integer,0)+1)),updated_at=now() WHERE id=$1",[input.batchId]);
  return version({...row,...file,metadata,mime_type:file.mimeType,checksum:file.checksum,byte_size:file.byteSize,storage_locator:`visual-assets/${file.locator}`});
}

export async function finishComicRenderBatch(id:string,error?:unknown,stopPosition?:number){
  const db=await getNewDesignPool(),lastError=error instanceof Error?error.message:String(error??'');
  await db.query("UPDATE new_design.media_jobs SET status=$2,input=input||jsonb_build_object('stopPosition',$3::integer,'lastError',$4::text),updated_at=now() WHERE id=$1 AND media_kind='comic_render'",[id,error?'failed':'succeeded',error?stopPosition??null:null,lastError]);
  return batch(db,id);
}

async function factsCurrent(db:Db,row:Row){
  const metadata=row.metadata as Row,snapshot=metadata.sourceSnapshot as Record<string,any>;
  if(metadata.targetKind==='panel')return comicStableHash(await panelFacts(db,String(metadata.projectId),String(metadata.targetId)))===String(metadata.sourceHash);
  return comicStableHash(await bibleFacts(db,String(metadata.projectId),String(metadata.targetId),String(snapshot.bibleVersionId),String(snapshot.assetType)))===String(metadata.sourceHash);
}

export async function adoptComicRenderVersion(projectId:string,targetKind:'panel'|'bible',targetId:string,assetType:string,raw:ComicRenderAdoptionInput):Promise<ComicRenderAdoptionReceipt>{
  const input=comicRenderAdoptionSchema.parse(raw),inputHash=comicStableHash({projectId,targetKind,targetId,assetType,...input});
  await capable(true);
  const pool=await getNewDesignPool(),db=await pool.connect();
  try{
    await db.query('BEGIN');
    const prior=await workflowActionByRequest(db,input.requestKey);
    if(prior){
      if(prior.action_key!=='comic_render.adopt'||prior.input_hash!==inputHash)throw new NewDesignError('原成图采用请求已用于其他版本。',409);
      const priorRevision=Number(prior.payload?.revision??0);
      await db.query('COMMIT');
      return{target:await target(pool,projectId,targetKind,targetId,assetType),adoptedVersionId:String(prior.payload.versionId),revision:priorRevision,requestKey:input.requestKey,repeated:true};
    }
    const states=await listRecordCards(db,TARGET_TYPE,{lock:true}),state=states.find(item=>item.project_id===projectId&&item.target_kind===targetKind&&item.target_id===targetId&&String(item.asset_type??'')===assetType);
    if(Number(state?.revision??0)!==input.expectedRevision)throw new NewDesignError('成图采用状态已变化，请先读取最新版本。',409);
    const candidate=assertFound((await renderOutputs(db,'AND output.id=$1',[input.versionId]))[0],'成图候选不存在。'),metadata=candidate.metadata as Row;
    if(metadata.projectId!==projectId||metadata.targetKind!==targetKind||String(metadata.targetId)!==targetId||String(metadata.assetType??'')!==assetType)throw new NewDesignError('成图候选不属于当前对象。',409);
    if(!await factsCurrent(db,candidate))throw new NewDesignError('成图依据的脚本或设定来源已变化，请重新生成候选。',409);
    const revision=Number(state?.revision??0)+1;
    let stateCardId:string;
    if(state){
      stateCardId=state.recordCardId;
      await appendWorkflowVersion(db,{cardId:state.recordCardId,typeKey:TARGET_TYPE,title:`漫画成图目标 · ${targetKind}:${targetId}`,values:{project_id:projectId,target_kind:targetKind,target_id:targetId,asset_type:assetType,adopted_version_id:input.versionId,revision}});
    }else{
      const created=await createRecordCard(db,{spaceId:DEFAULT_SPACE_ID,typeKey:TARGET_TYPE,title:`漫画成图目标 · ${targetKind}:${targetId}`,values:{project_id:projectId,target_kind:targetKind,target_id:targetId,asset_type:assetType,adopted_version_id:input.versionId,revision}});
      stateCardId=created.recordCardId;
    }
    await recordWorkflowAction(db,{cardId:stateCardId,actionKey:'comic_render.adopt',requestKey:input.requestKey,inputHash,payload:{projectId,targetKind,targetId,assetType,versionId:input.versionId,revision}});
    await db.query('COMMIT');
    return{target:await target(pool,projectId,targetKind,targetId,assetType),adoptedVersionId:input.versionId,revision,requestKey:input.requestKey,repeated:false};
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}finally{db.release();}
}

export async function readComicRenderContent(projectId:string,versionId:string){
  await capable();
  const db=await getNewDesignPool(),row=assertFound((await renderOutputs(db,"AND output.id=$1 AND output.metadata->>'projectId'=$2",[versionId,projectId]))[0],'漫画成图版本不存在。'),locator=String(row.storage_locator);
  if(!locator.startsWith('visual-assets/'))throw new NewDesignError('漫画图片不是受管文件。',422);
  return{bytes:await readVisualBytes(locator.slice(14),String(row.checksum),Number(row.byte_size),row.mime_type),mimeType:String(row.mime_type),checksum:String(row.checksum)};
}
