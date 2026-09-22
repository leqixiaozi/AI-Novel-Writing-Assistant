import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {NewDesignAiGateway} from '../../ai/gateway';
import {AiExecutionError} from '../../ai/runtime/errors';
import {NewDesignError,assertFound} from '../../domain/errors';
import {worldUsageSourcesSchema,worldUsageCandidateSchema,worldUsageAdoptionSchema,worldUsageWorkspaceSchema,worldUsagePrepareInputSchema,worldUsageAdoptInputSchema,worldUsageSelectionSchema,validateWorldUsageSelection,worldUsageCreativeScopes,type WorldUsageSources,type WorldUsageCandidate,type WorldUsageCreativeScope} from '../../../common/worldUsage';
import {stableHash} from '../aiContracts';
import {recordWorkflowAction,requireCardWorkflowTypes,workflowActionByRequest} from '../cardWorkflow';
import {createRecordCard,findRecordCardByValue,listRecordCards,replaceRecordCard,type RecordCardRow} from '../recordCards';
import {getNewDesignPool} from '../runtime';

const groups:Record<string,'factions'|'locations'|'rules'>={faction:'factions',organization:'factions',location:'locations',world_rule:'rules',time_rule:'rules',power_system:'rules'};
const CANDIDATE_TYPE='world_usage_candidate',ADOPTION_TYPE='world_usage_adoption';
const date=(value:unknown)=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
export class WorldUsageError extends NewDesignError{constructor(message:string,status=503,public readonly mutationOutcome:'not_written'|'unknown'='unknown'){super(message,status);}}

async function capability(db:PoolClient){
  try{await requireCardWorkflowTypes(db,[CANDIDATE_TYPE,ADOPTION_TYPE]);return{installed:true,operational:true};}
  catch{return{installed:false,operational:false};}
}

export async function freezeWorldUsageSources(db:PoolClient,bookId:string,rootCardId:string):Promise<WorldUsageSources>{
  const root=assertFound((await db.query("SELECT book.space_id,card.id,card.title,card.current_version_id,version.values,type.type_key FROM new_design.books book JOIN new_design.cards card ON card.space_id=book.space_id JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.card_versions version ON version.id=card.current_version_id WHERE book.id=$1 AND book.status='active' AND card.id=$2 AND card.status='active' AND type.type_key IN ('world_setting','world_overview')",[bookId,rootCardId])).rows[0],'本书世界根档案不存在或不属于这本书。');
  const rows=(await db.query("SELECT card.id,card.title,card.current_version_id,type.type_key,version.values FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.card_versions version ON version.id=card.current_version_id WHERE card.space_id=$1 AND card.status='active' AND type.type_key=ANY($2::text[]) ORDER BY type.type_key,card.id LIMIT 151",[root.space_id,Object.keys(groups)])).rows;
  if(rows.length>150)throw new NewDesignError('世界资料超过完整冻结范围；未截断生成使用范围。',422);
  const localRows=await listRecordCards(db,'card_version_local_value'),definitions=(await db.query('SELECT id,field_key FROM new_design.field_definitions')).rows,definitionKeys=new Map(definitions.map(item=>[String(item.id),String(item.field_key)]));
  const mergeLocal=(versionId:string,values:Record<string,unknown>)=>({...values,...Object.fromEntries(localRows.filter(item=>item.card_version_id===versionId).map(item=>[definitionKeys.get(String(item.field_definition_id))??String(item.field_definition_id),item.value]))});
  root.values=mergeLocal(String(root.current_version_id),root.values as Record<string,unknown>);
  for(const row of rows)row.values=mergeLocal(String(row.current_version_id),row.values as Record<string,unknown>);
  const formVersions=await listRecordCards(db,'card_group_form_version');
  const instances=(await listRecordCards(db,'card_group_form_instance')).filter(instance=>instance.space_id===root.space_id&&instance.primary_card_id===rootCardId&&formVersions.some(version=>version.id===instance.form_version_id&&version.definition?.primaryTypeKey===root.type_key)).slice(0,21);
  if(instances.length>20)throw new NewDesignError('本书世界关联表单超过完整冻结范围；未截断后生成。',422);
  const allMounts=await listRecordCards(db,'card_mount'),associationSources=[];
  let totalMounts=0;
  for(const instance of instances){
    const mounts=allMounts.filter(mount=>mount.form_instance_id===instance.id&&mount.status==='active').slice(0,301);
    totalMounts+=mounts.length;
    if(totalMounts>300)throw new NewDesignError('本书世界关联项超过完整冻结范围；未截断后生成。',422);
    associationSources.push({instanceId:String(instance.id),formVersionId:String(instance.form_version_id),instanceRevision:Number(instance.revision),mounts:mounts.map(mount=>({mountId:String(mount.id),revision:Number(mount.revision),versionId:String(mount.current_version_id),cardId:String(mount.card_id),attachedVersionId:String(mount.source_card_version_id),slotKey:String(mount.slot_key),sortOrder:Number(mount.sort_order),localValues:mount.local_values as Record<string,unknown>}))});
  }
  const mounts=associationSources.flatMap(item=>item.mounts),instance=instances[0]??null;
  const cards=rows.map(row=>{const mount=mounts.find(item=>item.cardId===row.id);return{cardId:String(row.id),versionId:String(row.current_version_id),typeKey:String(row.type_key),title:String(row.title),values:row.values as Record<string,unknown>,slotKey:groups[String(row.type_key)]!,mountId:mount?.mountId??null,mountRevision:mount?.revision??null};});
  const base={bookId,rootCardId,rootVersionId:String(root.current_version_id),rootTitle:String(root.title),rootValues:root.values as Record<string,unknown>,formVersionId:instance?String(instance.form_version_id):null,instanceId:instance?String(instance.id):null,instanceRevision:instance?Number(instance.revision):null,associationSources,cards};
  return worldUsageSourcesSchema.parse({...base,sourceHash:stableHash(base)});
}

function candidate(row:Record<string,any>):WorldUsageCandidate{return worldUsageCandidateSchema.parse({id:row.id,bookId:row.book_id,rootCardId:row.root_card_id,requestKey:row.request_key,inputHash:row.input_hash,mode:row.mode,status:row.status,sources:row.sources,selection:row.selection,usedTokens:row.result_payload?.usedTokens??null,message:row.message,createdAt:date(row.created_at)});}
function adoption(row:Record<string,any>){return worldUsageAdoptionSchema.parse({id:row.id,bookId:row.book_id,rootCardId:row.root_card_id,candidateId:row.candidate_id,requestKey:row.request_key,inputHash:row.input_hash,version:Number(row.version),sources:row.sources,selection:row.selection,createdAt:date(row.created_at)});}
async function read<T>(work:(db:PoolClient)=>Promise<T>):Promise<T>{const db=await(await getNewDesignPool()).connect();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await work(db);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}

function candidateValues(row:RecordCardRow,patch:Record<string,unknown>={}){return{id:row.id,book_id:row.book_id,root_card_id:row.root_card_id,request_key:row.request_key,input_hash:row.input_hash,mode:row.mode,status:row.status,source_hash:row.source_hash,sources:row.sources,selection:row.selection??null,result_payload:row.result_payload??null,message:row.message??'',...patch};}

export const getWorldUsageWorkspace=(bookId:string,rootCardId:string)=>read(async db=>{
  const sources=await freezeWorldUsageSources(db,bookId,rootCardId),enabled=await capability(db);
  if(!enabled.installed)return worldUsageWorkspaceSchema.parse({bookId,rootCardId,capability:enabled,sources,candidates:[],adopted:null,stale:false,staleReason:null});
  const candidates=(await listRecordCards(db,CANDIDATE_TYPE)).filter(row=>row.book_id===bookId&&row.root_card_id===rootCardId).sort((left,right)=>date(right.created_at).localeCompare(date(left.created_at))).slice(0,50).map(candidate);
  const last=(await listRecordCards(db,ADOPTION_TYPE)).filter(row=>row.book_id===bookId&&row.root_card_id===rootCardId).sort((left,right)=>Number(right.version)-Number(left.version))[0],adopted=last?adoption(last):null,stale=Boolean(adopted&&adopted.sources.sourceHash!==sources.sourceHash);
  return worldUsageWorkspaceSchema.parse({bookId,rootCardId,capability:enabled,sources,candidates,adopted,stale,staleReason:stale?'正式使用范围的世界资料、版本或关联已变化；须重新核对并采用候选。':null});
});

export const getWorldUsageCandidateByKey=(bookId:string,rootCardId:string,key:string)=>read(async db=>{if(!(await capability(db)).installed)return null;const row=await findRecordCardByValue(db,CANDIDATE_TYPE,'request_key',key);return row&&row.book_id===bookId&&row.root_card_id===rootCardId?candidate(row):null;});
export const getWorldUsageAdoptionByKey=(bookId:string,rootCardId:string,key:string)=>read(async db=>{if(!(await capability(db)).installed)return null;const row=await findRecordCardByValue(db,ADOPTION_TYPE,'request_key',key);return row&&row.book_id===bookId&&row.root_card_id===rootCardId?adoption(row):null;});

async function updateCandidate(pool:Awaited<ReturnType<typeof getNewDesignPool>>,bookId:string,requestKey:string,patch:(row:RecordCardRow)=>Record<string,unknown>){
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const row=await findRecordCardByValue(db,CANDIDATE_TYPE,'request_key',requestKey,{lock:true});
    if(!row||row.book_id!==bookId||row.status!=='running'){await db.query('ROLLBACK');return null;}
    const saved=await replaceRecordCard(db,{id:row.recordCardId,spaceId:row.recordSpaceId,typeKey:CANDIDATE_TYPE,title:'世界使用范围候选',values:candidateValues(row,patch(row))});
    await db.query('COMMIT');
    return saved;
  }catch(error){await db.query('ROLLBACK').catch(()=>undefined);throw error;}finally{db.release();}
}

export async function prepareWorldUsageCandidate(bookId:string,rootCardId:string,raw:unknown,ai?:NewDesignAiGateway):Promise<WorldUsageCandidate>{
  const input=worldUsagePrepareInputSchema.parse(raw),inputHash=stableHash(input),pool=await getNewDesignPool().catch(()=>{throw new WorldUsageError('数据库尚不可用，候选未写入；原填写保留。',503,'not_written');}),db=await pool.connect().catch(()=>{throw new WorldUsageError('数据库连接未建立，候选未写入；原填写保留。',503,'not_written');});
  let source:WorldUsageSources|null=null,committing=false,saved:RecordCardRow|null=null;
  try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`world-usage:${bookId}:${input.requestKey}`]);
    const prior=await findRecordCardByValue(db,CANDIDATE_TYPE,'request_key',input.requestKey);
    if(prior){
      if(prior.input_hash!==inputHash||prior.root_card_id!==rootCardId)throw new WorldUsageError('原请求键对应不同世界范围。',409);
      await db.query('ROLLBACK');
      return candidate(prior);
    }
    if(!(await capability(db)).operational)throw new WorldUsageError('本书世界使用范围能力尚未启用。',503,'not_written');
    source=await freezeWorldUsageSources(db,bookId,rootCardId);
    if(source.sourceHash!==input.expectedSourceHash)throw new WorldUsageError('本书世界来源已变化，请重新核对候选。',409,'not_written');
    if(input.mode==='manual'){
      try{validateWorldUsageSelection(source,input.selection!);}catch(error){throw new WorldUsageError(error instanceof Error?error.message:'使用范围选择无效。',422,'not_written');}
    }else{
      if(!source.cards.length)throw new WorldUsageError('本书尚无可选的正式世界资料，请先建立势力、地点或规则。',422,'not_written');
      if(!ai?.suggestWorldUsage)throw new WorldUsageError('请先为世界使用范围建议配置创作模型。',503,'not_written');
    }
    const book=assertFound((await db.query('SELECT space_id FROM new_design.books WHERE id=$1',[bookId])).rows[0],'书籍不存在。'),id=randomUUID(),status=input.mode==='manual'?'review':'running';
    saved=await createRecordCard(db,{spaceId:String(book.space_id),typeKey:CANDIDATE_TYPE,title:'世界使用范围候选',values:{id,book_id:bookId,root_card_id:rootCardId,request_key:input.requestKey,input_hash:inputHash,mode:input.mode,status,source_hash:source.sourceHash,sources:source,selection:input.selection??null,result_payload:null,message:''}});
    await recordWorkflowAction(db,{cardId:saved.recordCardId,actionKey:'world_usage.candidate',requestKey:input.requestKey,inputHash,payload:{bookId,rootCardId,candidateId:id}});
    committing=true;
    await db.query('COMMIT');
    if(input.mode==='manual')return candidate(saved);
  }catch(error){
    let rolledBack=false;try{await db.query('ROLLBACK');rolledBack=true;}catch{}
    if(error instanceof WorldUsageError)throw error;
    throw new WorldUsageError(error instanceof NewDesignError?error.message:'世界候选准备结果待核对。',error instanceof NewDesignError?error.status:503,!committing&&rolledBack?'not_written':'unknown');
  }finally{db.release();}

  try{
    const generated=await ai!.suggestWorldUsage!({sources:source!,instruction:input.instruction}),selection=worldUsageSelectionSchema.parse(generated.output);
    validateWorldUsageSelection(source!,selection);
    const row=await updateCandidate(pool,bookId,input.requestKey,()=>({status:'review',selection,result_payload:{promptSnapshot:generated.promptSnapshot,modelSnapshot:generated.modelSnapshot,usedTokens:generated.usedTokens},message:''}));
    if(!row)throw Error('世界候选回执未确认。');
    return candidate(row);
  }catch(error){
    const trace=error instanceof AiExecutionError?error.executionSnapshot:null,attempts=Array.isArray(trace?.attempts)?trace.attempts as Array<{requestSent:boolean;responseReceived:boolean}>:null,confirmed=attempts!==null&&attempts.every(attempt=>!attempt.requestSent||attempt.responseReceived);
    if(confirmed){
      const row=await updateCandidate(pool,bookId,input.requestKey,()=>({status:'failed',message:error instanceof Error?error.message:'原建议不符合世界范围规格。',result_payload:{failureSnapshot:trace}})).catch(()=>null);
      if(row)return candidate(row);
    }
    await updateCandidate(pool,bookId,input.requestKey,()=>({message:'原模型请求结果待核对；不换键重发。'})).catch(()=>undefined);
    throw new WorldUsageError(error instanceof Error?error.message:'原世界建议结果待核对。',503,'unknown');
  }
}

export async function adoptWorldUsageCandidate(bookId:string,rootCardId:string,raw:unknown){
  const input=worldUsageAdoptInputSchema.parse(raw),inputHash=stableHash(input),pool=await getNewDesignPool().catch(()=>{throw new WorldUsageError('数据库尚不可用，采用未写入；原候选保留。',503,'not_written');}),db=await pool.connect().catch(()=>{throw new WorldUsageError('数据库连接未建立，采用未写入；原候选保留。',503,'not_written');});
  let committing=false;
  try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`world-usage-adopt:${bookId}:${rootCardId}`]);
    const prior=await findRecordCardByValue(db,ADOPTION_TYPE,'request_key',input.requestKey);
    if(prior){
      if(prior.input_hash!==inputHash||prior.root_card_id!==rootCardId)throw new WorldUsageError('原采用键对应不同范围。',409);
      await db.query('ROLLBACK');
      return adoption(prior);
    }
    if(!(await capability(db)).operational)throw new WorldUsageError('世界使用范围尚未启用。',503,'not_written');
    const proposed=await findRecordCardByValue(db,CANDIDATE_TYPE,'id',input.candidateId);
    if(!proposed||proposed.book_id!==bookId||proposed.root_card_id!==rootCardId||proposed.status!=='review')throw new NewDesignError('候选不存在或尚未完成。',404);
    const original=candidate(proposed),fresh=await freezeWorldUsageSources(db,bookId,rootCardId);
    if(original.sources.sourceHash!==input.expectedSourceHash||fresh.sourceHash!==input.expectedSourceHash)throw new WorldUsageError('候选使用的正式来源已变化，不能采用旧建议。',409,'not_written');
    validateWorldUsageSelection(fresh,original.selection!);
    const adoptions=(await listRecordCards(db,ADOPTION_TYPE,{lock:true})).filter(row=>row.book_id===bookId&&row.root_card_id===rootCardId),version=Math.max(0,...adoptions.map(row=>Number(row.version)));
    if(version!==input.expectedCurrentVersion)throw new WorldUsageError('本书世界使用范围已有更新，请先比较当前采用版本。',409,'not_written');
    const book=assertFound((await db.query('SELECT space_id FROM new_design.books WHERE id=$1',[bookId])).rows[0],'书籍不存在。'),id=randomUUID(),row=await createRecordCard(db,{spaceId:String(book.space_id),typeKey:ADOPTION_TYPE,title:'正式世界使用范围',values:{id,book_id:bookId,root_card_id:rootCardId,candidate_id:input.candidateId,request_key:input.requestKey,input_hash:inputHash,version:version+1,source_hash:fresh.sourceHash,sources:fresh,selection:original.selection}});
    await recordWorkflowAction(db,{cardId:row.recordCardId,actionKey:'world_usage.adopt',requestKey:input.requestKey,inputHash,payload:{bookId,rootCardId,adoptionId:id,version:version+1}});
    committing=true;
    await db.query('COMMIT');
    return adoption(row);
  }catch(error){
    let rolledBack=false;try{await db.query('ROLLBACK');rolledBack=true;}catch{}
    if(error instanceof WorldUsageError)throw error;
    throw new WorldUsageError(error instanceof NewDesignError?error.message:'世界范围采用回执待核对。',error instanceof NewDesignError?error.status:503,!committing&&rolledBack?'not_written':'unknown');
  }finally{db.release();}
}

export async function readActiveWorldUsageScopes(db:PoolClient,bookId:string){
  const enabled=await capability(db);
  if(!enabled.installed)return[];
  const rows=(await listRecordCards(db,ADOPTION_TYPE)).filter(row=>row.book_id===bookId).sort((left,right)=>Number(right.version)-Number(left.version)),latest=new Map<string,RecordCardRow>();
  for(const row of rows)if(!latest.has(String(row.root_card_id)))latest.set(String(row.root_card_id),row);
  const roots=[...latest.values()];
  if(roots.length>20)throw new NewDesignError('本书正式世界使用范围超过完整冻结上限；未截断后生成。',422);
  if(!enabled.operational&&roots.length)throw new NewDesignError('正式世界使用范围能力已停用，不能忽略既有采用版本继续创作。',503);
  const scopes=[];
  for(const row of roots){const adopted=adoption(row),fresh=await freezeWorldUsageSources(db,bookId,adopted.rootCardId);if(fresh.sourceHash!==adopted.sources.sourceHash)throw new NewDesignError('正式世界使用范围的资料或关联已变化，请重新核对并采用；本次未继续创作。',409);scopes.push(adopted);}
  return scopes;
}

export async function assertWorldUsageScopesCurrent(db:PoolClient,bookId:string,frozen:WorldUsageCreativeScope[]){const current=worldUsageCreativeScopes(await readActiveWorldUsageScopes(db,bookId));if(current.length!==frozen.length||current.some((scope,index)=>scope.rootCardId!==frozen[index]?.rootCardId||scope.adoptionId!==frozen[index]?.adoptionId||scope.sourceHash!==frozen[index]?.sourceHash||stableHash(scope)!==stableHash(frozen[index])))throw new NewDesignError('正式世界使用范围的采用版本已变化，原候选保留但不能直接采用；请重新核对来源。',409);}
export const getActiveWorldUsageCreativeScopes=(bookId:string)=>read(async db=>worldUsageCreativeScopes(await readActiveWorldUsageScopes(db,bookId)));
