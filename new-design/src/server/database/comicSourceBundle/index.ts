import {createHash,randomUUID} from 'node:crypto';
import {
  comicSourceBundleAdoptionSchema,comicSourceBundleContentSchema,comicSourceBundleProposalSchema,
  type ComicSourceBundleAdoptionInput,type ComicSourceBundleAdoptionReceipt,type ComicSourceBundleProposalInput,
  type ComicSourceBundleProposalReceipt,type ComicSourceBundleVersion,type ComicSourceBundleWorkspace,
  type ComicSourceExtractionPrompt,
} from '../../../common/comicSourceBundle';
import type {ComicGenerationReceipt} from '../../../common/comicPanels';
import {NewDesignError,assertFound} from '../../domain/errors';
import {
  adoptWorkflowVersion,appendWorkflowVersion,createWorkflowCard,recordWorkflowAction,requireCardWorkflowTypes,
  workflowActionByRequest,workflowCard,workflowVersions,type WorkflowDb,type WorkflowRow,
} from '../cardWorkflow';
import {getNewDesignPool} from '../runtime';

const PROJECT_TYPE='comic_project',BUNDLE_TYPE='comic_source_bundle';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const iso=(value:unknown)=>new Date(String(value)).toISOString();

async function capable(write=false){await requireCardWorkflowTypes(await getNewDesignPool(),[PROJECT_TYPE,BUNDLE_TYPE],write);}

async function project(db:WorkflowDb,projectId:string,lock=false){
  const row=await workflowCard(db,projectId,PROJECT_TYPE,lock),values=row.values as WorkflowRow;
  return{row,sourceVersionId:String(values.source_version_id),source:values.source_snapshot as WorkflowRow};
}

async function bundleCard(db:WorkflowDb,projectId:string,lock=false):Promise<WorkflowRow|null>{
  return(await db.query(`SELECT card.*,version.values current_values
    FROM new_design.cards card
    JOIN new_design.card_types type ON type.id=card.card_type_id AND type.type_key=$2
    JOIN new_design.card_versions version ON version.id=card.current_version_id
    WHERE card.space_id=$1 AND card.status='active'
    ORDER BY card.created_at,card.id LIMIT 1${lock?' FOR UPDATE OF card':''}`,[projectId,BUNDLE_TYPE])).rows[0]??null;
}

function version(row:WorkflowRow):ComicSourceBundleVersion{
  const values=row.values as WorkflowRow;
  return{id:String(row.id),projectId:String(values.project_id),version:Number(values.version),sourceVersionId:String(values.source_version_id),sourceKind:values.source_kind,content:comicSourceBundleContentSchema.parse(values.content),createdAt:iso(row.created_at)};
}

async function workspace(db:WorkflowDb,projectId:string):Promise<ComicSourceBundleWorkspace>{
  const currentProject=await project(db,projectId),card=await bundleCard(db,projectId);
  if(!card)return{projectId,sourceVersionId:currentProject.sourceVersionId,revision:0,adoptedVersionId:null,versions:[]};
  const values=card.values as WorkflowRow,versions=(await workflowVersions(db,String(card.id))).map(version);
  return{projectId,sourceVersionId:currentProject.sourceVersionId,revision:Number(values.workflow_revision??0),adoptedVersionId:values.adopted_version_id?String(values.adopted_version_id):null,versions};
}

export async function getComicSourceBundleWorkspace(projectId:string):Promise<ComicSourceBundleWorkspace>{
  await capable();const db=await(await getNewDesignPool()).connect();
  try{await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await workspace(db,projectId);await db.query('COMMIT');return result;}
  catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}finally{db.release();}
}

export async function readComicSourceBundleOriginal(projectId:string,requestKey:string):Promise<ComicSourceBundleProposalReceipt|null>{
  await capable();const db=await getNewDesignPool(),action=await workflowActionByRequest(db,requestKey);
  if(!action||action.action_key!=='comic_source_bundle.candidate')return null;
  const current=await workspace(db,projectId),saved=current.versions.find(item=>item.id===String(action.card_version_id));
  return saved?{workspace:current,version:saved,requestKey,repeated:true}:null;
}

export async function readComicSourceBundleAdoptionOriginal(projectId:string,requestKey:string):Promise<ComicSourceBundleAdoptionReceipt|null>{
  await capable();const db=await getNewDesignPool(),action=await workflowActionByRequest(db,requestKey);
  if(!action||action.action_key!=='comic_source_bundle.adopt')return null;
  const current=await workspace(db,projectId);if(!current.versions.some(item=>item.id===String(action.card_version_id)))return null;
  return{workspace:current,adoptedVersionId:String(action.card_version_id),adoptionRevision:Number(action.payload.revision),requestKey,repeated:true};
}

export async function getComicSourceExtractionPrompt(projectId:string,instruction:string):Promise<ComicSourceExtractionPrompt>{
  await capable();const current=await project(await getNewDesignPool(),projectId);
  return{operation:'source_extract',projectId,sourceVersionId:current.sourceVersionId,sourceText:String(current.source.content),sourceManifest:current.source.manifest as Record<string,unknown>,instruction};
}

export async function readComicSourceGenerationOriginal(projectId:string,requestKey:string):Promise<ComicGenerationReceipt|null>{
  const result=await readComicSourceBundleOriginal(projectId,requestKey);if(!result||result.version.sourceKind!=='ai_candidate')return null;
  return{requestKey,operation:'source_extract',sourceVersionIds:[result.version.sourceVersionId],candidateVersionId:result.version.id,status:'succeeded',repeated:true,readiness:result.version.sourceVersionId===result.workspace.sourceVersionId?'current':'stale_source',adopted:result.workspace.adoptedVersionId===result.version.id};
}

export async function proposeComicSourceBundle(projectId:string,raw:ComicSourceBundleProposalInput,options:{sourceKind?:'manual'|'ai_candidate';expectedSourceVersionId?:string}={}):Promise<ComicSourceBundleProposalReceipt>{
  const input=comicSourceBundleProposalSchema.parse(raw),sourceKind=options.sourceKind??'manual',hash=digest(sourceKind==='manual'?{projectId,...input}:{projectId,...input,sourceKind,expectedSourceVersionId:options.expectedSourceVersionId??null});
  await capable(true);const pool=await getNewDesignPool(),db=await pool.connect();let committing=false;
  try{
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`comic_source_bundle:${projectId}`]);
    const prior=await workflowActionByRequest(db,input.requestKey);
    if(prior){if(prior.action_key!=='comic_source_bundle.candidate'||prior.input_hash!==hash)throw new NewDesignError('原来源整理请求已用于不同内容。',409);const current=await workspace(db,projectId);await db.query('COMMIT');return{workspace:current,version:assertFound(current.versions.find(item=>item.id===String(prior.card_version_id)),'原来源整理候选不存在。'),requestKey:input.requestKey,repeated:true};}
    const currentProject=await project(db,projectId,true);if(options.expectedSourceVersionId&&currentProject.sourceVersionId!==options.expectedSourceVersionId)throw new NewDesignError('漫画原文来源已变化，AI 候选未保存；请基于当前来源重新生成。',409);
    let card=await bundleCard(db,projectId,true),savedVersionId:string;
    if(!card){
      if(input.expectedRevision!==0)throw new NewDesignError('来源整理采用状态已变化，请先读取当前版本。',409);
      const initial={record_kind:BUNDLE_TYPE,project_id:projectId,workflow_revision:0,adopted_version_id:null,version:1,source_version_id:currentProject.sourceVersionId,source_kind:sourceKind,content:input.content};
      const created=await createWorkflowCard(db,{id:randomUUID(),spaceId:projectId,typeKey:BUNDLE_TYPE,title:'来源整理',values:initial,versionId:randomUUID()});savedVersionId=created.versionId;
      await recordWorkflowAction(db,{cardId:created.cardId,cardVersionId:created.versionId,actionKey:'comic_source_bundle.candidate',requestKey:input.requestKey,inputHash:hash,payload:{sourceKind}});
    }else{
      const values=card.values as WorkflowRow;if(Number(values.workflow_revision??0)!==input.expectedRevision)throw new NewDesignError('来源整理采用状态已变化，请先读取当前版本。',409);
      const next=Number((await db.query(`SELECT coalesce(max((values->>'version')::integer),0)+1 value FROM new_design.card_versions WHERE card_id=$1`,[card.id])).rows[0].value),candidateValues={...values,record_kind:BUNDLE_TYPE,version:next,source_version_id:currentProject.sourceVersionId,source_kind:sourceKind,content:input.content};
      const candidate=await appendWorkflowVersion(db,{cardId:String(card.id),typeKey:BUNDLE_TYPE,values:candidateValues});savedVersionId=String(candidate.id);
      await recordWorkflowAction(db,{cardId:String(card.id),cardVersionId:savedVersionId,actionKey:'comic_source_bundle.candidate',requestKey:input.requestKey,inputHash:hash,payload:{sourceKind}});
    }
    const current=await workspace(db,projectId),saved=assertFound(current.versions.find(item=>item.id===savedVersionId),'来源整理候选未保存。');
    committing=true;await db.query('COMMIT');return{workspace:current,version:saved,requestKey:input.requestKey,repeated:false};
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);if(committing)throw new NewDesignError('来源整理候选结果未知，请只读核对原请求。',503);throw error;}finally{db.release();}
}

export async function adoptComicSourceBundle(projectId:string,raw:ComicSourceBundleAdoptionInput):Promise<ComicSourceBundleAdoptionReceipt>{
  const input=comicSourceBundleAdoptionSchema.parse(raw),hash=digest({projectId,...input});await capable(true);const pool=await getNewDesignPool(),db=await pool.connect();let committing=false;
  try{
    await db.query('BEGIN');const prior=await workflowActionByRequest(db,input.requestKey);
    if(prior){if(prior.action_key!=='comic_source_bundle.adopt'||prior.input_hash!==hash)throw new NewDesignError('原来源整理采用请求已用于不同版本。',409);const current=await workspace(db,projectId);await db.query('COMMIT');return{workspace:current,adoptedVersionId:String(prior.card_version_id),adoptionRevision:Number(prior.payload.revision),requestKey:input.requestKey,repeated:true};}
    const currentProject=await project(db,projectId,true),card=assertFound(await bundleCard(db,projectId,true),'漫画来源整理尚无候选。'),target=assertFound((await db.query('SELECT values FROM new_design.card_versions WHERE id=$1 AND card_id=$2',[input.versionId,card.id])).rows[0],'来源整理候选不属于本项目。');
    if(String(target.values.source_version_id)!==currentProject.sourceVersionId)throw new NewDesignError('候选基于旧来源，不能采用。',409);
    const adopted=await adoptWorkflowVersion(db,{cardId:String(card.id),typeKey:BUNDLE_TYPE,versionId:input.versionId,expectedRevision:input.expectedRevision,actionKey:'comic_source_bundle.adopt',requestKey:input.requestKey,inputHash:hash,payload:{projectId}});
    const current=await workspace(db,projectId);committing=true;await db.query('COMMIT');return{workspace:current,adoptedVersionId:input.versionId,adoptionRevision:adopted.revision,requestKey:input.requestKey,repeated:false};
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);if(committing)throw new NewDesignError('来源整理采用结果未知，请只读核对原请求。',503);throw error;}finally{db.release();}
}
