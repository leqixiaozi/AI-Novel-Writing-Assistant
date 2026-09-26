import {createHash,randomUUID} from 'node:crypto';
import {
  comicBibleAdoptionSchema,comicBibleProposalSchema,type ComicBibleAdoptionInput,type ComicBibleAdoptionReceipt,
  type ComicBibleEntity,type ComicBibleProposalInput,type ComicBibleProposalReceipt,type ComicBibleVersion,
  type ComicBibleWorkspace,
} from '../../../common/comicBibles';
import {NewDesignError,assertFound} from '../../domain/errors';
import {
  adoptWorkflowVersion,appendWorkflowVersion,createWorkflowCard,recordWorkflowAction,requireCardWorkflowTypes,
  workflowActionByRequest,workflowCard,workflowVersions,type WorkflowDb,type WorkflowRow,
} from '../cardWorkflow';
import {getNewDesignPool} from '../runtime';

const PROJECT_TYPE='comic_project',BIBLE_TYPE='comic_bible';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const iso=(value:unknown)=>new Date(String(value)).toISOString();
async function capable(write=false){await requireCardWorkflowTypes(await getNewDesignPool(),[PROJECT_TYPE,BIBLE_TYPE],write);}

function bibleVersion(row:WorkflowRow):ComicBibleVersion{
  const values=row.values as WorkflowRow;
  return{id:String(row.id),entityId:String(row.card_id),version:Number(values.version),content:values.content,sourceKind:values.source_kind,createdAt:iso(row.created_at)};
}

async function entity(db:WorkflowDb,projectId:string,id:string,lock=false):Promise<ComicBibleEntity>{
  const row=await workflowCard(db,id,BIBLE_TYPE,lock);if(String(row.space_id)!==projectId)throw new NewDesignError('漫画角色或场景不存在。',404);const values=row.values as WorkflowRow;
  return{id:String(row.id),projectId,kind:values.kind,revision:Number(values.workflow_revision??0),adoptedVersionId:values.adopted_version_id?String(values.adopted_version_id):null,versions:(await workflowVersions(db,id)).map(bibleVersion)};
}

export async function getComicBibleWorkspace(projectId:string):Promise<ComicBibleWorkspace>{
  await capable();const db=await(await getNewDesignPool()).connect();
  try{
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await workflowCard(db,projectId,PROJECT_TYPE);const rows=(await db.query(`SELECT card.id,card.values->>'kind' kind
      FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id
      WHERE card.space_id=$1 AND card.status='active' AND type.type_key=$2 ORDER BY card.created_at,card.id`,[projectId,BIBLE_TYPE])).rows,characters:ComicBibleEntity[]=[],scenes:ComicBibleEntity[]=[];
    for(const row of rows){const item=await entity(db,projectId,String(row.id));(row.kind==='character'?characters:scenes).push(item);}await db.query('COMMIT');return{projectId,characters,scenes};
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}finally{db.release();}
}

export async function readComicBibleOriginal(projectId:string,requestKey:string):Promise<ComicBibleProposalReceipt|null>{
  await capable();const db=await getNewDesignPool(),action=await workflowActionByRequest(db,requestKey);if(!action||action.action_key!=='comic_bible.candidate')return null;
  const item=await entity(db,projectId,String(action.card_id)),saved=item.versions.find(candidate=>candidate.id===String(action.card_version_id));return saved?{entity:item,version:saved,requestKey,repeated:true}:null;
}

export async function readComicBibleAdoptionOriginal(projectId:string,requestKey:string):Promise<ComicBibleAdoptionReceipt|null>{
  await capable();const db=await getNewDesignPool(),action=await workflowActionByRequest(db,requestKey);if(!action||action.action_key!=='comic_bible.adopt')return null;
  return{entity:await entity(db,projectId,String(action.card_id)),adoptedVersionId:String(action.card_version_id),adoptionRevision:Number(action.payload.revision),requestKey,repeated:true};
}

export async function proposeComicBible(projectId:string,raw:ComicBibleProposalInput):Promise<ComicBibleProposalReceipt>{
  const input=comicBibleProposalSchema.parse(raw),hash=digest({projectId,...input});await capable(true);const pool=await getNewDesignPool(),db=await pool.connect();let committing=false;
  try{
    await db.query('BEGIN');const previous=await workflowActionByRequest(db,input.requestKey);
    if(previous){if(previous.action_key!=='comic_bible.candidate'||previous.input_hash!==hash)throw new NewDesignError('原设定候选请求已用于不同内容。',409);const item=await entity(db,projectId,String(previous.card_id));await db.query('COMMIT');return{entity:item,version:assertFound(item.versions.find(value=>value.id===String(previous.card_version_id)),'原设定候选不存在。'),requestKey:input.requestKey,repeated:true};}
    await workflowCard(db,projectId,PROJECT_TYPE,true);const id=input.entityId??randomUUID();let card:WorkflowRow|null=null;
    if(input.entityId)card=await workflowCard(db,id,BIBLE_TYPE,true);
    if(card&&String(card.space_id)!==projectId)throw new NewDesignError('设定对象不存在或不属于该项目。',404);
    if(card&&card.values.kind!==input.kind)throw new NewDesignError('不能把角色设定改为场景，或把场景改为角色。',409);
    let versionId:string;if(!card){
      if(input.expectedRevision!==0)throw new NewDesignError('新设定尚未建立，请重新核对。',409);
      const created=await createWorkflowCard(db,{id,spaceId:projectId,typeKey:BIBLE_TYPE,title:input.content.name,values:{record_kind:BIBLE_TYPE,project_id:projectId,kind:input.kind,workflow_revision:0,adopted_version_id:null,version:1,content:input.content,source_kind:'manual'}});versionId=created.versionId;
    }else{
      const values=card.values as WorkflowRow;if(Number(values.workflow_revision??0)!==input.expectedRevision)throw new NewDesignError('设定对象已有新采用版本，请先核对。',409);
      const next=Number((await db.query(`SELECT coalesce(max((values->>'version')::integer),0)+1 value FROM new_design.card_versions WHERE card_id=$1`,[id])).rows[0].value),saved=await appendWorkflowVersion(db,{cardId:id,typeKey:BIBLE_TYPE,title:input.content.name,values:{...values,version:next,content:input.content,source_kind:'manual'}});versionId=String(saved.id);
    }
    await recordWorkflowAction(db,{cardId:id,cardVersionId:versionId,actionKey:'comic_bible.candidate',requestKey:input.requestKey,inputHash:hash,payload:{kind:input.kind}});const item=await entity(db,projectId,id);committing=true;await db.query('COMMIT');return{entity:item,version:assertFound(item.versions.find(value=>value.id===versionId),'设定候选未保存。'),requestKey:input.requestKey,repeated:false};
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);if(committing)throw new NewDesignError('设定候选结果未知，请只读核对原请求。',503);throw error;}finally{db.release();}
}

export async function adoptComicBible(projectId:string,entityId:string,raw:ComicBibleAdoptionInput):Promise<ComicBibleAdoptionReceipt>{
  const input=comicBibleAdoptionSchema.parse(raw),hash=digest({projectId,entityId,...input});await capable(true);const pool=await getNewDesignPool(),db=await pool.connect();let committing=false;
  try{
    await db.query('BEGIN');const previous=await workflowActionByRequest(db,input.requestKey);
    if(previous){if(previous.action_key!=='comic_bible.adopt'||previous.input_hash!==hash||String(previous.card_id)!==entityId)throw new NewDesignError('原设定采用请求已用于不同对象。',409);const item=await entity(db,projectId,entityId);await db.query('COMMIT');return{entity:item,adoptedVersionId:String(previous.card_version_id),adoptionRevision:Number(previous.payload.revision),requestKey:input.requestKey,repeated:true};}
    const current=await entity(db,projectId,entityId,true);const adopted=await adoptWorkflowVersion(db,{cardId:entityId,typeKey:BIBLE_TYPE,versionId:input.versionId,expectedRevision:input.expectedRevision,actionKey:'comic_bible.adopt',requestKey:input.requestKey,inputHash:hash,payload:{projectId,kind:current.kind}}),item=await entity(db,projectId,entityId);committing=true;await db.query('COMMIT');return{entity:item,adoptedVersionId:input.versionId,adoptionRevision:adopted.revision,requestKey:input.requestKey,repeated:false};
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);if(committing)throw new NewDesignError('设定采用结果未知，请只读核对原请求。',503);throw error;}finally{db.release();}
}
