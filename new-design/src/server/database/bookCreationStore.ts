import { randomUUID } from "node:crypto";
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
import { NewDesignError, assertFound } from "../domain/errors";
import { validateCardValues } from "../domain/validation";
import { normalizeBookCreationReview, validateBookCreationReviewCards } from "../domain/bookCreation";
import { getNewDesignPool } from "./runtime";
import { getStrategyResourceDrafts } from "./resourceStore";
import { createBook, type TemplatePayload } from "./templateStore";
import { getSessionResearchReuse, persistSessionResearchSelections, previewResearchReuse } from "./referencePackStore";

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
    reviewTypes: [],
    lastFailedStage: row.last_failed_stage ? String(row.last_failed_stage) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    bookId: row.book_id ? String(row.book_id) : null,
    revision: Number(row.revision),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
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
  const result = await (await getNewDesignPool()).query("SELECT * FROM new_design.inspiration_candidates WHERE status='active' ORDER BY sort_order");
  return result.rows.map((row) => ({
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
}): Promise<BookCreationSession> {
  const pool = await getNewDesignPool();
  const version = (await pool.query("SELECT payload FROM new_design.template_group_versions WHERE id=$1", [input.templateVersionId])).rows[0];
  if (!version) throw new NewDesignError("所选模板版本不存在。", 404);
  const id = randomUUID(),preview=await previewResearchReuse({templateVersionId:input.templateVersionId,researchVersionIds:input.researchVersionIds??[],packVersionIds:input.researchPackVersionIds??[],includeTemplateSeed:input.method==="template"}),reviewCards=await prepareBaseReviewCards(version.payload as TemplatePayload,input.method,input.inputPayload,preview.suggestedCards),directReview=input.method==="blank"||input.method==="template",client=await pool.connect();
  try{await client.query("BEGIN");await client.query(`INSERT INTO new_design.book_creation_sessions (id,method,template_version_id,book_name,description,source_reference,input_payload,status,stage,progress,review_cards) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb)`, [id, input.method, input.templateVersionId, input.bookName, input.description, input.sourceReference, JSON.stringify(input.inputPayload),directReview?"review":"draft",directReview?"review_initial_content":"draft",directReview?82:0,JSON.stringify(reviewCards)]);await persistSessionResearchSelections(client,id,preview);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return getBookCreationSession(id);
}

export async function getBookCreationSession(id: string): Promise<BookCreationSession> {
  const pool=await getNewDesignPool(),row = (await pool.query("SELECT * FROM new_design.book_creation_sessions WHERE id=$1", [id])).rows[0];
  const session=mapSession(assertFound(row, "开书流程不存在。")),reuse=await getSessionResearchReuse(id),version=assertFound((await pool.query("SELECT payload FROM new_design.template_group_versions WHERE id=$1",[session.templateVersionId])).rows[0],"开书模板版本不存在。"),payload=version.payload as TemplatePayload;return{...session,researchVersionIds:reuse.preview.researchVersionIds,researchPackVersionIds:reuse.preview.packVersionIds,researchPreview:reuse.references.length?reuse.preview:null,reviewTypes:payload.cardTypes.map(type=>({key:type.key,name:type.name,description:type.description,fields:type.fields}))};
}

export async function getSessionAiContext(id: string): Promise<{ session: BookCreationSession; sourceText: string; schemaTypes: AiSchemaType[] }> {
  const pool = await getNewDesignPool();
  const session = await getBookCreationSession(id);
  const version = assertFound((await pool.query("SELECT payload FROM new_design.template_group_versions WHERE id=$1", [session.templateVersionId])).rows[0], "模板版本不存在。");
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
  const batchId = randomUUID();
  const stage = operation === "directions" ? "understand_source" : "map_template_fields";
  const progress = operation === "directions" ? 18 : 52;
  const client=await pool.connect();
  try{await client.query("BEGIN");const claimed=await client.query("UPDATE new_design.book_creation_sessions SET status='generating',stage=$2,progress=$3,error_message=NULL,last_failed_stage=NULL,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$4 AND status NOT IN ('generating','creating','completed') RETURNING id",[id,stage,progress,session.revision]);if(!claimed.rowCount)throw new NewDesignError("开书流程已更新，请等待当前步骤完成。",409);await client.query(`INSERT INTO new_design.ai_generation_batches (id,session_id,operation,status,stage,progress,input_payload,prompt_id,prompt_version) VALUES ($1,$2,$3,'running',$4,$5,$6::jsonb,$7,'v1')`, [batchId, id, operation, stage, progress, JSON.stringify(session.inputPayload), operation === "directions" ? "new_design.book_creation.directions" : "new_design.book_creation.initial_content"]);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return batchId;
}

export async function saveDirectionCandidates(sessionId: string, batchId: string, candidates: BookDirectionCandidate[]): Promise<BookCreationSession> {
  const pool = await getNewDesignPool();
  await pool.query("UPDATE new_design.ai_generation_batches SET status='review',stage='direction_confirmation',progress=100,output_payload=$2::jsonb,completed_at=now(),updated_at=now() WHERE id=$1", [batchId, JSON.stringify({ candidates })]);
  await pool.query("UPDATE new_design.book_creation_sessions SET status='waiting_direction',stage='direction_confirmation',progress=40,direction_candidates=$2::jsonb,error_message=NULL,revision=revision+1,updated_at=now() WHERE id=$1", [sessionId, JSON.stringify(candidates)]);
  return getBookCreationSession(sessionId);
}

export async function selectBookDirection(sessionId: string, directionId: string): Promise<BookCreationSession> {
  const session = await getBookCreationSession(sessionId);
  if(session.status!=="waiting_direction")throw new NewDesignError("请等待方向准备完成后再选择。",409);
  if (!session.directionCandidates.some((item) => item.id === directionId)) throw new NewDesignError("请选择有效的创作方向。", 422);
  const selected=await (await getNewDesignPool()).query("UPDATE new_design.book_creation_sessions SET selected_direction_id=$2,status='draft',stage='direction_selected',progress=45,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$3 AND status='waiting_direction' RETURNING id", [sessionId, directionId,session.revision]);
  if(!selected.rowCount)throw new NewDesignError("开书方向已更新，请刷新后再选择。",409);
  return getBookCreationSession(sessionId);
}

export async function saveInitialCards(sessionId: string, batchId: string, cards: InitialCardDraft[]): Promise<BookCreationSession> {
  const pool = await getNewDesignPool();
  const session=await getBookCreationSession(sessionId),version=assertFound((await pool.query("SELECT payload FROM new_design.template_group_versions WHERE id=$1",[session.templateVersionId])).rows[0],"开书模板版本不存在。"),base=await prepareBaseReviewCards(version.payload as TemplatePayload,session.method,session.inputPayload,session.researchPreview?.suggestedCards??[]),aiCards=cards.map(card=>reviewCard(card,"ai")),reviewCards=mergeReviewCards([aiCards,base]),selected=session.directionCandidates.find(item=>item.id===session.selectedDirectionId),bookName=session.bookName.trim()||selected?.title||"",description=session.description.trim()||selected?.premise||"";
  await pool.query("UPDATE new_design.ai_generation_batches SET status='review',stage='review_initial_content',progress=100,output_payload=$2::jsonb,completed_at=now(),updated_at=now() WHERE id=$1", [batchId, JSON.stringify({ cards })]);
  await pool.query("UPDATE new_design.book_creation_sessions SET status='review',stage='review_initial_content',progress=82,book_name=$2,description=$3,initial_cards=$4::jsonb,review_cards=$5::jsonb,error_message=NULL,revision=revision+1,updated_at=now() WHERE id=$1", [sessionId,bookName,description,JSON.stringify(cards),JSON.stringify(reviewCards)]);
  return getBookCreationSession(sessionId);
}

export async function saveBookCreationReview(sessionId:string,input:{bookName:string;description:string;reviewCards:BookCreationReviewCard[];revision:number;requireComplete?:boolean}):Promise<BookCreationSession>{
  const pool=await getNewDesignPool(),client=await pool.connect();
  try{await client.query("BEGIN");const row=assertFound((await client.query("SELECT * FROM new_design.book_creation_sessions WHERE id=$1 FOR UPDATE",[sessionId])).rows[0],"开书流程不存在。");if(Number(row.revision)!==input.revision)throw new NewDesignError("开书表单已在其他页面更新，请刷新后再保存。",409);if(["creating","completed"].includes(String(row.status)))throw new NewDesignError("这次开书已进入创建阶段，不能继续修改。",409);const version=assertFound((await client.query("SELECT payload FROM new_design.template_group_versions WHERE id=$1",[row.template_version_id])).rows[0],"开书模板版本不存在。"),payload=version.payload as TemplatePayload,validated=validateBookCreationReviewCards(normalizeBookCreationReview(input.reviewCards,(row.review_cards??[]) as BookCreationReviewCard[]),payload.cardTypes,payload.dictionaries,input.requireComplete??false);
    if(String(row.status)==="generating")throw new NewDesignError("AI 正在准备内容，请等待完成后再保存。",409);
    if(Object.keys(validated.issues).length)throw new NewDesignError("开书表单中仍有内容需要修改。",422,validated.issues);await client.query("UPDATE new_design.book_creation_sessions SET book_name=$2,description=$3,review_cards=$4::jsonb,status='review',stage='review_initial_content',progress=82,error_message=NULL,revision=revision+1,updated_at=now() WHERE id=$1",[sessionId,input.bookName,input.description,JSON.stringify(validated.cards)]);await client.query("COMMIT");return getBookCreationSession(sessionId);
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function failSessionGeneration(sessionId: string, batchId: string, stage: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "AI 服务暂时不可用。";
  const pool = await getNewDesignPool();
  await pool.query("UPDATE new_design.ai_generation_batches SET status='failed',stage=$2,error_message=$3,updated_at=now(),completed_at=now() WHERE id=$1", [batchId, stage, message]);
  await pool.query("UPDATE new_design.book_creation_sessions SET status='failed',stage=$2,last_failed_stage=$2,error_message=$3,revision=revision+1,updated_at=now() WHERE id=$1", [sessionId, stage, message]);
}

export async function completeBookCreation(sessionId: string, options: { keepCurrentResult?: boolean;expectedRevision:number }): Promise<BookCreationSession> {
  const pool = await getNewDesignPool();
  const session = await getBookCreationSession(sessionId);
  if (session.bookId) return session;
  if(session.revision!==options.expectedRevision)throw new NewDesignError("开书表单已更新，请确认最新内容后再创建。",409);
  if(!session.bookName.trim())throw new NewDesignError("请先填写书名。",422,{bookName:"请填写书名。"});
  if(session.status!=="review")throw new NewDesignError("请先完成开书表单审阅。",422);
  const templateVersion=assertFound((await pool.query("SELECT payload FROM new_design.template_group_versions WHERE id=$1",[session.templateVersionId])).rows[0],"开书模板版本不存在。"),payload=templateVersion.payload as TemplatePayload,validated=validateBookCreationReviewCards(session.reviewCards,payload.cardTypes,payload.dictionaries,true);
  if(Object.keys(validated.issues).length)throw new NewDesignError("请补齐开书表单后再创建书籍。",422,validated.issues);
  const name = session.bookName.trim(),description=session.description.trim();
  const claimed=await pool.query("UPDATE new_design.book_creation_sessions SET status='creating',stage='install_template',progress=88,error_message=NULL,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND status='review' RETURNING id", [sessionId,options.expectedRevision]);
  if(!claimed.rowCount)throw new NewDesignError("开书表单已更新，请确认最新内容后再创建。",409);
  try {
    const latestBatch = (await pool.query("SELECT id FROM new_design.ai_generation_batches WHERE session_id=$1 AND operation='initial_content' AND status='review' ORDER BY created_at DESC LIMIT 1", [sessionId])).rows[0];
    const researchReuse=await getSessionResearchReuse(sessionId);
    const book = await createBook({ key: `book_${Date.now().toString(36)}_${session.id.slice(0, 6)}`, name, description, templateVersionId: session.templateVersionId }, {
      includeTemplateSeed:false,
      reviewCards:validated.cards,
      researchReferences:researchReuse.references,
      origin: { sessionId, method: session.method, sourceReference: session.sourceReference, sourcePayload: session.inputPayload, generationBatchId: latestBatch?.id ? String(latestBatch.id) : undefined },
    });
    await pool.query("UPDATE new_design.book_creation_sessions SET status='completed',stage='ready',progress=100,book_id=$2,error_message=NULL,revision=revision+1,updated_at=now() WHERE id=$1", [sessionId, book.id]);
    if (latestBatch?.id && session.reviewCards.some(card=>card.sourceKind==="ai")) await pool.query("UPDATE new_design.ai_generation_batches SET status='applied',stage='applied',updated_at=now() WHERE id=$1", [latestBatch.id]);
    return getBookCreationSession(sessionId);
  } catch (error) {
    await pool.query("UPDATE new_design.book_creation_sessions SET status='failed',stage='install_template',last_failed_stage='install_template',error_message=$2,revision=revision+1,updated_at=now() WHERE id=$1", [sessionId, error instanceof Error ? error.message : "创建书籍失败。"]).catch(() => undefined);
    throw error;
  }
}

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

export async function beginFormAssist(input: { bookId: string; cardId: string; formKey: string; instruction: string; baseRevision: number }): Promise<string> {
  const id = randomUUID();
  await (await getNewDesignPool()).query(`INSERT INTO new_design.ai_generation_batches (id,book_id,card_id,form_key,operation,status,stage,progress,instruction,base_revision,prompt_id,prompt_version) VALUES ($1,$2,$3,$4,'form_assist','running','understand_form',20,$5,$6,'new_design.form.assist','v1')`, [id, input.bookId, input.cardId, input.formKey, input.instruction, input.baseRevision]);
  return id;
}

export async function saveFormAssist(batchId: string, suggestions: Record<string, unknown>): Promise<AiAssistBatch> {
  const pool = await getNewDesignPool();
  const row = assertFound((await pool.query("UPDATE new_design.ai_generation_batches SET status='review',stage='review_suggestions',progress=100,output_payload=$2::jsonb,completed_at=now(),updated_at=now() WHERE id=$1 RETURNING *", [batchId, JSON.stringify(suggestions)])).rows[0], "AI 建议批次不存在。");
  return mapBatch(row);
}

export async function failFormAssist(batchId: string, error: unknown): Promise<void> {
  await (await getNewDesignPool()).query("UPDATE new_design.ai_generation_batches SET status='failed',stage='generate_suggestions',error_message=$2,completed_at=now(),updated_at=now() WHERE id=$1", [batchId, error instanceof Error ? error.message : "AI 服务暂时不可用。"]);
}

export async function applyFormAssist(batchId: string, fieldKeys: string[], expectedRevision: number): Promise<CardSummary> {
  const pool = await getNewDesignPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batch = assertFound((await client.query("SELECT * FROM new_design.ai_generation_batches WHERE id=$1 FOR UPDATE", [batchId])).rows[0], "AI 建议批次不存在。");
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
    for (const key of selected) await client.query(`INSERT INTO new_design.card_field_origins (id,card_id,field_key,source_kind,generation_batch_id,confirmation_status,original_value,current_value) VALUES ($1,$2,$3,'ai',$4,'confirmed',$5::jsonb,$5::jsonb) ON CONFLICT (card_id,field_key) DO UPDATE SET source_kind='ai',generation_batch_id=EXCLUDED.generation_batch_id,confirmation_status='confirmed',original_value=EXCLUDED.original_value,current_value=EXCLUDED.current_value,updated_at=now()`, [randomUUID(), card.id, key, batchId, JSON.stringify(suggestions[key])]);
    await client.query("UPDATE new_design.ai_generation_batches SET status='applied',stage='applied',updated_at=now() WHERE id=$1", [batchId]);
    await client.query("COMMIT");
    return (await getCardAssistContext(String(batch.book_id), String(card.id))).card;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
