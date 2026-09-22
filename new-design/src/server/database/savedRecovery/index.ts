import {findRecordCard,listRecordCards,requireRecordCard} from '../recordCards';
import type {PoolClient} from 'pg';
import {recoveryTargetSchema,savedRecoveryInputSchema,type RecoveryTarget,type SavedRecoveryItem,type SavedRecoveryWorkspace,type SavedRecoveryOutcome} from '../../../common/savedRecovery';
import {getNewDesignPool} from '../runtime';
import {stableHash} from '../aiContracts';
import {NewDesignError,assertFound} from '../../domain/errors';
import {readImageGenerationResult,completeSavedImageGeneration} from '../imageGeneration';
import {readCharacterAuthorByKey,completeCharacterAuthor} from '../characterAuthor';
import {readImagePreparationByKey,completeImagePreparation} from '../imagePreparation';
import {getPublicCharacterTrialByKey,completePublicCharacterTrial} from '../publicCharacters';
import {readPublicTitleByKey,completePublicTitle} from '../publicTitles';
import {readDialogueRound,dialogueRoundReceipt,completeDialogueOutput} from '../characterDialogue';
import {readWorldRequest,worldReceipt,importWorldConsistencyOutput} from '../worldConsistency';
import {getChapterQualityReceipt,importChapterQualityOutput} from '../chapterQuality';
import {getChapterWritingRequest} from '../chapterWriting';
import {completeSavedChapterWritingRequest} from '../../application/productionDirector';
import {getCreationPreparationResult} from '../creationDirector/preparation';
import {recoverSavedCreationPreparation} from '../creationDirector/results';
import {getKnowledgeEmbeddingRequest,completeKnowledgeEmbeddingReply,getKnowledgeSemanticResult,completeKnowledgeSemanticReply} from '../knowledgeIndex';
const labels:Record<RecoveryTarget['kind'],string>={image_generation:'图片生成',image_prompt_preparation:'图片画面优化',character_author:'人物与作者谈话',public_title_factory:'开书前标题',public_character_trial:'公共角色试用',character_dialogue:'人物对话模拟',world_consistency:'世界一致性检查',chapter_quality:'章节审校',chapter_writing:'章节生成',creation_preparation:'开书候选准备',knowledge_embedding:'知识向量',knowledge_semantic:'知识语义检索'};
async function connection<T>(work:(client:PoolClient)=>Promise<T>){const client=await(await getNewDesignPool()).connect();try{return await work(client);}finally{client.release();}}
export async function inspectSavedRecovery(raw:RecoveryTarget):Promise<SavedRecoveryItem>{const target=recoveryTargetSchema.parse(raw);return connection(async client=>{
 let key='',route='',status='',saved=false,canRecover=false,identity:unknown;
 const book=target.bookId;
 if(['image_generation','image_prompt_preparation','public_character_trial','public_title_factory','character_author'].includes(target.kind)){
  const task=assertFound((await client.query('SELECT * FROM new_design.ai_tasks WHERE id=$1 AND source_kind=$2',[target.id,target.kind])).rows[0],'原恢复任务不存在。');if(task.book_id!==book)throw new NewDesignError('原任务不属于所选来源范围。',409);key=task.request_idempotency_key;route=task.source_route;
  if(target.kind==='image_generation'){const result=await readImageGenerationResult(target.id);status=result.status;saved=result.replySaved;canRecover=result.canCompleteSaved;identity={input:result.input,inputHash:result.inputHash};}
  else if(target.kind==='image_prompt_preparation'){const result=assertFound(await readImagePreparationByKey(key),'原图片优化回执未读取。');status=result.status;saved=result.canCompleteSaved||result.status==='succeeded';canRecover=result.canCompleteSaved;identity={input:result.input,source:result.source};}
  else if(target.kind==='character_author'){const result=assertFound(await readCharacterAuthorByKey(key),'原人物谈话回执未读取。');status=result.status;saved=result.canCompleteSaved||['succeeded','stale'].includes(result.status);canRecover=result.canCompleteSaved;identity={input:result.input,source:result.source};}
  else if(target.kind==='public_title_factory'){const result=assertFound(await readPublicTitleByKey(key),'Original public title receipt unavailable.');status=result.status;saved=result.canCompleteSaved||result.status==='succeeded';canRecover=result.canCompleteSaved;identity={input:result.input,source:result.source};}
  else{const result=assertFound(await getPublicCharacterTrialByKey(key),'原公共角色回执未读取。');status=result.status;saved=result.canCompleteSaved||result.status==='succeeded';canRecover=result.canCompleteSaved;identity={input:result.input,source:result.source};}
 }else if(target.kind==='creation_preparation'){const result=await getCreationPreparationResult(target.id);const row=await requireRecordCard(client,target.id,'ai_generation_batch','原开书批次不存在。');const session=await requireRecordCard(client,row.session_id,'book_creation_session','原开书会话不存在。');if((row.book_id??session.book_id??null)!==book)throw new NewDesignError('原开书批次范围变化。',409);key=row.preparation_request_key;route=`/new-design/books/new?session=${row.session_id}`;status=result.status;saved=result.canRecoverSavedResult||Boolean(result.output);canRecover=result.canRecoverSavedResult;identity=row.frozen_plan;
 }else{if(!book)throw new NewDesignError('此恢复来源必须有真实书籍范围。',422);
  if(target.kind==='character_dialogue'){const row=assertFound(await readDialogueRound(client,book,target.id),'原人物回合不存在。'),result=dialogueRoundReceipt(row);key=result.requestKey;route=`/new-design/books/${book}/character-dialogue?session=${result.sessionId}&round=${target.id}`;status=result.status;saved=result.modelResultSaved;canRecover=result.canCompleteSavedResult;identity={input:result.input,inputHash:result.inputHash};}
  else if(target.kind==='world_consistency'){const row=assertFound(await readWorldRequest(client,book,target.id),'原世界检查不存在。'),result=worldReceipt(row);key=result.requestKey;route=`/new-design/books/${book}/world?check=${target.id}`;status=result.status;saved=result.modelResultSaved;canRecover=result.canImportSavedResult;identity={input:result.input,inputHash:result.inputHash};}
  else if(target.kind==='chapter_quality'){const result=assertFound(await getChapterQualityReceipt(book,target.id),'原章节审校不存在。');key=result.input.requestKey;const document=assertFound((await client.query('SELECT chapter_card_id FROM new_design.chapter_documents WHERE id=$1 AND book_id=$2',[result.input.chapterDocumentId,book])).rows[0],'原章节来源不存在。');route=`/new-design/books/${book}/writing?chapter=${document.chapter_card_id}`;status=result.status;saved=result.modelResultSaved;canRecover=result.status==='running'&&saved&&!result.leaseExpired;identity=result.input;}
  else if(target.kind==='chapter_writing'){const result=await getChapterWritingRequest(target.id);if(result.bookId!==book)throw new NewDesignError('原章节生成不属于本书。',409);key=result.idempotencyKey??target.id;const document=assertFound((await client.query('SELECT chapter_card_id FROM new_design.chapter_documents WHERE id=$1 AND book_id=$2',[result.chapterDocumentId,book])).rows[0],'原章节来源不存在。');route=`/new-design/books/${book}/writing?chapter=${document.chapter_card_id}`;status=result.status;saved=result.modelResultSaved===true;canRecover=result.controlled===true&&saved&&(status==='running'||status==='succeeded'&&result.ledgerPending===true);identity={document:result.chapterDocumentId,inputBodyVersionId:result.inputBodyVersionId,expectedDocumentRevision:result.expectedDocumentRevision};}
  else if(target.kind==='knowledge_embedding'){const result=await getKnowledgeEmbeddingRequest(book,target.id);key=result.requestKey??target.id;route=`/new-design/knowledge?bookId=${book}`;status=result.detail.status;saved=result.replySaved;canRecover=result.canCompleteSavedResult;identity=result.identity;}
  else{const result=await getKnowledgeSemanticResult(book,target.id);key=result.requestKey;route=`/new-design/knowledge?bookId=${book}`;status=result.run.status;saved=result.replySaved;canRecover=result.canCompleteSavedResult;identity={key,runId:result.run.id};}
 }
 if(!/^\/new-design(?:\/|\?|$)/.test(route)||/[\\\r\n]/.test(route)||/%(?:2f|5c|0a|0d)/i.test(route))throw new NewDesignError('原来源链接不能安全定位。',409);
 return{target,requestKey:key,title:labels[target.kind],sourceRoute:route,status,saved,canRecover,fingerprint:stableHash({target,key,identity,status,saved,canRecover}),summary:canRecover?'已找到原保存回复；可明确完成原结果入库，不调用模型。':saved?'原回复保留；此状态需返回来源核对，不能批量恢复。':'原回复未确认；只读核对，不能把未找到当作未调用。'};
 });}
export async function getSavedRecoveryWorkspace(bookId?:string):Promise<SavedRecoveryWorkspace>{const collected=await connection(async client=>{const targets:RecoveryTarget[]=[],unavailable:string[]=[];
 const kinds=['image_generation','image_prompt_preparation','public_character_trial','public_title_factory','character_author','character_dialogue','world_consistency','chapter_quality'];
 const tasks=(await client.query("SELECT source_kind kind,source_id id,book_id FROM new_design.ai_tasks WHERE source_kind=ANY($1::text[]) AND ($2::uuid IS NULL OR book_id=$2) AND status IN ('running','failed','paused') ORDER BY updated_at DESC,id DESC LIMIT 251",[kinds,bookId??null])).rows;for(const task of tasks)if(task.id)targets.push({kind:task.kind,id:task.id,bookId:task.book_id});
 const sources=[{type:'chapter_writing_request',kind:'chapter_writing'},{type:'embedding_request',kind:'knowledge_embedding'}] as const;
 for(const source of sources){
  const present=(await client.query("SELECT EXISTS(SELECT 1 FROM new_design.card_types WHERE type_key=$1 AND status='published') present",[source.type])).rows[0].present;
  if(!present){unavailable.push(`${labels[source.kind]}的受控恢复来源尚未启用。`);continue;}
  const rows=(await listRecordCards(client,source.type,{where:bookId?{book_id:bookId}:{}})).sort((a,b)=>a.id.localeCompare(b.id)),selected:typeof rows=[];
  for(const row of rows){
   if(source.kind==='knowledge_embedding'){if(row.status==='running'&&row.embedding_execution_key)selected.push(row);}
   else if(row.controlled_snapshot&&(row.status==='running'||row.status==='succeeded'&&row.controlled_output&&(await client.query("SELECT 1 FROM new_design.ai_task_steps WHERE task_id=$1 AND step_key='generate_candidate' AND status<>'succeeded'",[row.ai_task_id])).rowCount))selected.push(row);
   if(selected.length===251)break;
  }
  for(const row of selected)targets.push({kind:source.kind,id:row.id,bookId:row.book_id});
 }
 const retrievalPresent=(await client.query("SELECT to_regclass('new_design.retrieval_runs') IS NOT NULL present")).rows[0].present;
 if(retrievalPresent){const rows=(await client.query("SELECT id,book_id FROM new_design.retrieval_runs WHERE status='running' AND embedding_request_key IS NOT NULL AND ($1::uuid IS NULL OR book_id=$1) ORDER BY id LIMIT 251",[bookId??null])).rows;for(const row of rows)targets.push({kind:'knowledge_semantic',id:row.id,bookId:row.book_id});}
 else unavailable.push('知识语义检索的受控恢复来源尚未启用。');
 const batches=(await listRecordCards(client,'ai_generation_batch',{where:{preparation_contract:'creation_preparation_v1',status:'running'}})).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));
 let creationCount=0;
 for(const batch of batches){const session=await findRecordCard(client,batch.session_id,'book_creation_session');if(!session)continue;const owner=batch.book_id??session.book_id??null;if(bookId&&owner!==bookId)continue;targets.push({kind:'creation_preparation',id:batch.id,bookId:owner});if(++creationCount===251)break;}
 return{targets,unavailable};});const items:SavedRecoveryItem[]=[],unavailable=[...collected.unavailable];for(const target of collected.targets.slice(0,250)){try{items.push(await inspectSavedRecovery(target));}catch(error){unavailable.push(`${labels[target.kind]} ${target.id}：${error instanceof NewDesignError?error.message:'原来源未读取，保留原请求。'}`);}}return{items,truncated:collected.targets.length>250,unavailable};}
/** Only original saved-output writers; no model executor, retry, dispatch or adoption is exposed. */
export async function recoverSavedSources(raw:unknown){const input=savedRecoveryInputSchema.parse(raw),outcomes:SavedRecoveryOutcome[]=[];for(const selected of input.items){try{const current=await inspectSavedRecovery(selected.target);if(current.fingerprint!==selected.fingerprint||!current.canRecover)throw new NewDesignError('原来源或恢复资格已变化，请只读重新核对。',409);const {kind,id,bookId}=current.target;
 switch(kind){case'image_generation':await completeSavedImageGeneration(id);break;case'image_prompt_preparation':await completeImagePreparation(id);break;case'character_author':await completeCharacterAuthor(id);break;case'public_character_trial':await completePublicCharacterTrial(id);break;case'public_title_factory':await completePublicTitle(id);break;case'character_dialogue':await completeDialogueOutput(bookId!,id);break;case'world_consistency':await importWorldConsistencyOutput(bookId!,id);break;case'chapter_quality':await importChapterQualityOutput(bookId!,id);break;case'chapter_writing':await completeSavedChapterWritingRequest(id);break;case'creation_preparation':await recoverSavedCreationPreparation(id);break;case'knowledge_embedding':await completeKnowledgeEmbeddingReply(bookId!,id);break;case'knowledge_semantic':await completeKnowledgeSemanticReply(bookId!,id);break;}
 const item=await inspectSavedRecovery(current.target);outcomes.push({target:current.target,item,completed:!item.canRecover&&!['running','queued'].includes(item.status),summary:'原结果保存操作已返回；完成情况以原来源状态为准。'});
 }catch(error){outcomes.push({target:selected.target,item:null,completed:false,summary:error instanceof NewDesignError?error.message:'原保存结果未确认，保留原标识只读核对；不重新调用。'});}}return{requestKey:input.requestKey,outcomes};}
