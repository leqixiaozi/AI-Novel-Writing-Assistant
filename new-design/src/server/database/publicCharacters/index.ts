import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {PUBLIC_CHARACTER_ROUTE,publicCharacterTrialSchema,publicDialogueOutputSchema,publicPortraitCommandSchema,type PublicCharacterWorkspace,type PublicCharacterTrialInput,type PublicPortraitReceipt,type PublicPortraitOutput} from '../../../common/publicCharacters';
import {imageReplySchema,type ImageGenerationReply} from '../../../common/imageGeneration';
import {getCharacterImportCatalog} from '../characterImport';
import {getManagedImageConnectionCatalog} from '../modelManagement/imageGeneration';
import {stableHash} from '../aiContracts';
import {NewDesignError,assertFound} from '../../domain/errors';
import {persistVisualBytes,readVisualBytes,decodeVisualUpload} from '../visualAssets/files';
import {readImageReply,readPublicDialogueReply,type PublicDialogueReplyReferences,type ImageReplyReferences} from '../../ai/imageGeneration/receipts';
import {transaction,readSource,readTrial,receipt,capability,requireOperational,finish,PublicCharacterError,type TrialRow} from './repository';
import {freezeTrial,type PublicTrialPlan} from './freeze';
export {PublicCharacterError};
const uuid=z.string().uuid();
export const imageReplyRefs=(row:TrialRow):ImageReplyReferences=>({scopeKind:'public_character',resourceId:row.resource_id,resourceVersionId:row.resource_version_id,requestId:row.id,attemptId:row.attempt_id,inputHash:String(row.frozen_plan.inputHash)});
export const dialogueReplyRefs=(row:TrialRow):PublicDialogueReplyReferences=>({scopeKind:'public_character_dialogue',resourceId:row.resource_id,resourceVersionId:row.resource_version_id,requestId:row.id,attemptId:row.attempt_id,inputHash:String(row.frozen_plan.inputHash)});
async function replyFor(row:TrialRow){return row.reply??(row.input_payload.kind==='portrait'?await readImageReply(imageReplyRefs(row)):(await readPublicDialogueReply(dialogueReplyRefs(row)))?.output??null);}
async function present(row:TrialRow){const saved=await replyFor(row);return{...receipt(row),canCompleteSaved:row.status==='running'&&saved!==null,canEndExpired:row.status==='running'&&saved===null&&row.expired===true};}
export const getPublicCharacterTrialByKey=(key:string)=>transaction(uuid.parse(key),async client=>{const row=await readTrial(client,key,true);return row?present(row):null;});
export const getPublicCharacterTrial=(id:string)=>transaction(undefined,async client=>present(assertFound(await readTrial(client,uuid.parse(id)),'公共角色原试用请求不存在。')));
export async function preparePublicCharacterTrial(raw:unknown){
 const input=publicCharacterTrialSchema.parse(raw),requestHash=stableHash(input);
 return transaction(input.requestKey,async(client,markAbsent)=>{
  const prior=await readTrial(client,input.requestKey,true);if(prior){if(prior.request_hash!==requestHash)throw new NewDesignError('同一原凭证不能用于不同角色或试用输入。',409);return{claimed:false as const,trial:await present(prior)};}
  if((await client.query("SELECT id FROM new_design.ai_tasks WHERE space_id='60000000-0000-4000-8000-000000000001' AND request_idempotency_key=$1",[input.requestKey])).rowCount)throw new NewDesignError('原运行已存在但回执尚不可读，不再次调用模型。',409);
  markAbsent();await requireOperational(client);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`public-character-source:${input.resourceId}`]);
  if((await client.query("SELECT id FROM new_design.public_character_trials WHERE resource_id=$1 AND status='running' LIMIT 1",[input.resourceId])).rowCount)throw new NewDesignError('此公共角色有试用结果待核对，请先完成原请求。',409);
  const source=await readSource(client,input.resourceId,input.resourceVersionId);if(source.hash!==input.sourceHash)throw new NewDesignError('公共角色确切来源已变化，保留填写重新核对。',409);
  const id=randomUUID(),stepId=randomUUID(),attemptId=randomUUID(),plan=await freezeTrial(client,id,input,source),lease=randomUUID(),group=input.kind==='dialogue'?'character_dialogue':'image_generation';
  await client.query(`INSERT INTO new_design.ai_tasks(id,space_id,book_id,task_key,task_contract_version_id,source_route,source_kind,source_id,request_idempotency_key,request_hash,status,current_step_key,created_by)
   VALUES($1,'60000000-0000-4000-8000-000000000001',NULL,$2,$3,$4,'public_character_trial',$1,$5,$6,'running','public_character_trial','public_characters')`,[id,`public_character_${id}`,plan.contractVersionId,`${PUBLIC_CHARACTER_ROUTE}?resource=${source.id}&version=${source.versionId}`,input.requestKey,requestHash]);
  await client.query(`INSERT INTO new_design.ai_task_steps(id,task_id,step_key,sort_order,status,max_attempts,lease_owner,lease_token,lease_expires_at,heartbeat_at) VALUES($1,$2,'public_character_trial',0,'running',1,'public_characters',$3,now()+($4::int*interval '1 millisecond'),now())`,[stepId,id,lease,plan.timeoutMs+60000]);
  await client.query(`INSERT INTO new_design.ai_task_attempts(id,task_id,step_id,attempt_number,trigger_kind,status,task_contract_version_id,prompt_recipe_version_id,context_manifest_id,model_route_snapshot_id,input_hash,output_schema_version,lease_token_digest,started_at)
   VALUES($1,$2,$3,1,'initial','running',$4,$5,$6,$7,$8,$9,$10,now())`,[attemptId,id,stepId,plan.contractVersionId,plan.recipeVersionId,plan.manifestId,plan.snapshotId,plan.inputHash,plan.outputSchemaVersion,stableHash(lease)]);
  await client.query('UPDATE new_design.ai_task_steps SET current_attempt_id=$2 WHERE id=$1',[stepId,attemptId]);
  await client.query(`INSERT INTO new_design.public_character_trials(id,request_key,request_hash,resource_id,resource_version_id,input_payload,source_snapshot,frozen_plan,step_id,attempt_id,request_state) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,'sending')`,[id,input.requestKey,requestHash,source.id,source.versionId,JSON.stringify(input),JSON.stringify(source),JSON.stringify(plan),stepId,attemptId]);
  for(const kind of ['task','step','attempt']as const)await client.query(`INSERT INTO new_design.ai_task_state_events(id,task_id,step_id,attempt_id,entity_kind,from_status,to_status,reason_code,reason_detail,actor_kind,actor) VALUES($1,$2,$3,$4,$5,NULL,'running','public_character_claim','公共角色单次试用领取；提交回执未知不重新调用','worker','public_characters')`,[randomUUID(),id,kind==='task'?null:stepId,kind==='attempt'?attemptId:null,kind]);
  const row=assertFound(await readTrial(client,id),'原试用领取未读取。');return{claimed:true as const,trial:receipt(row),plan,attemptId,group};
 });
}
export async function retainPublicCharacterReply(id:string,reply:unknown,execution:Record<string,unknown>){
 const original=await getPublicCharacterTrial(id);return transaction(original.requestKey,async client=>{
  const row=assertFound(await readTrial(client,id,false,true),'原试用请求不存在。');if(row.status!=='running')throw new NewDesignError('原领取已结束，迟到回复保留为证据，不覆盖已结束结果。',409);
  if(row.input_payload.kind==='dialogue'){const output=publicDialogueOutputSchema.parse(reply);if(output.resourceId!==row.resource_id||output.resourceVersionId!==row.resource_version_id)throw new NewDesignError('试聊回复不是原角色固定版本。',422);}else imageReplySchema.parse(reply);
  if(row.reply!==null){if(stableHash(row.reply)!==stableHash(reply)||stableHash(row.execution)!==stableHash(execution))throw new NewDesignError('原已保存回复不同，不覆盖。',409);return receipt(row);}
  await client.query("UPDATE new_design.public_character_trials SET reply=$2::jsonb,execution=$3::jsonb,request_state='completed' WHERE id=$1",[id,JSON.stringify(reply),JSON.stringify(execution)]);return receipt({...row,reply,execution,request_state:'completed'});
 });
}
async function portraitContent(client:PoolClient,row:TrialRow,reply:ImageGenerationReply):Promise<PublicPortraitOutput>{
 if(row.input_payload.kind!=='portrait')throw new NewDesignError('不是公共角色图片请求。',422);
 const input=row.input_payload,file=decodeVisualUpload({mimeType:reply.mimeType,base64:reply.base64});
 if(file.checksum!==reply.checksum||file.byteSize!==reply.byteSize)throw new NewDesignError('原图片内容与保存回复摘要不一致。',409);
 await persistVisualBytes(file);await readVisualBytes(file.locator,file.checksum,file.byteSize,file.mimeType);
 let content=(await client.query('SELECT * FROM new_design.asset_content_objects WHERE checksum=$1 AND byte_size=$2',[file.checksum,file.byteSize])).rows[0];
 if(content&&(content.storage_provider!=='local'||!['visual-assets/'+file.locator,file.locator].includes(content.storage_locator)||content.mime_type!==file.mimeType))throw new NewDesignError('相同图片内容已有不同受控引用，原回复保留，请核对内容存储。',409);
 if(!content)content=(await client.query(`INSERT INTO new_design.asset_content_objects(id,checksum,byte_size,mime_type,storage_kind,storage_provider,storage_locator,integrity_state,last_verified_at,created_by) VALUES($1,$2,$3,$4,'managed_file','local',$5,'verified',now(),'public_characters') ON CONFLICT(checksum_algorithm,checksum,byte_size) DO NOTHING RETURNING *`,[randomUUID(),file.checksum,file.byteSize,file.mimeType,'visual-assets/'+file.locator])).rows[0]??(await client.query('SELECT * FROM new_design.asset_content_objects WHERE checksum=$1 AND byte_size=$2',[file.checksum,file.byteSize])).rows[0];
 if(!content||content.storage_provider!=='local'||!['visual-assets/'+file.locator,file.locator].includes(content.storage_locator)||content.mime_type!==file.mimeType)throw new NewDesignError('公共角色图片受控存储引用未确认，原回复保留。',409);
 return{contentObjectId:String(content.id),checksum:file.checksum,byteSize:file.byteSize,mimeType:reply.mimeType,title:input.title,description:input.description};
}
export async function completePublicCharacterTrial(id:string){
 const initial=await getPublicCharacterTrial(uuid.parse(id));return transaction(initial.requestKey,async client=>{
  let row=assertFound(await readTrial(client,id,false,true),'原试用请求不存在。');if(row.status==='succeeded')return receipt(row);if(row.status!=='running')throw new NewDesignError('原试用已结束，不重调模型或覆盖历史。',409);
  const reply=await replyFor(row);if(reply===null)throw new NewDesignError('原回复尚未读取，保留原请求只读核对。',409);
  if(row.reply===null&&row.input_payload.kind==='dialogue'){const saved=assertFound(await readPublicDialogueReply(dialogueReplyRefs(row)),'原试聊回复凭证未读取。');if(saved.output.resourceId!==row.resource_id||saved.output.resourceVersionId!==row.resource_version_id)throw new NewDesignError('原试聊回复不是此固定版本。',409);await client.query("UPDATE new_design.public_character_trials SET reply=$2::jsonb,execution=$3::jsonb,request_state='completed' WHERE id=$1",[id,JSON.stringify(saved.output),JSON.stringify(saved.execution)]);row={...row,reply:saved.output,execution:saved.execution,request_state:'completed'};}
  if(row.reply===null){const image=imageReplySchema.parse(reply),plan=row.frozen_plan as unknown as PublicTrialPlan,connection=assertFound(plan.connection,'原专属图片连接未读取。'),execution={provider:connection.provider,model:connection.model,routeSnapshotId:plan.snapshotId,routeSnapshotHash:plan.snapshotHash,inputTokens:image.inputTokens,outputTokens:image.outputTokens,durationMs:image.durationMs,attempts:[{status:'succeeded',requestSent:true,responseReceived:true}]};await client.query("UPDATE new_design.public_character_trials SET reply=$2::jsonb,execution=$3::jsonb,request_state='completed' WHERE id=$1",[id,JSON.stringify(image),JSON.stringify(execution)]);row={...row,reply:image,execution,request_state:'completed'};}
  const output=row.input_payload.kind==='dialogue'?publicDialogueOutputSchema.parse(reply):await portraitContent(client,row,imageReplySchema.parse(reply));
  await finish(client,row,'succeeded',output,'固定角色版本的试用结果已保存；档案、书籍及正式事实保持独立。');if(row.input_payload.kind==='portrait'&&(await capability(client)).operational)await ensurePublicPrimary(client,row.resource_id,row.id,row.request_key);return receipt({...row,status:'succeeded',output,summary:'试用结果已保存，供作者审阅。'});
 });
}
export async function recordPublicCharacterFailure(id:string,execution:Record<string,unknown>|null,received:boolean,notSent:boolean){
 const initial=await getPublicCharacterTrial(id);return transaction(initial.requestKey,async client=>{const row=assertFound(await readTrial(client,id,false,true),'原请求不存在。');if(row.status!=='running'||row.reply!==null)return present(row);const summary=received?'原回复未符合试用合同；已有角色与人工填写保留。':notSent?'本次模型请求未发送；原填写保留。':'原模型调用结果未知；只读核对原请求，不重新调用。',state=received?'completed':notSent?'not_sent':'sent_unknown';await client.query('UPDATE new_design.public_character_trials SET execution=$2::jsonb,request_state=$3,summary=$4 WHERE id=$1',[id,JSON.stringify(execution),state,summary]);if(received||notSent)await finish(client,{...row,execution,request_state:state},'failed',null,summary);return present(assertFound(await readTrial(client,id),'原结果未读取。'));});
}
export async function endExpiredPublicCharacterTrial(id:string){const initial=await getPublicCharacterTrial(uuid.parse(id));return transaction(initial.requestKey,async client=>{const row=assertFound(await readTrial(client,id,false,true),'原请求不存在。');if(row.status==='ended_unknown')return receipt(row);if(row.status!=='running'||!row.expired||await replyFor(row)!==null)throw new NewDesignError('原领取未过期或已有回复，请先核对或保存原结果。',409);await finish(client,row,'ended_unknown',null,'作者明确结束过期未知领取；原请求与未知用量保留，不重调模型。');return receipt({...row,status:'ended_unknown',summary:'过期未知领取已明确结束。'});});}
async function readPortraitImage(client:PoolClient,id:string){const row=assertFound(await readTrial(client,uuid.parse(id)),'原图片请求不存在。');if(row.input_payload.kind!=='portrait'||row.status!=='succeeded'||!row.output)throw new NewDesignError('请选择原已保存的公共角色图片。',404);const output=row.output as PublicPortraitOutput,content=assertFound((await client.query("SELECT * FROM new_design.asset_content_objects WHERE id=$1 AND storage_kind='managed_file' AND storage_provider='local'",[output.contentObjectId])).rows[0],'原受控图片内容不存在。');if(content.checksum!==output.checksum||Number(content.byte_size)!==output.byteSize||content.mime_type!==output.mimeType)throw new NewDesignError('原图片内容引用与历史结果不一致。',409);return{bytes:await readVisualBytes(String(content.storage_locator).replace(/^visual-assets\//,''),output.checksum,output.byteSize,output.mimeType),mimeType:output.mimeType,checksum:output.checksum};}
export const getPublicPortraitImage=(id:string)=>transaction(undefined,client=>readPortraitImage(client,id));
export const getPublicPortraitReceipt=(key:string)=>transaction(uuid.parse(key),async client=>{if((await client.query("SELECT to_regclass('new_design.public_character_portrait_events') IS NOT NULL present")).rows[0].present!==true)return null;const row=(await client.query('SELECT id,input_payload FROM new_design.public_character_portrait_events WHERE request_key=$1',[key])).rows[0];return row?{id:String(row.id),input:row.input_payload,repeated:true} as PublicPortraitReceipt:null;});
export async function executePublicPortraitCommand(raw:unknown){const input=publicPortraitCommandSchema.parse(raw);return transaction(input.requestKey,async(client,markAbsent)=>{
 const installed=(await client.query("SELECT to_regclass('new_design.public_character_portrait_events') IS NOT NULL present")).rows[0].present===true;if(!installed){markAbsent();await requireOperational(client);throw new NewDesignError('公共角色图片历史未安装，原填写保留。',503);}
 const stored=(await client.query('SELECT id,input_payload FROM new_design.public_character_portrait_events WHERE request_key=$1',[input.requestKey])).rows[0];if(stored){if(stableHash(stored.input_payload)!==stableHash(input))throw new NewDesignError('原图片凭证用于不同操作。',409);return{id:String(stored.id),input:stored.input_payload,repeated:true} as PublicPortraitReceipt;}markAbsent();await requireOperational(client);
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`public-character-source:${input.resourceId}`]);
 const latest=(await client.query('SELECT id FROM new_design.public_character_portrait_events WHERE resource_id=$1 ORDER BY sequence DESC LIMIT 1',[input.resourceId])).rows[0]?.id??null;if(latest!==input.expectedLatestEventId)throw new NewDesignError('主图或归档历史已变化，保留当前选择重新核对。',409);
 const trial=assertFound(await readTrial(client,input.trialId),'原图片试用不存在。');if(trial.resource_id!==input.resourceId||trial.input_payload.kind!=='portrait'||trial.status!=='succeeded')throw new NewDesignError('图片不是此公共角色的真实成功结果。',422);
 if((await client.query("SELECT id FROM new_design.public_character_portrait_events WHERE trial_id=$1 AND operation='archive'",[trial.id])).rowCount)throw new NewDesignError('原图片已归档，不能新增主图引用。',409);
 if(input.operation==='primary')await readPortraitImage(client,trial.id);
 const id=randomUUID();await client.query('INSERT INTO new_design.public_character_portrait_events(id,request_key,request_hash,resource_id,trial_id,operation,input_payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[id,input.requestKey,stableHash(input),input.resourceId,input.trialId,input.operation,JSON.stringify(input)]);if(input.operation==='archive')await ensurePublicPrimary(client,input.resourceId,null,input.requestKey);return{id,input,repeated:false};
 });}
async function ensurePublicPrimary(client:PoolClient,resourceId:string,preferred:string|null,key:string){
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`public-character-source:${resourceId}`]);
 if(!(await client.query("SELECT card.id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.id=$1 AND card.status='active' AND type.status='published'",[resourceId])).rowCount)return;
 const events=(await client.query('SELECT id,trial_id,operation FROM new_design.public_character_portrait_events WHERE resource_id=$1 ORDER BY sequence',[resourceId])).rows,archived=new Set<string>();let primary:string|null=null;for(const event of events){if(event.operation==='archive'){archived.add(event.trial_id);if(primary===event.trial_id)primary=null;}else primary=event.trial_id;}if(primary&&!archived.has(primary))return;
 const candidates=(await client.query("SELECT id FROM new_design.public_character_trials trial WHERE resource_id=$1 AND status='succeeded' AND input_payload->>'kind'='portrait' AND NOT EXISTS(SELECT 1 FROM new_design.public_character_portrait_events event WHERE event.trial_id=trial.id AND event.operation='archive') ORDER BY (id=$2) DESC,created_at DESC,id DESC",[resourceId,preferred])).rows;
 for(const candidate of candidates){try{await readPortraitImage(client,candidate.id);}catch(error){if(error instanceof NewDesignError)continue;throw error;}const input={requestKey:randomUUID(),resourceId,trialId:candidate.id,operation:'primary' as const,expectedLatestEventId:events.at(-1)?.id??null};await client.query('INSERT INTO new_design.public_character_portrait_events(id,request_key,request_hash,resource_id,trial_id,operation,input_payload) VALUES($1,$2,$3,$4,$5,\'primary\',$6::jsonb)',[randomUUID(),input.requestKey,stableHash(input),resourceId,candidate.id,JSON.stringify(input)]);return;}
}
export async function getPublicCharacterWorkspace(resourceId?:string,versionId?:string):Promise<PublicCharacterWorkspace>{
 if(Boolean(resourceId)!==Boolean(versionId))throw new NewDesignError('请完整选择公共角色及固定版本。',422);if(resourceId)uuid.parse(resourceId);if(versionId)uuid.parse(versionId);
 const catalog=await getCharacterImportCatalog();return transaction(undefined,async client=>{
  const cap=await capability(client),connections=await getManagedImageConnectionCatalog({client}),source=resourceId&&versionId?await readSource(client,resourceId,versionId,false):null,sourceWritable=source?Boolean((await client.query("SELECT card.id FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.id=$1 AND card.status='active' AND type.status='published'",[source.id])).rowCount):false;
  const trials:PublicCharacterWorkspace['trials']=[],portraits:PublicCharacterWorkspace['portraits']=[];let latestPortraitEventId:string|null=null;
  const tables=(await client.query("SELECT to_regclass('new_design.public_character_trials') IS NOT NULL present")).rows[0].present===true;
  if(source&&tables){const rows=(await client.query('SELECT id FROM new_design.public_character_trials WHERE resource_id=$1 ORDER BY created_at,id LIMIT 101',[source.id])).rows;if(rows.length>100)throw new NewDesignError('此公共角色超过100项试用结果，请通过原请求凭证核对历史，未截断为完整目录。',422);for(const item of rows)trials.push(await present(assertFound(await readTrial(client,String(item.id)),'原试用历史未读取。')));
   const events=(await client.query('SELECT id,trial_id,operation FROM new_design.public_character_portrait_events WHERE resource_id=$1 ORDER BY sequence',[source.id])).rows,archived=new Set<string>();let primary:string|null=null;for(const event of events){latestPortraitEventId=String(event.id);if(event.operation==='archive'){archived.add(String(event.trial_id));if(primary===event.trial_id)primary=null;}else primary=String(event.trial_id);}for(const trial of trials.filter(trial=>trial.input.kind==='portrait'&&trial.status==='succeeded'))portraits.push({trial,primary:trial.id===primary,archived:archived.has(trial.id)});
  }
  return{catalog:catalog.items,catalogTruncated:catalog.truncated,source,sourceWritable,capability:cap,connections:connections.connections,configurationIssue:connections.configurationIssue,trials,portraits,latestPortraitEventId};
 });
}
