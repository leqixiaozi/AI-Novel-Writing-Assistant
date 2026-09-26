import {createHash,randomUUID} from 'node:crypto';
import {
  comicPanelAdoptionSchema,comicPanelProposalSchema,type ComicGenerationReceipt,type ComicPanel,
  type ComicPanelAdoptionInput,type ComicPanelAdoptionReceipt,type ComicPanelProposalInput,
  type ComicPanelProposalReceipt,type ComicPanelScriptPrompt,type ComicPanelSet,type ComicPanelWorkspace,
} from '../../../common/comicPanels';
import {NewDesignError,assertFound} from '../../domain/errors';
import {
  adoptWorkflowVersion,appendWorkflowVersion,createWorkflowCard,recordWorkflowAction,requireCardWorkflowTypes,
  workflowActionByRequest,workflowCard,workflowVersions,type WorkflowDb,type WorkflowRow,
} from '../cardWorkflow';
import {getNewDesignPool} from '../runtime';

const EPISODE_TYPE='comic_episode',BUNDLE_TYPE='comic_source_bundle',PANEL_TYPE='comic_panel_script';
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const iso=(value:unknown)=>new Date(String(value)).toISOString();
async function capable(write=false){await requireCardWorkflowTypes(await getNewDesignPool(),[EPISODE_TYPE,BUNDLE_TYPE,PANEL_TYPE],write);}

function setFromVersion(row:WorkflowRow):ComicPanelSet{
  const value=row.values as WorkflowRow;
  return{id:String(row.id),episodeId:String(value.episode_id),version:Number(value.version),episodeVersionId:String(value.episode_version_id),densityMode:value.density_mode,sourceKind:value.source_kind,panels:(value.panels??[]) as ComicPanel[],createdAt:iso(row.created_at)};
}

async function episode(db:WorkflowDb,projectId:string,episodeId:string,lock=false){
  const row=await workflowCard(db,episodeId,EPISODE_TYPE,lock);if(String(row.space_id)!==projectId)throw new NewDesignError('漫画分集不存在或不属于该项目。',404);
  const values=row.values as WorkflowRow,adoptedVersionId=values.adopted_version_id?String(values.adopted_version_id):null;
  if(!adoptedVersionId)throw new NewDesignError('请先采用分集大纲，再制作分格脚本。',409);
  const adopted=assertFound((await db.query('SELECT values FROM new_design.card_versions WHERE id=$1 AND card_id=$2',[adoptedVersionId,episodeId])).rows[0],'采用的漫画分集版本不存在。');
  return{row,values,adoptedVersionId,episodeTitle:String(adopted.values.content.title),episodeContent:adopted.values.content};
}

async function panelCard(db:WorkflowDb,projectId:string,episodeId:string,lock=false):Promise<WorkflowRow|null>{
  return(await db.query(`SELECT card.*,version.values current_values
    FROM new_design.cards card
    JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key=$3
    JOIN new_design.card_versions version ON version.id=card.current_version_id
    WHERE card.space_id=$1 AND card.status='active' AND card.values->>'episode_id'=$2
    ORDER BY card.created_at,card.id LIMIT 1${lock?' FOR UPDATE OF card':''}`,[projectId,episodeId,PANEL_TYPE])).rows[0]??null;
}

async function readSet(db:WorkflowDb,id:string):Promise<ComicPanelSet>{
  const row=assertFound((await db.query(`SELECT version.* FROM new_design.card_versions version
    JOIN new_design.cards card ON card.id=version.card_id
    JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key=$2
    WHERE version.id=$1`,[id,PANEL_TYPE])).rows[0],'分格脚本版本不存在。');return setFromVersion(row);
}

export async function getComicPanelWorkspace(projectId:string,episodeId:string):Promise<ComicPanelWorkspace>{
  await capable();const db=await(await getNewDesignPool()).connect();
  try{
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const currentEpisode=await episode(db,projectId,episodeId),card=await panelCard(db,projectId,episodeId),sets=card?(await workflowVersions(db,String(card.id))).map(setFromVersion):[],values=(card?.values??{}) as WorkflowRow;await db.query('COMMIT');const adoptedSetId=values.adopted_version_id?String(values.adopted_version_id):null,adopted=sets.find(item=>item.id===adoptedSetId);
    return{projectId,episodeId,episodeOrder:Number(currentEpisode.values.episode_order),episodeTitle:currentEpisode.episodeTitle,episodeVersionId:currentEpisode.adoptedVersionId,adoptedSetId,adoptedReady:Boolean(adopted&&adopted.episodeVersionId===currentEpisode.adoptedVersionId),scriptRevision:Number(values.workflow_revision??0),sets};
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}finally{db.release();}
}

export async function readComicPanelProposalOriginal(projectId:string,requestKey:string):Promise<ComicPanelProposalReceipt|null>{
  await capable();const db=await getNewDesignPool(),action=await workflowActionByRequest(db,requestKey);if(!action||action.action_key!=='comic_panel_script.candidate')return null;
  const set=await readSet(db,String(action.card_version_id));return String((set as ComicPanelSet).episodeId)?{set,requestKey,repeated:true}:null;
}

export async function readComicPanelAdoptionOriginal(projectId:string,requestKey:string):Promise<ComicPanelAdoptionReceipt|null>{
  await capable();const db=await getNewDesignPool(),action=await workflowActionByRequest(db,requestKey);if(!action||action.action_key!=='comic_panel_script.adopt')return null;
  const set=await readSet(db,String(action.card_version_id));return{workspace:await getComicPanelWorkspace(projectId,set.episodeId),adoptedSetId:set.id,adoptionRevision:Number(action.payload.revision),requestKey,repeated:true};
}

async function bundleContinuity(db:WorkflowDb,projectId:string){
  const row=(await db.query(`SELECT card.values FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id
    WHERE card.space_id=$1 AND type.type_key=$2 AND card.status='active' ORDER BY card.created_at,card.id LIMIT 1`,[projectId,BUNDLE_TYPE])).rows[0],id=row?.values?.adopted_version_id;
  if(!id)return{characters:[],synopsis:null};const version=assertFound((await db.query('SELECT values FROM new_design.card_versions WHERE id=$1',[id])).rows[0],'采用的来源整理版本不存在。');
  return{characters:version.values.content?.characters??[],synopsis:version.values.content?.synopsis??null};
}

export async function getComicPanelScriptPrompt(projectId:string,episodeId:string,episodeVersionId:string,densityMode:ComicPanelScriptPrompt['densityMode'],instruction:string):Promise<ComicPanelScriptPrompt>{
  await capable();const db=await getNewDesignPool(),current=await episode(db,projectId,episodeId);if(current.adoptedVersionId!==episodeVersionId)throw new NewDesignError('当前正式分话大纲已变化，请重新读取后生成。',409);
  return{operation:'panel_script',projectId,episodeId,episodeVersionId,episode:current.episodeContent,densityMode,continuity:await bundleContinuity(db,projectId),instruction};
}

export async function readComicPanelGenerationOriginal(projectId:string,requestKey:string):Promise<ComicGenerationReceipt|null>{
  const result=await readComicPanelProposalOriginal(projectId,requestKey);if(!result||result.set.sourceKind!=='ai_candidate')return null;const workspace=await getComicPanelWorkspace(projectId,result.set.episodeId),current=result.set.episodeVersionId===workspace.episodeVersionId;
  return{requestKey,operation:'panel_script',sourceVersionIds:[result.set.episodeVersionId],candidateVersionId:result.set.id,status:'succeeded',repeated:true,readiness:current?'current':'stale_source',adopted:current&&workspace.adoptedSetId===result.set.id};
}

export async function proposeComicPanelSet(projectId:string,episodeId:string,raw:ComicPanelProposalInput,sourceKind:'manual'|'ai_candidate'='manual'):Promise<ComicPanelProposalReceipt>{
  const input=comicPanelProposalSchema.parse(raw),hash=fingerprint(sourceKind==='manual'?{projectId,episodeId,...input}:{projectId,episodeId,...input,sourceKind});await capable(true);const pool=await getNewDesignPool(),db=await pool.connect();let committing=false;
  try{
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`comic_panel_script:${episodeId}`]);const existing=await workflowActionByRequest(db,input.requestKey);
    if(existing){if(existing.action_key!=='comic_panel_script.candidate'||existing.input_hash!==hash)throw new NewDesignError('原分格候选请求已用于不同内容。',409);const set=await readSet(db,String(existing.card_version_id));await db.query('COMMIT');return{set,requestKey:input.requestKey,repeated:true};}
    const currentEpisode=await episode(db,projectId,episodeId,true),card=await panelCard(db,projectId,episodeId,true),revision=Number(card?.values?.workflow_revision??0);
    if(currentEpisode.adoptedVersionId!==input.episodeVersionId||revision!==input.expectedScriptRevision)throw new NewDesignError('分集大纲或已采用脚本发生变化，请先读取最新版本。',409);
    const panels=input.panels.map(item=>({id:randomUUID(),...item})),next=card?Number((await db.query(`SELECT coalesce(max((values->>'version')::integer),0)+1 value FROM new_design.card_versions WHERE card_id=$1`,[card.id])).rows[0].value):1,values={...(card?.values??{}),record_kind:PANEL_TYPE,project_id:projectId,episode_id:episodeId,workflow_revision:revision,adopted_version_id:card?.values?.adopted_version_id??null,version:next,episode_version_id:input.episodeVersionId,density_mode:input.densityMode,source_kind:sourceKind,panels};
    let cardId:string,versionId:string;if(card){const saved=await appendWorkflowVersion(db,{cardId:String(card.id),typeKey:PANEL_TYPE,title:`第 ${currentEpisode.values.episode_order} 话分格`,values});cardId=String(card.id);versionId=String(saved.id);}else{const created=await createWorkflowCard(db,{spaceId:projectId,typeKey:PANEL_TYPE,title:`第 ${currentEpisode.values.episode_order} 话分格`,values});cardId=created.cardId;versionId=created.versionId;}
    await recordWorkflowAction(db,{cardId,cardVersionId:versionId,actionKey:'comic_panel_script.candidate',requestKey:input.requestKey,inputHash:hash,payload:{sourceKind}});const set=await readSet(db,versionId);committing=true;await db.query('COMMIT');return{set,requestKey:input.requestKey,repeated:false};
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);if(committing)throw new NewDesignError('分格候选结果未知，请按原请求只读核对。',503);throw error;}finally{db.release();}
}

export async function adoptComicPanelSet(projectId:string,episodeId:string,raw:ComicPanelAdoptionInput):Promise<ComicPanelAdoptionReceipt>{
  const input=comicPanelAdoptionSchema.parse(raw),hash=fingerprint({projectId,episodeId,...input});await capable(true);const pool=await getNewDesignPool(),db=await pool.connect();let committing=false;
  try{
    await db.query('BEGIN');const existing=await workflowActionByRequest(db,input.requestKey);
    if(existing){if(existing.action_key!=='comic_panel_script.adopt'||existing.input_hash!==hash)throw new NewDesignError('原分格采用请求已用于其他内容。',409);await db.query('COMMIT');return{workspace:await getComicPanelWorkspace(projectId,episodeId),adoptedSetId:String(existing.card_version_id),adoptionRevision:Number(existing.payload.revision),requestKey:input.requestKey,repeated:true};}
    const currentEpisode=await episode(db,projectId,episodeId,true),card=assertFound(await panelCard(db,projectId,episodeId,true),'分格候选不存在。'),target=assertFound((await db.query('SELECT values FROM new_design.card_versions WHERE id=$1 AND card_id=$2',[input.setId,card.id])).rows[0],'分格候选不存在或属于其他分集。');
    if(String(target.values.episode_version_id)!==currentEpisode.adoptedVersionId)throw new NewDesignError('分格候选依据旧分集大纲，请重新制作候选。',409);
    const adopted=await adoptWorkflowVersion(db,{cardId:String(card.id),typeKey:PANEL_TYPE,versionId:input.setId,expectedRevision:input.expectedScriptRevision,actionKey:'comic_panel_script.adopt',requestKey:input.requestKey,inputHash:hash,payload:{projectId,episodeId}});committing=true;await db.query('COMMIT');return{workspace:await getComicPanelWorkspace(projectId,episodeId),adoptedSetId:input.setId,adoptionRevision:adopted.revision,requestKey:input.requestKey,repeated:false};
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);if(committing)throw new NewDesignError('分格采用结果未知，请按原请求只读核对。',503);throw error;}finally{db.release();}
}
