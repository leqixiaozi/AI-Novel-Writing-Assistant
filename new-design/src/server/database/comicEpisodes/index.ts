import {createHash,randomUUID} from 'node:crypto';
import {
  comicEpisodeAdoptionSchema,comicEpisodeProposalSchema,type ComicEpisode,type ComicEpisodeAdoptionInput,
  type ComicEpisodeAdoptionReceipt,type ComicEpisodeProposalInput,type ComicEpisodeProposalReceipt,
  type ComicEpisodeVersion,type ComicEpisodeWorkspace,type ComicEpisodeOutlinePrompt,
} from '../../../common/comicEpisodes';
import type {ComicGenerationReceipt} from '../../../common/comicPanels';
import {NewDesignError,assertFound} from '../../domain/errors';
import {
  adoptWorkflowVersion,appendWorkflowVersion,createWorkflowCard,recordWorkflowAction,requireCardWorkflowTypes,
  workflowActionByRequest,workflowCard,workflowVersions,type WorkflowDb,type WorkflowRow,
} from '../cardWorkflow';
import {getNewDesignPool} from '../runtime';

const PROJECT_TYPE='comic_project',BUNDLE_TYPE='comic_source_bundle',EPISODE_TYPE='comic_episode';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const iso=(value:unknown)=>new Date(String(value)).toISOString();
async function capability(write=false){await requireCardWorkflowTypes(await getNewDesignPool(),[PROJECT_TYPE,BUNDLE_TYPE,EPISODE_TYPE],write);}

function version(row:WorkflowRow):ComicEpisodeVersion{
  const values=row.values as WorkflowRow;
  return{id:String(row.id),episodeId:String(row.card_id),version:Number(values.version),sourceKind:values.source_kind,sourceVersionId:String(values.source_version_id),content:values.content,createdAt:iso(row.created_at)};
}

async function sourceVersion(db:WorkflowDb,projectId:string,lock=false){
  const row=await workflowCard(db,projectId,PROJECT_TYPE,lock),values=row.values as WorkflowRow;
  return String(values.source_version_id);
}

async function readEpisode(db:WorkflowDb,projectId:string,id:string,lock=false):Promise<ComicEpisode>{
  const row=await workflowCard(db,id,EPISODE_TYPE,lock),values=row.values as WorkflowRow;
  if(String(row.space_id)!==projectId)throw new NewDesignError('指定漫画分集不存在。',404);
  return{id:String(row.id),projectId,order:Number(values.episode_order),revision:Number(values.workflow_revision??0),adoptedVersionId:values.adopted_version_id?String(values.adopted_version_id):null,versions:(await workflowVersions(db,id)).map(version)};
}

async function episodeCards(db:WorkflowDb,projectId:string){
  return(await db.query(`SELECT card.id
    FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id
    WHERE card.space_id=$1 AND card.status='active' AND type.type_key=$2
    ORDER BY (card.values->>'episode_order')::integer,card.id`,[projectId,EPISODE_TYPE])).rows;
}

export async function getComicEpisodeWorkspace(projectId:string):Promise<ComicEpisodeWorkspace>{
  await capability();const db=await(await getNewDesignPool()).connect();
  try{await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const sourceVersionId=await sourceVersion(db,projectId),episodes=[] as ComicEpisode[];for(const row of await episodeCards(db,projectId))episodes.push(await readEpisode(db,projectId,String(row.id)));await db.query('COMMIT');return{projectId,sourceVersionId,episodes};}
  catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}finally{db.release();}
}

export async function readComicEpisodeOriginal(projectId:string,requestKey:string):Promise<ComicEpisodeProposalReceipt|null>{
  await capability();const db=await getNewDesignPool(),action=await workflowActionByRequest(db,requestKey);
  if(!action||action.action_key!=='comic_episode.candidate')return null;
  const current=await readEpisode(db,projectId,String(action.card_id)),saved=current.versions.find(item=>item.id===String(action.card_version_id));
  return saved?{episode:current,version:saved,requestKey,repeated:true}:null;
}

export async function readComicEpisodeAdoptionOriginal(projectId:string,requestKey:string):Promise<ComicEpisodeAdoptionReceipt|null>{
  await capability();const db=await getNewDesignPool(),action=await workflowActionByRequest(db,requestKey);
  if(!action||action.action_key!=='comic_episode.adopt')return null;
  const current=await readEpisode(db,projectId,String(action.card_id));
  return{episode:current,adoptedVersionId:String(action.card_version_id),adoptionRevision:Number(action.payload.revision),requestKey,repeated:true};
}

async function adoptedBundle(db:WorkflowDb,projectId:string){
  const card=(await db.query(`SELECT card.id,card.values
    FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id
    WHERE card.space_id=$1 AND card.status='active' AND type.type_key=$2
    ORDER BY card.created_at,card.id LIMIT 1`,[projectId,BUNDLE_TYPE])).rows[0];
  if(!card?.values?.adopted_version_id)throw new NewDesignError('请先采用来源整理版本，再生成分话大纲。',409);
  const candidate=assertFound((await db.query('SELECT values FROM new_design.card_versions WHERE id=$1 AND card_id=$2',[card.values.adopted_version_id,card.id])).rows[0],'采用的来源整理版本不存在。');
  return{id:String(card.values.adopted_version_id),content:candidate.values.content};
}

export async function getComicEpisodeOutlinePrompt(projectId:string,order:number,instruction:string):Promise<ComicEpisodeOutlinePrompt>{
  await capability();const db=await getNewDesignPool(),sourceVersionId=await sourceVersion(db,projectId),bundle=await adoptedBundle(db,projectId);
  return{operation:'episode_outline',projectId,sourceVersionId,sourceBundleVersionId:bundle.id,sourceBundle:bundle.content,order,instruction};
}

export async function readComicEpisodeGenerationOriginal(projectId:string,requestKey:string):Promise<ComicGenerationReceipt|null>{
  const result=await readComicEpisodeOriginal(projectId,requestKey);if(!result||result.version.sourceKind!=='ai_candidate')return null;
  const currentSource=await sourceVersion(await getNewDesignPool(),projectId);return{requestKey,operation:'episode_outline',sourceVersionIds:[result.version.sourceVersionId],candidateVersionId:result.version.id,status:'succeeded',repeated:true,readiness:result.version.sourceVersionId===currentSource?'current':'stale_source',adopted:result.episode.adoptedVersionId===result.version.id};
}

export async function proposeComicEpisode(projectId:string,raw:ComicEpisodeProposalInput,options:{sourceKind?:'manual'|'ai_candidate';expectedSourceVersionId?:string;expectedSourceBundleVersionId?:string}={}):Promise<ComicEpisodeProposalReceipt>{
  const input=comicEpisodeProposalSchema.parse(raw),sourceKind=options.sourceKind??'manual',fingerprint=digest(sourceKind==='manual'?{projectId,...input}:{projectId,...input,sourceKind,expectedSourceVersionId:options.expectedSourceVersionId??null,expectedSourceBundleVersionId:options.expectedSourceBundleVersionId??null});
  await capability(true);const pool=await getNewDesignPool(),db=await pool.connect();let committing=false;
  try{
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`comic_episode:${projectId}:${input.order}`]);
    const previous=await workflowActionByRequest(db,input.requestKey);
    if(previous){if(previous.action_key!=='comic_episode.candidate'||previous.input_hash!==fingerprint)throw new NewDesignError('原分集候选请求已用于不同内容。',409);const current=await readEpisode(db,projectId,String(previous.card_id));await db.query('COMMIT');return{episode:current,version:assertFound(current.versions.find(item=>item.id===String(previous.card_version_id)),'原分集候选不存在。'),requestKey:input.requestKey,repeated:true};}
    const currentSource=await sourceVersion(db,projectId,true);if(options.expectedSourceVersionId&&currentSource!==options.expectedSourceVersionId)throw new NewDesignError('漫画原文来源已变化，大纲候选未保存。',409);
    if(options.expectedSourceBundleVersionId&&(await adoptedBundle(db,projectId)).id!==options.expectedSourceBundleVersionId)throw new NewDesignError('来源整理版本已变化，大纲候选未保存。',409);
    let row=(await db.query(`SELECT card.id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id
      WHERE card.space_id=$1 AND type.type_key=$2 AND card.status='active' AND (card.values->>'episode_order')::integer=$3
      LIMIT 1 FOR UPDATE OF card`,[projectId,EPISODE_TYPE,input.order])).rows[0],episodeId:string,versionId:string;
    if(!row){
      if(input.expectedRevision!==0)throw new NewDesignError('新分集尚不存在，请按当前序号重新核对。',409);
      const values={record_kind:EPISODE_TYPE,project_id:projectId,episode_order:input.order,workflow_revision:0,adopted_version_id:null,script_revision:0,adopted_panel_set_id:null,version:1,source_kind:sourceKind,source_version_id:currentSource,source_bundle_version_id:options.expectedSourceBundleVersionId??null,content:input.content};
      const created=await createWorkflowCard(db,{spaceId:projectId,typeKey:EPISODE_TYPE,title:input.content.title,values});episodeId=created.cardId;versionId=created.versionId;
    }else{
      episodeId=String(row.id);const current=await workflowCard(db,episodeId,EPISODE_TYPE,true),values=current.values as WorkflowRow;
      if(Number(values.workflow_revision??0)!==input.expectedRevision)throw new NewDesignError('分集已采用其他版本，请读取最新版本后再修改。',409);
      const next=Number((await db.query(`SELECT coalesce(max((values->>'version')::integer),0)+1 value FROM new_design.card_versions WHERE card_id=$1`,[episodeId])).rows[0].value),candidate=await appendWorkflowVersion(db,{cardId:episodeId,typeKey:EPISODE_TYPE,title:input.content.title,values:{...values,version:next,source_kind:sourceKind,source_version_id:currentSource,source_bundle_version_id:options.expectedSourceBundleVersionId??null,content:input.content}});versionId=String(candidate.id);
    }
    await recordWorkflowAction(db,{cardId:episodeId,cardVersionId:versionId,actionKey:'comic_episode.candidate',requestKey:input.requestKey,inputHash:fingerprint,payload:{sourceKind}});
    const current=await readEpisode(db,projectId,episodeId);committing=true;await db.query('COMMIT');return{episode:current,version:assertFound(current.versions.find(item=>item.id===versionId),'分集候选未保存。'),requestKey:input.requestKey,repeated:false};
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);if(committing)throw new NewDesignError('分集候选结果未知，请只读核对原请求。',503);throw error;}finally{db.release();}
}

export async function adoptComicEpisode(projectId:string,episodeId:string,raw:ComicEpisodeAdoptionInput):Promise<ComicEpisodeAdoptionReceipt>{
  const input=comicEpisodeAdoptionSchema.parse(raw),fingerprint=digest({projectId,episodeId,...input});await capability(true);const pool=await getNewDesignPool(),db=await pool.connect();let committing=false;
  try{
    await db.query('BEGIN');const previous=await workflowActionByRequest(db,input.requestKey);
    if(previous){if(previous.action_key!=='comic_episode.adopt'||previous.input_hash!==fingerprint||String(previous.card_id)!==episodeId)throw new NewDesignError('原采用请求已用于其他分集。',409);const current=await readEpisode(db,projectId,episodeId);await db.query('COMMIT');return{episode:current,adoptedVersionId:String(previous.card_version_id),adoptionRevision:Number(previous.payload.revision),requestKey:input.requestKey,repeated:true};}
    const currentSource=await sourceVersion(db,projectId,true),target=assertFound((await db.query('SELECT values FROM new_design.card_versions WHERE id=$1 AND card_id=$2',[input.versionId,episodeId])).rows[0],'候选版本不存在或属于其他分集。');
    if(String(target.values.source_version_id)!==currentSource)throw new NewDesignError('候选基于旧来源，请重新核对后再采用。',409);
    const adopted=await adoptWorkflowVersion(db,{cardId:episodeId,typeKey:EPISODE_TYPE,versionId:input.versionId,expectedRevision:input.expectedRevision,actionKey:'comic_episode.adopt',requestKey:input.requestKey,inputHash:fingerprint,payload:{projectId}});
    const current=await readEpisode(db,projectId,episodeId);committing=true;await db.query('COMMIT');return{episode:current,adoptedVersionId:input.versionId,adoptionRevision:adopted.revision,requestKey:input.requestKey,repeated:false};
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);if(committing)throw new NewDesignError('分集采用结果未知，请只读核对原请求。',503);throw error;}finally{db.release();}
}
