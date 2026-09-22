import { randomUUID } from "node:crypto";
import {storyFormatSchema,derivedStorySourceSchema} from '../../common/storyFormat';
import type {PoolClient} from "pg";
import type {
  AiAssistBatch,
  BookCreationMethod,
  BookCreationReviewCard,
  BookCreationSession,
  BookDirectionCandidate,
  CardSummary,
  FieldDefinition,
  InitialCardDraft,
  InspirationCandidate,
  ResearchPrefillCard,
} from "../../common/contracts";
import type { AiSchemaType } from "../ai/gateway";
import {creationDirectorState} from "../../common/creationDirector";
import { NewDesignError, assertFound } from "../domain/errors";
import {getCreationPool as getNewDesignPool,BookCreationProductionError,lockCreationSession,updateCreationSession,createGenerationBatch,updateGenerationBatch,creationTransaction,appendCreationReceipt} from "./bookCreationProduction/repository";
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard} from './recordCards';
import {saveBookCreationReviewCommand,completeBookCreationCommand} from "./bookCreationProduction/commands";
import { getStrategyResourceDrafts } from "./resourceStore";
import type {TemplatePayload} from "./templateStore";
import { persistSessionResearchSelections, previewResearchReuse } from "./referencePackStore";
import {stableHash} from "./aiContracts/integrity";
import type {BookCreationProductionReceipt} from "../../common/bookCreationProduction";

function strategyResourceIds(payload: Record<string, unknown>): string[] {
  return Array.isArray(payload.strategyResourceIds)
    ? payload.strategyResourceIds.filter((value): value is string => typeof value === "string")
    : [];
}

function reviewCard(card:InitialCardDraft,sourceKind:BookCreationReviewCard["sourceKind"],sourceId:string|null=null,sourceVersionId:string|null=null):BookCreationReviewCard{return{id:randomUUID(),typeKey:card.typeKey,title:card.title,values:structuredClone(card.values),sourceKind,sourceId,sourceVersionId,originalTitle:card.title,originalValues:structuredClone(card.values)};}
function blank(value:unknown):boolean{return value===null||value===undefined||value===""||Array.isArray(value)&&value.length===0;}
function mergeReviewCards(groups:BookCreationReviewCard[][]):BookCreationReviewCard[]{const merged=new Map<string,BookCreationReviewCard>();for(const group of groups)for(const card of group){const key=`${card.typeKey}\u0000${card.title}`,existing=merged.get(key);if(!existing){merged.set(key,card);continue;}const values={...existing.values},originalValues={...existing.originalValues};for(const [fieldKey,value] of Object.entries(card.values))if(blank(values[fieldKey])){values[fieldKey]=value;originalValues[fieldKey]=value;}merged.set(key,{...existing,values,originalValues});}return[...merged.values()];}
async function prepareBaseReviewCards(payload:TemplatePayload,method:BookCreationMethod,inputPayload:Record<string,unknown>,researchCards:ResearchPrefillCard[]):Promise<BookCreationReviewCard[]>{
  const template=method==="template"?payload.seedCards.map(card=>reviewCard(card,"template",card.sourceId,null)):[];
  const resources=(await getStrategyResourceDrafts(strategyResourceIds(inputPayload))).map(card=>reviewCard(card,"resource",card.sourceCardId,card.sourceVersionId));
  const research=researchCards.map(card=>reviewCard(card,"research",card.researchVersionId,card.researchVersionId));
  return mergeReviewCards([template,resources,research]);
}

function asDate(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function mapSession(row: Record<string, unknown>): BookCreationSession {
  return {
    id: String(row.id),
    method: row.method as BookCreationMethod,
    status: row.status as BookCreationSession["status"],
    stage: String(row.stage),
    progress: Number(row.progress),
    templateVersionId: String(row.template_version_id),
    bookName: String(row.book_name ?? ""),
    description: String(row.description ?? ""),
    sourceReference: String(row.source_reference ?? ""),
    inputPayload: row.input_payload as Record<string, unknown>,
    researchVersionIds: [],
    researchPackVersionIds: [],
    researchPreview: null,
    directionCandidates: row.direction_candidates as BookDirectionCandidate[],
    selectedDirectionId: row.selected_direction_id ? String(row.selected_direction_id) : null,
    initialCards: row.initial_cards as InitialCardDraft[],
    reviewCards: (row.review_cards??[]) as BookCreationReviewCard[],
    formalReview:row.formal_review as BookCreationSession["formalReview"]??null,
    reviewTypes: [],
    lastFailedStage: row.last_failed_stage ? String(row.last_failed_stage) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    bookId: row.book_id ? String(row.book_id) : null,
    revision: Number(row.revision),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export async function readBookCreationSessionInTransaction(client:PoolClient,id:string):Promise<BookCreationSession>{
 const row=assertFound(await findRecordCard(client,id,'book_creation_session'),"开书流程不存在。"),session=mapSession(row);
 const version=assertFound(await findRecordCard(client,session.templateVersionId,'template_group_version'),"开书模板版本不存在。"),payload=version.payload as TemplatePayload;
 const selections=(await listRecordCards(client,'book_creation_research_selection',{where:{session_id:id}})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order));
 const preview=selections[0]?.compiled_snapshot as NonNullable<BookCreationSession["researchPreview"]>|undefined;
 return{...session,researchVersionIds:preview?.researchVersionIds??[],researchPackVersionIds:preview?.packVersionIds??[],researchPreview:preview??null,reviewTypes:payload.cardTypes.map(type=>({key:type.key,name:type.name,description:type.description,fields:type.fields}))};
}

function mapBatch(row: Record<string, unknown>): AiAssistBatch {
  return {
    id: String(row.id),
    bookId: String(row.book_id),
    cardId: String(row.card_id),
    formKey: String(row.form_key ?? ""),
    status: row.status as AiAssistBatch["status"],
    stage: String(row.stage),
    progress: Number(row.progress),
    instruction: String(row.instruction ?? ""),
    suggestions: row.output_payload as Record<string, unknown>,
    baseRevision: Number(row.base_revision),
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export async function listInspirationCandidates(): Promise<InspirationCandidate[]> {
  const result=(await listRecordCards(await getNewDesignPool(),'inspiration_candidate',{where:{status:'active'}})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order));
  return result.map((row) => ({
    id: String(row.id), title: String(row.title), premise: String(row.premise), audience: String(row.audience),
    tone: row.tone as string[], sortOrder: Number(row.sort_order),
  }));
}

export async function createBookCreationSession(input: {
  method: BookCreationMethod;
  templateVersionId: string;
  bookName: string;
  description: string;
  sourceReference: string;
  inputPayload: Record<string, unknown>;
  researchVersionIds?: string[];
  researchPackVersionIds?: string[];
  requestKey?:string;
}): Promise<BookCreationSession> {
  const pool = await getNewDesignPool();
  const safePayload={...input.inputPayload};delete safePayload.creationDirector;if(safePayload.storyFormat!==undefined){const format=storyFormatSchema.safeParse(safePayload.storyFormat);if(!format.success)throw new NewDesignError('请核对作品形式和目标字数。',422,{storyFormat:format.error.issues[0]?.message??'作品形式无效。'});safePayload.storyFormat=format.data;}input={...input,inputPayload:safePayload};
  if(input.inputPayload.derivedSource!==undefined){const source=derivedStorySourceSchema.safeParse(input.inputPayload.derivedSource);if(!source.success)throw new NewDesignError('短篇来源凭证不完整，请返回原作品重新选择。',422,{derivedSource:'来源需包含原书、正文档案、版本与哈希。'});input.inputPayload.derivedSource=source.data;}
  const version=await findRecordCard(pool,input.templateVersionId,'template_group_version');
  if (!version) throw new NewDesignError("所选模板版本不存在。", 404);
  if(input.requestKey&&(input.requestKey.length<8||input.requestKey.length>160))throw new NewDesignError("开书原请求标识无效。",422);
  const id = randomUUID(),preview=input.researchVersionIds?.length||input.researchPackVersionIds?.length?await previewResearchReuse({templateVersionId:input.templateVersionId,researchVersionIds:input.researchVersionIds??[],packVersionIds:input.researchPackVersionIds??[],includeTemplateSeed:input.method==="template"}):{researchVersionIds:[],packVersionIds:[],compiledSnapshot:{sources:[],packs:[]},suggestedCards:[],conflicts:[]},reviewCards=await prepareBaseReviewCards(version.payload as TemplatePayload,input.method,input.inputPayload,preview.suggestedCards),directReview=input.method==="blank"||input.method==="template",client=await pool.connect(),requestHash=stableHash(JSON.parse(JSON.stringify(input)));let committing=false;
  try{await client.query("BEGIN");if(input.requestKey){await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`book_creation_create:${input.requestKey}`]);const prior=(await listRecordCards(client,'book_creation_session',{where:{creation_request_key:input.requestKey}}))[0];if(prior){if(prior.creation_request_hash!==requestHash)throw new NewDesignError("原开书请求已用于不同输入，请核对原流程。",409);const session=await readBookCreationSessionInTransaction(client,String(prior.id));committing=true;await client.query("COMMIT");return session;}}
    if(input.inputPayload.derivedSource){const source=derivedStorySourceSchema.parse(input.inputPayload.derivedSource),original=(await client.query("SELECT body.content,body.content_hash FROM new_design.chapter_documents document JOIN new_design.books book ON book.id=document.book_id JOIN new_design.chapter_body_versions body ON body.id=document.adopted_version_id AND body.chapter_document_id=document.id WHERE document.book_id=$1 AND document.id=$2 AND body.id=$3 AND document.status='active' AND book.status='active' FOR SHARE OF document,book,body",[source.bookId,source.documentId,source.bodyVersionId])).rows[0];if(!original||original.content_hash!==source.contentHash||original.content!==input.inputPayload.sourceMaterial)throw new NewDesignError('原采用短篇已变化或来源不匹配；本次未创建派生作品，请保留输入回原短篇核对。',409,{derivedSource:'核对原采用正文版本。'});}
    const now=new Date().toISOString();
    await createRecordCard(client,{id,spaceId:'00000000-0000-4000-8000-000000000001',typeKey:'book_creation_session',title:input.bookName||'开书准备',values:{id,method:input.method,template_version_id:input.templateVersionId,book_name:input.bookName,description:input.description,source_reference:input.sourceReference,input_payload:input.inputPayload,status:directReview?'review':'draft',stage:directReview?'review_initial_content':'draft',progress:directReview?82:0,review_cards:reviewCards,direction_candidates:[],selected_direction_id:null,initial_cards:[],formal_review:null,production_receipts:[],creation_request_key:input.requestKey??null,creation_request_hash:input.requestKey?requestHash:null,book_id:null,last_failed_stage:null,error_message:null,revision:1,created_at:now,updated_at:now}});
    await persistSessionResearchSelections(client,id,preview);
    const session=await readBookCreationSessionInTransaction(client,id);if(input.requestKey){const receipt:BookCreationProductionReceipt={sessionId:id,requestKey:input.requestKey,operation:"create_session",repeated:false,session};await appendCreationReceipt(client,id,requestHash,receipt);}committing=true;await client.query("COMMIT");return session;
  }catch(error){let rollback=false;try{await client.query("ROLLBACK");rollback=true;}catch{}if(rollback&&!committing)throw new BookCreationProductionError(null,error instanceof NewDesignError?error.message:"开书流程未创建，服务器已确认回滚；请保留输入，修复服务后明确重新准备。",error instanceof NewDesignError?error.status:503,"not_written",error instanceof NewDesignError?error.issues:undefined,"创建开书流程");throw new BookCreationProductionError(null,"新开书流程结果尚未确认，请保留原请求标识并只读核对，不重复创建。",503);}finally{client.release();}
}

export async function getBookCreationSession(id: string): Promise<BookCreationSession> {
  const client=await(await getNewDesignPool()).connect();try{await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");const session=await readBookCreationSessionInTransaction(client,id);await client.query("COMMIT");return session;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function getSessionAiContext(id: string): Promise<{ session: BookCreationSession; sourceText: string; schemaTypes: AiSchemaType[] }> {
  const pool = await getNewDesignPool();
  const session = await getBookCreationSession(id);
  const version=assertFound(await findRecordCard(pool,session.templateVersionId,'template_group_version'),"模板版本不存在。");
  const payload = version.payload as TemplatePayload;
  const strategies = await getStrategyResourceDrafts(strategyResourceIds(session.inputPayload));
  const sourceText = [
    session.bookName ? `作品名称：${session.bookName}` : "",
    session.description,
    ...Object.values(session.inputPayload).filter((value): value is string => typeof value === "string"),
    strategies.length ? `选定创作策略：${JSON.stringify(strategies.map(({ typeKey, title, values }) => ({ typeKey, title, values })))}` : "",
    session.researchPreview ? `选定研究资料（只作为参考并保持来源边界）：${JSON.stringify(session.researchPreview.compiledSnapshot)}` : "",
    session.reviewCards.length ? `作者当前开书表单（以当前修改为基础继续完善）：${JSON.stringify(session.reviewCards.map(({typeKey,title,values})=>({typeKey,title,values})))}` : "",
  ].filter(Boolean).join("\n");
  return {
    session,
    sourceText,
    schemaTypes: payload.cardTypes.map((type) => ({ key: type.key, name: type.name, description: type.description, fields: type.fields })),
  };
}

export async function beginSessionGeneration(id: string, operation: "directions" | "initial_content"): Promise<string> {
  const pool = await getNewDesignPool();
  const session = await getBookCreationSession(id);
  if (["generating","completed","creating"].includes(session.status)) throw new NewDesignError("这次开书正在处理，请等待当前步骤完成。", 409);
  if(creationDirectorState(session.inputPayload))throw new NewDesignError("请从开书导演继续准备当前阶段，或切换为人工编辑。",409);
  const batchId = randomUUID();
  const stage = operation === "directions" ? "understand_source" : "map_template_fields";
  const progress = operation === "directions" ? 18 : 52;
  const client=await pool.connect();
  try{await client.query("BEGIN");const current=await lockCreationSession(client,id);
    if(current.revision!==session.revision||['generating','creating','completed'].includes(current.status))throw new NewDesignError("开书流程已更新，请等待当前步骤完成。",409);
    await updateCreationSession(client,current,{status:'generating',stage,progress,error_message:null,last_failed_stage:null});
    await createGenerationBatch(client,current.recordSpaceId,{id:batchId,session_id:id,operation,status:'running',stage,progress,input_payload:session.inputPayload,prompt_id:operation==='directions'?'new_design.book_creation.directions':'new_design.book_creation.initial_content',prompt_version:'v1'});
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return batchId;
}

async function saveSessionGeneration(sessionId:string,batchId:string,batchPatch:Record<string,unknown>,sessionPatch:Record<string,unknown>):Promise<void>{
  await creationTransaction(async client=>{
    const session=await lockCreationSession(client,sessionId);
    const batch=assertFound(await findRecordCard(client,batchId,'ai_generation_batch',{lock:true}),"开书 AI 批次不存在。");
    if(batch.session_id!==sessionId)throw new NewDesignError("AI 批次不属于当前开书流程。",409);
    await updateGenerationBatch(client,batchId,batchPatch);
    await updateCreationSession(client,session,sessionPatch);
  });
}

export async function saveDirectionCandidates(sessionId:string,batchId:string,candidates:BookDirectionCandidate[]):Promise<BookCreationSession>{
  await saveSessionGeneration(sessionId,batchId,{status:'review',stage:'direction_confirmation',progress:100,output_payload:{candidates},completed_at:new Date().toISOString()},{status:'waiting_direction',stage:'direction_confirmation',progress:40,direction_candidates:candidates,error_message:null});
  return getBookCreationSession(sessionId);
}
export async function selectBookDirection(sessionId:string,directionId:string):Promise<BookCreationSession>{
  await creationTransaction(async client=>{
    const session=await lockCreationSession(client,sessionId);
    if(session.status!=='waiting_direction')throw new NewDesignError("请等待方向准备完成后再选择。",409);
    if(!(session.direction_candidates as BookDirectionCandidate[]).some(item=>item.id===directionId))throw new NewDesignError("请选择有效的创作方向。",422);
    await updateCreationSession(client,session,{selected_direction_id:directionId,status:'draft',stage:'direction_selected',progress:45});
  });
  return getBookCreationSession(sessionId);
}
export async function saveInitialCards(sessionId:string,batchId:string,cards:InitialCardDraft[]):Promise<BookCreationSession>{
  const session=await getBookCreationSession(sessionId),version=assertFound(await findRecordCard(await getNewDesignPool(),session.templateVersionId,'template_group_version'),"开书模板版本不存在。");
  const base=await prepareBaseReviewCards(version.payload as TemplatePayload,session.method,session.inputPayload,session.researchPreview?.suggestedCards??[]);
  const aiCards=cards.map(card=>reviewCard(card,'ai')),reviewCards=mergeReviewCards([aiCards,base]),selected=session.directionCandidates.find(item=>item.id===session.selectedDirectionId);
  await saveSessionGeneration(sessionId,batchId,{status:'review',stage:'review_initial_content',progress:100,output_payload:{cards},completed_at:new Date().toISOString()},{
    status:'review',stage:'review_initial_content',progress:82,book_name:session.bookName.trim()||selected?.title||'',description:session.description.trim()||selected?.premise||'',initial_cards:cards,review_cards:reviewCards,error_message:null,
  });
  return getBookCreationSession(sessionId);
}

export async function saveBookCreationReview(sessionId:string,input:{bookName:string;description:string;reviewCards:BookCreationReviewCard[];revision:number;requireComplete?:boolean;requestKey?:string}):Promise<BookCreationSession>{if(!input.requestKey)throw new NewDesignError("请保留原保存请求，从统一开书审阅页面提交。",409);return saveBookCreationReviewCommand(sessionId,{...input,requestKey:input.requestKey});}

export async function failSessionGeneration(sessionId:string,batchId:string,stage:string,error:unknown):Promise<void>{
  const message=error instanceof Error?error.message:"AI 服务暂时不可用。";
  await saveSessionGeneration(sessionId,batchId,{status:'failed',stage,error_message:message,completed_at:new Date().toISOString()},{status:'failed',stage,last_failed_stage:stage,error_message:message});
}

export async function completeBookCreation(sessionId:string,options:{keepCurrentResult?:boolean;expectedRevision:number;requestKey?:string}):Promise<BookCreationSession>{if(!options.requestKey)throw new NewDesignError("请保留原创建请求，审阅关系与四层规划后确认开书。",409);return completeBookCreationCommand(sessionId,{...options,requestKey:options.requestKey});}

export {getCreationPool,getCreationPreparationContext,getBookCreationProductionWorkspace,saveBookCreationFormalReview,readBookCreationProductionReceipt,getBookCreationSessionByRequest,saveFormalReviewInputSchema,withBookCreationProductionPool,lockCreationRequest,adoptCreationPreparationInTransaction} from "./bookCreationProduction";

export async function getCardAssistContext(bookId: string, cardId: string): Promise<{ bookName: string; card: CardSummary; fields: FieldDefinition[] }> {
  const pool = await getNewDesignPool();
  const row = assertFound((await pool.query(`SELECT book.name AS book_name,card.*,type.name AS card_type_name,type.draft_fields,version.version AS type_version FROM new_design.books book JOIN new_design.cards card ON card.space_id=book.space_id JOIN new_design.card_types type ON type.id=card.card_type_id JOIN new_design.card_type_versions version ON version.id=card.type_version_id WHERE book.id=$1 AND card.id=$2`, [bookId, cardId])).rows[0], "书籍中的资料不存在。");
  return {
    bookName: String(row.book_name),
    fields: row.draft_fields as FieldDefinition[],
    card: {
      id: String(row.id), cardTypeId: String(row.card_type_id), cardTypeName: String(row.card_type_name), title: String(row.title), status: row.status,
      revision: Number(row.revision), typeVersionId: String(row.type_version_id), typeVersion: Number(row.type_version), values: row.values as Record<string, unknown>,
      createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at), archivedAt: row.archived_at ? asDate(row.archived_at) : null,
    },
  };
}

export async function beginFormAssist(input:{bookId:string;cardId:string;formKey:string;instruction:string;baseRevision:number}):Promise<string>{
  const id=randomUUID();
  await creationTransaction(async client=>{
    const card=assertFound((await client.query('SELECT card.space_id FROM new_design.cards card JOIN new_design.books book ON book.space_id=card.space_id WHERE card.id=$1 AND book.id=$2',[input.cardId,input.bookId])).rows[0],"资料不属于当前书籍。");
    await createGenerationBatch(client,String(card.space_id),{id,book_id:input.bookId,card_id:input.cardId,form_key:input.formKey,operation:'form_assist',status:'running',stage:'understand_form',progress:20,instruction:input.instruction,base_revision:input.baseRevision,prompt_id:'new_design.form.assist',prompt_version:'v1'});
  });return id;
}
export async function saveFormAssist(batchId:string,suggestions:Record<string,unknown>):Promise<AiAssistBatch>{
  return mapBatch(await creationTransaction(client=>updateGenerationBatch(client,batchId,{status:'review',stage:'review_suggestions',progress:100,output_payload:suggestions,completed_at:new Date().toISOString()})));
}
export async function failFormAssist(batchId:string,error:unknown):Promise<void>{
  await creationTransaction(client=>updateGenerationBatch(client,batchId,{status:'failed',stage:'generate_suggestions',error_message:error instanceof Error?error.message:"AI 服务暂时不可用。",completed_at:new Date().toISOString()}));
}

export async function applyFormAssist(batchId: string, fieldKeys: string[], expectedRevision: number): Promise<CardSummary> {
  const pool = await getNewDesignPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batch=assertFound(await findRecordCard(client,batchId,'ai_generation_batch',{lock:true}),"AI 建议批次不存在。");
    if (batch.status !== "review") throw new NewDesignError("这批建议已经处理。", 409);
    const card = assertFound((await client.query("SELECT * FROM new_design.cards WHERE id=$1 FOR UPDATE", [batch.card_id])).rows[0], "资料不存在。");
    if (Number(card.revision) !== expectedRevision || Number(batch.base_revision) !== expectedRevision) throw new NewDesignError("资料已被修改，请重新生成建议，避免覆盖你的内容。", 409);
    const type = assertFound((await client.query("SELECT draft_fields FROM new_design.card_types WHERE id=$1", [card.card_type_id])).rows[0], "资料规格不存在。");
    const allowed = new Set((type.draft_fields as FieldDefinition[]).map((field) => field.key));
    const suggestions = batch.output_payload as Record<string, unknown>;
    const selected = fieldKeys.filter((key) => allowed.has(key) && Object.prototype.hasOwnProperty.call(suggestions, key));
    if (!selected.length) throw new NewDesignError("请至少选择一项 AI 建议。", 422);
    const values = { ...(card.values as Record<string, unknown>) };
    for (const key of selected) values[key] = suggestions[key];
    const nextRevision = Number(card.revision) + 1;
    const versionId = randomUUID();
    await client.query("INSERT INTO new_design.card_versions (id,card_id,revision,type_version_id,title,values,source) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'edit')", [versionId, card.id, nextRevision, card.type_version_id, card.title, JSON.stringify(values)]);
    await client.query("UPDATE new_design.cards SET values=$2::jsonb,revision=$3,current_version_id=$4,updated_at=now() WHERE id=$1", [card.id, JSON.stringify(values), nextRevision, versionId]);
    for(const key of selected){
      const prior=(await listRecordCards(client,'card_field_origin',{where:{card_id:card.id,field_key:key},lock:true}))[0],id=prior?.id??randomUUID(),now=new Date().toISOString();
      const fields={...(prior??{}),id,card_id:card.id,field_key:key,source_kind:'ai',generation_batch_id:batchId,confirmation_status:'confirmed',original_value:suggestions[key],current_value:suggestions[key],updated_at:now};
      if(prior)await replaceRecordCard(client,{id,spaceId:prior.recordSpaceId,typeKey:'card_field_origin',values:fields});
      else await createRecordCard(client,{id,spaceId:String(card.space_id),typeKey:'card_field_origin',title:key,values:{source_id:null,...fields,created_at:now}});
    }
    await updateGenerationBatch(client,batchId,{status:'applied',stage:'applied'});
    await client.query("COMMIT");
    return (await getCardAssistContext(String(batch.book_id), String(card.id))).card;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
