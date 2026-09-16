import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {BookCreationReviewCard,BookCreationSession,BookDirectionCandidate,InitialCardDraft} from "../../../common/contracts";
import {creationDirectorState,CREATION_DIRECTOR_STAGES,type CreationDirectorCommand,type CreationDirectorControl,type CreationDirectorState} from "../../../common/creationDirector";
import {NewDesignError,assertFound} from "../../domain/errors";
import {validateBookCreationReviewCards} from "../../domain/bookCreation";
import {getNewDesignPool} from "../runtime";
import {getBookCreationSession,getSessionAiContext} from "../bookCreationStore";
import type {AiSchemaType} from "../../ai/gateway";
import {formHash} from "../formAssist";
import type {TemplatePayload} from "../templateStore";

async function locked(db:PoolClient,id:string){return assertFound((await db.query("SELECT * FROM new_design.book_creation_sessions WHERE id=$1 FOR UPDATE",[id])).rows[0],"开书流程不存在。");}
function editable(row:Record<string,unknown>,revision?:number){if(revision!==undefined&&Number(row.revision)!==revision)throw new NewDesignError("开书草稿已更新，请读取最新内容后继续。",409);if(["creating","completed"].includes(String(row.status)))throw new NewDesignError("已确认的开书流程不能继续准备。",409);}
async function transaction<T>(action:(db:PoolClient)=>Promise<T>):Promise<T>{const db=await(await getNewDesignPool()).connect();try{await db.query("BEGIN");const result=await action(db);await db.query("COMMIT");return result;}catch(error){await db.query("ROLLBACK");throw error;}finally{db.release();}}

export async function controlCreationDirector(id:string,input:CreationDirectorControl):Promise<BookCreationSession>{
  await transaction(async db=>{const row=await locked(db,id);editable(row,input.expectedRevision);const previous=creationDirectorState(row.input_payload);
    if(row.status==="generating"&&!input.takeOver)throw new NewDesignError("AI 正在准备，请等待完成或明确选择人工接管。",409);
    if(input.directionId&&!row.direction_candidates.some((item:BookDirectionCandidate)=>item.id===input.directionId))throw new NewDesignError("请选择已准备的创作方向。",422);
    if(row.status==="generating"){
      if(!previous?.activeBatchId)throw new NewDesignError("这次准备不属于导演阶段，请等待原步骤完成。",409);
      await db.query("UPDATE new_design.ai_generation_batches SET status='failed',error_message='作者已人工接管，本次迟到结果不会写入',completed_at=now(),updated_at=now() WHERE id=$1 AND session_id=$2 AND status='running'",[previous.activeBatchId,id]);
    }
    const cursor=input.cursor??previous?.cursor??(row.selected_direction_id?1:0);
    const state:CreationDirectorState={mode:input.takeOver?"manual":input.mode,cursor,completedStages:(previous?.completedStages??[]).filter(key=>CREATION_DIRECTOR_STAGES.findIndex(stage=>stage.key===key)<cursor),skippedStages:(previous?.skippedStages??[]).filter(key=>CREATION_DIRECTOR_STAGES.findIndex(stage=>stage.key===key)<cursor),activeBatchId:null,leaseUntil:null};
    await db.query("UPDATE new_design.book_creation_sessions SET input_payload=jsonb_set(input_payload,'{creationDirector}',$2::jsonb),selected_direction_id=COALESCE($3,selected_direction_id),status='review',stage=$4,error_message=NULL,last_failed_stage=NULL,revision=revision+1,updated_at=now() WHERE id=$1",[id,JSON.stringify(state),input.directionId??null,cursor===CREATION_DIRECTOR_STAGES.length?"review_initial_content":`director_${CREATION_DIRECTOR_STAGES[cursor].key}`]);
  });return getBookCreationSession(id);
}

export interface DirectorClaim {batchId:string;state:CreationDirectorState;session:BookCreationSession;sourceText:string;schemaTypes:AiSchemaType[];}
export async function findDirectorReceipt(id:string,request:CreationDirectorCommand):Promise<boolean>{
  const row=(await(await getNewDesignPool()).query("SELECT input_payload FROM new_design.ai_generation_batches WHERE session_id=$1 AND input_payload->>'contract'='creation_director_v1' AND input_payload->>'commandKey'=$2 ORDER BY created_at LIMIT 1",[id,request.idempotencyKey])).rows[0];
  if(!row)return false;if(row.input_payload.commandHash!==formHash(request))throw new NewDesignError("同一次准备请求的内容已改变，请重新发起。",409);return true;
}
export async function claimDirectorStage(id:string,request:CreationDirectorCommand,expectedRevision:number):Promise<DirectorClaim>{
  const context=await getSessionAiContext(id),session=context.session,batchId=randomUUID();let state:CreationDirectorState;
  await transaction(async db=>{const row=await locked(db,id);editable(row,expectedRevision);state=assertFound(creationDirectorState(row.input_payload),"请先选择 AI 开书方式。");
    if(row.status==="generating"||state.activeBatchId)throw new NewDesignError("当前阶段正在准备，请等待结果。",409);
    if(state.mode==="manual"||state.cursor>=CREATION_DIRECTOR_STAGES.length)throw new NewDesignError("当前流程无需继续自动准备。",409);
    const stage=CREATION_DIRECTOR_STAGES[state.cursor],operation=stage.key==="direction"?"directions":"initial_content",next={...state,activeBatchId:batchId,leaseUntil:new Date(Date.now()+10*60_000).toISOString()};
    await db.query("UPDATE new_design.book_creation_sessions SET input_payload=jsonb_set(input_payload,'{creationDirector}',$2::jsonb),status='generating',stage=$3,progress=$4,error_message=NULL,last_failed_stage=NULL,revision=revision+1,updated_at=now() WHERE id=$1",[id,JSON.stringify(next),`director_${stage.key}`,Math.round(state.cursor/CREATION_DIRECTOR_STAGES.length*80)]);
    const version=assertFound((await db.query("SELECT payload FROM new_design.template_group_versions WHERE id=$1",[row.template_version_id])).rows[0],"开书模板版本不存在。");
    await db.query("INSERT INTO new_design.ai_generation_batches(id,session_id,operation,status,stage,input_payload,base_revision,prompt_id,prompt_version) VALUES($1,$2,$3,'running',$4,$5::jsonb,$6,$7,'v1')",[batchId,id,operation,stage.key,JSON.stringify({contract:"creation_director_v1",commandKey:request.idempotencyKey,commandHash:formHash(request),stageCursor:state.cursor,sessionSnapshot:row,templateSnapshot:version.payload,sourceText:context.sourceText,schemaTypes:context.schemaTypes}),Number(row.revision),stage.key==="direction"?"new_design.book_creation.directions":"new_design.book_creation.initial_content"]);
  });return {batchId,state:state!,session,sourceText:context.sourceText,schemaTypes:context.schemaTypes};
}

function blank(value:unknown){return value===null||value===undefined||typeof value==="string"&&!value.trim()||Array.isArray(value)&&value.length===0;}
function mergeDrafts(existing:BookCreationReviewCard[],incoming:InitialCardDraft[],batchId:string):BookCreationReviewCard[]{
  const result=structuredClone(existing);
  for(const card of incoming){let target=result.find(item=>item.typeKey===card.typeKey&&item.title===card.title);const empty=result.filter(item=>item.typeKey===card.typeKey&&blank(item.title));if(!target&&empty.length===1)target=empty[0];
    if(!target){result.push({...card,id:randomUUID(),sourceKind:"ai",sourceId:null,sourceVersionId:null,originalTitle:card.title,originalValues:structuredClone(card.values),aiFieldBatchIds:Object.fromEntries(["$title",...Object.keys(card.values)].map(key=>[key,batchId]))});continue;}
    target.aiFieldBatchIds={...target.aiFieldBatchIds};
    if(blank(target.title)){target.title=card.title;target.originalTitle=card.title;target.aiFieldBatchIds.$title=batchId;}
    for(const [key,value]of Object.entries(card.values))if(blank(target.values[key])){target.values[key]=value;target.originalValues[key]=value;target.aiFieldBatchIds[key]=batchId;}
  }return result;
}
export async function finishDirectorStage(id:string,claim:DirectorClaim,result:{directions?:BookDirectionCandidate[];cards?:InitialCardDraft[];skipped?:boolean}):Promise<BookCreationSession>{
  await transaction(async db=>{const row=await locked(db,id),state=creationDirectorState(row.input_payload);if(row.status!=="generating"||state?.activeBatchId!==claim.batchId)throw new NewDesignError("当前阶段已被接管或换版，迟到结果未写入草稿。",409);
    const batch=assertFound((await db.query("SELECT * FROM new_design.ai_generation_batches WHERE id=$1 AND session_id=$2 AND status='running' FOR UPDATE",[claim.batchId,id])).rows[0],"这次准备已结束。");
    const stage=CREATION_DIRECTOR_STAGES[state.cursor],template=batch.input_payload.templateSnapshot as TemplatePayload;
    if(result.cards?.some(card=>!(stage.typeKeys as readonly string[]).includes(card.typeKey)))throw new NewDesignError("AI 返回了当前阶段以外的资料。",422);
    const cards=mergeDrafts(row.review_cards??[],result.cards??[],claim.batchId);if(cards.length>300)throw new NewDesignError("开书准备资料超过可审阅数量，请移除重复资料后重试当前阶段。",422);const validated=validateBookCreationReviewCards(cards,template.cardTypes,template.dictionaries,false);
    if(Object.keys(validated.issues).length){const names=Object.keys(validated.issues).slice(0,3).map(key=>{const [cardId,fieldKey]=key.split("."),card=validated.cards.find(item=>item.id===cardId),type=template.cardTypes.find(item=>item.key===card?.typeKey);return `${card?.title||type?.name||"当前资料"}的${type?.fields.find(field=>field.key===fieldKey)?.name||"填写内容"}`;});throw new NewDesignError(`${stage.name}中的${names.join("、")}不符合表单要求，草稿保留，请重试当前阶段。`,422,validated.issues);}
    const directions=result.directions??row.direction_candidates,selectedId=stage.key==="direction"?directions[0]?.id??null:row.selected_direction_id,selected=directions.find((item:BookDirectionCandidate)=>item.id===selectedId);
    if(stage.key==="direction"&&!selected)throw new NewDesignError("AI 没有准备有效的创作方向，请重试。",422);
    const next:CreationDirectorState={...state,cursor:state.cursor+1,completedStages:[...new Set([...state.completedStages,stage.key])],skippedStages:result.skipped?[...new Set([...state.skippedStages,stage.key])]:state.skippedStages,activeBatchId:null,leaseUntil:null};
    await db.query("UPDATE new_design.ai_generation_batches SET status='review',output_payload=$2::jsonb,progress=100,completed_at=now(),updated_at=now() WHERE id=$1",[claim.batchId,JSON.stringify(result)]);
    await db.query("UPDATE new_design.book_creation_sessions SET input_payload=jsonb_set(input_payload,'{creationDirector}',$2::jsonb),review_cards=$3::jsonb,direction_candidates=$4::jsonb,selected_direction_id=$5,book_name=$6,description=$7,status='review',stage=$8,progress=$9,error_message=NULL,last_failed_stage=NULL,revision=revision+1,updated_at=now() WHERE id=$1",[id,JSON.stringify(next),JSON.stringify(validated.cards),JSON.stringify(directions),selectedId,String(row.book_name).trim()||selected?.title||"",String(row.description).trim()||selected?.premise||"",next.cursor===CREATION_DIRECTOR_STAGES.length?"review_initial_content":`director_${CREATION_DIRECTOR_STAGES[next.cursor].key}`,Math.round(next.cursor/CREATION_DIRECTOR_STAGES.length*82)]);
  });return getBookCreationSession(id);
}
export async function failDirectorStage(id:string,batchId:string,error:unknown):Promise<void>{
  await transaction(async db=>{const row=await locked(db,id),state=creationDirectorState(row.input_payload);if(state?.activeBatchId!==batchId)return;const message=error instanceof Error?error.message:"AI 准备失败，请重试。",next={...state,activeBatchId:null,leaseUntil:null};
    await db.query("UPDATE new_design.ai_generation_batches SET status='failed',error_message=$2,completed_at=now(),updated_at=now() WHERE id=$1 AND session_id=$3 AND status='running'",[batchId,message,id]);
    const publicMessage=error instanceof NewDesignError?error.message:"AI 当前阶段没有完成，请重试当前阶段；已保存草稿保留。";
    await db.query("UPDATE new_design.book_creation_sessions SET input_payload=jsonb_set(input_payload,'{creationDirector}',$2::jsonb),status='failed',last_failed_stage=stage,error_message=$3,revision=revision+1,updated_at=now() WHERE id=$1",[id,JSON.stringify(next),publicMessage]);
  });
}
