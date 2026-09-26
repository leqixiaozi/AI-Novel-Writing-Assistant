import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { FormAssistRun, FormAssistRequest, FormAssistAdoption, FormAssistCandidate, FormAssistSnapshot } from "../../../common/formAssist";
import type { NewDesignAiGateway } from "../../ai/gateway";
import { NewDesignError, assertFound } from "../../domain/errors";
import { aiFormFields, validateFormCandidate, validateFormDraft, formAiAdoptSchema } from "../../domain/formAssist";
import { getNewDesignPool } from "../runtime";
import { formHash, freezeFormContext } from "./context";
import type { z } from "zod";
import { selectableTreeNodeIds } from "../../../common/treePolicy";
import { validateFieldValue } from "../../domain/validation";
import {readActiveWorldUsageScopes,assertWorldUsageScopesCurrent} from '../worldUsage';
import {worldUsageCreativeScopes} from '../../../common/worldUsage';
import {createRecordCard,findRecordCard,listRecordCards,replaceRecordCard} from '../recordCards';
export class FormAiPreparationError extends NewDesignError {constructor(message:string,status:number,public readonly mutationOutcome:"not_written"|"unknown",issues?:Record<string,string>){super(message,status,issues);}}

function mapRun(row:Record<string,any>):FormAssistRun {
  const output=row.output_payload??{};
  return {id:row.id,action:row.input_payload.action,status:row.status,revision:Number(row.revision),instruction:row.instruction,snapshot:row.input_payload.snapshot,candidates:output.candidates??[],observations:output.observations??[],newNodes:output.newNodes??[],error:row.error_message??null,createdAt:new Date(row.created_at).toISOString()};
}
async function readRun(db:Pick<PoolClient,"query">,bookId:string,id:string,lock=false){
  const row=await findRecordCard(db,id,'ai_generation_batch',{lock});
  return assertFound(row?.book_id===bookId&&row.input_payload?.contract==='business_form_ai_v1'?row:null,'AI 表单建议不存在于本书。');
}
async function finishRun(bookId:string,id:string,values:Record<string,unknown>):Promise<void>{
  const db=await(await getNewDesignPool()).connect();
  try{await db.query('BEGIN');const row=await readRun(db,bookId,id,true);
    if(row.status==='running')await replaceRecordCard(db,{id,spaceId:row.recordSpaceId,typeKey:'ai_generation_batch',values:{...row,...values,revision:row.revision+1,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}});
    await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
export async function getBusinessFormAi(bookId:string,id:string):Promise<FormAssistRun>{return mapRun(await readRun(await getNewDesignPool(),bookId,id));}
export async function getBusinessFormAiByRequest(bookId:string,key:string):Promise<FormAssistRun|null>{
 if(!/^[a-f0-9-]{36}$/i.test(bookId)||key.trim().length<8||key.trim().length>160)throw new NewDesignError("只读核对的书籍或原请求标识无效。",422);
 const db=await(await getNewDesignPool()).connect();try{await db.query("BEGIN");await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${bookId}:${key.trim()}`]);const rows=await listRecordCards(db,'ai_generation_batch',{where:{book_id:bookId,input_payload:{contract:'business_form_ai_v1',idempotencyKey:key.trim()}}});if(rows.length>1)throw new NewDesignError("原AI请求对应多份记录，请到运行维护核对，不再次生成。",409);const result=rows[0]?mapRun(rows[0]):null;await db.query("COMMIT");return result;}catch(error){await db.query("ROLLBACK");throw error;}finally{db.release();}
}
export async function generateBusinessFormAi(request:FormAssistRequest,gateway?:NewDesignAiGateway):Promise<FormAssistRun>{
  if(!gateway)throw new FormAiPreparationError("AI 模型尚未连接，请打开模型设置检查连接；本次未领取新生成请求，当前填写保留。",503,"not_written");
  const pool=await getNewDesignPool(),db=await pool.connect(),requestHash=formHash(request);let id=randomUUID(),snapshot:FormAssistSnapshot,committing=false;
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    // Same book/key cannot invoke the model twice, even for parallel requests.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${request.target.bookId}:${request.idempotencyKey}`]);
    const matches=await listRecordCards(db,'ai_generation_batch',{where:{book_id:request.target.bookId,input_payload:{contract:'business_form_ai_v1',idempotencyKey:request.idempotencyKey}}});
    if(matches.length>1)throw new NewDesignError("原 AI 请求对应多份记录，请核对，不再次生成。",409);
    const previous=matches[0];
    if(previous){if(previous.input_payload.requestHash!==requestHash)throw new NewDesignError("同一次请求的内容发生变化，请核对原请求，不覆盖已有结果。",409);committing=true;await db.query("COMMIT");return mapRun(previous);}
    snapshot=await freezeFormContext(db,request.target,request.values,request.tagIds,request.referenceCardIds??[],request.referenceKnowledgeSources??[]);
    const type=(await db.query('SELECT type_key FROM new_design.card_types WHERE id=$1 AND space_id=(SELECT space_id FROM new_design.books WHERE id=$2)',[request.target.cardTypeId,request.target.bookId])).rows[0];
    if(type?.type_key==='character')snapshot.worldUsage=worldUsageCreativeScopes(await readActiveWorldUsageScopes(db,request.target.bookId));
    const issues=validateFormDraft(snapshot,request.values);if(Object.keys(issues).length)throw new NewDesignError("请先修正表单中格式或范围有误的项目。",422,issues);
    if(request.fieldKeys.some(key=>!snapshot.fields.some(field=>field.key===key&&!field.hidden)))throw new NewDesignError("选择的字段不属于当前表单。",422);
    const space=assertFound((await db.query('SELECT space_id FROM new_design.books WHERE id=$1',[request.target.bookId])).rows[0],'书籍不存在。'),now=new Date().toISOString();
    await createRecordCard(db,{id,spaceId:String(space.space_id),typeKey:'ai_generation_batch',title:'AI 表单建议',values:{id,session_id:null,book_id:request.target.bookId,card_id:request.target.cardId,form_key:null,operation:'form_assist',status:'running',stage:'generating',progress:0,revision:1,instruction:request.instruction,input_payload:{contract:'business_form_ai_v1',idempotencyKey:request.idempotencyKey,requestHash,action:request.action,fieldKeys:request.fieldKeys,snapshot},output_payload:{},base_revision:request.target.cardRevision,prompt_id:'new_design.form.assist',prompt_version:'v1',error_message:null,created_at:now,updated_at:now,completed_at:null}});
    committing=true;await db.query("COMMIT");
  }catch(error){let rolledBack=false;try{await db.query("ROLLBACK");rolledBack=true;}catch{/* Preserve unknown physical transaction outcome. */}const outcome=rolledBack&&!committing?"not_written":"unknown";throw new FormAiPreparationError(error instanceof NewDesignError?error.message:outcome==="not_written"?"准备资料提炼请求时底座未完成写入，已确认回滚；当前填写与参考保留，请核对来源后明确重新准备。":"资料提炼请求领取结果尚未确认，请保留原请求，只读核对，不再次调用模型。",outcome==="unknown"?503:error instanceof NewDesignError?error.status:503,outcome,error instanceof NewDesignError?error.issues:undefined);}finally{db.release();}
  try{
    const fields=aiFormFields(snapshot!,request.action,request.fieldKeys),allowed=new Set(fields.map(field=>field.key)),book=(await pool.query("SELECT name FROM new_design.books WHERE id=$1",[request.target.bookId])).rows[0];
    if(!fields.length)throw new NewDesignError("当前选择中没有允许 AI 修改的项目。",422);
    if(snapshot!.worldUsage){const check=await pool.connect();try{await check.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await assertWorldUsageScopesCurrent(check,request.target.bookId,snapshot!.worldUsage);await check.query('COMMIT');}catch(error){await check.query('ROLLBACK');throw error;}finally{check.release();}}
    const outputs=await Promise.all(Array.from({length:request.action==="alternatives"?3:1},()=>gateway.assistForm({bookName:book.name,formName:"本书资料表单",cardTitle:request.target.title,
      currentValues:{...request.values,__readonly_context:{relations:snapshot!.relations,trees:snapshot!.trees.filter(tree=>tree.rule.aiSuggestible).map(tree=>({...tree,nodes:tree.nodes.filter(node=>selectableTreeNodeIds(tree.nodes,tree.rule).has(node.id))})),...(snapshot!.knowledgeReferences?.length?{knowledgeReferences:snapshot!.knowledgeReferences.map(source=>({...source,kind:"untrusted_knowledge_reference"}))}:{}),...(snapshot!.worldUsage?{worldUsage:snapshot!.worldUsage}:{})}},fields,instruction:request.instruction})));
    const candidates:FormAssistCandidate[]=[],observations:FormAssistRun["observations"]=[],newNodes:FormAssistRun["newNodes"]=[];
    for(const [index,output] of outputs.entries()){
      const missing=fields.filter(field=>field.required&&validateFieldValue(field,output?.[field.key]));if(["fill_required","prepare_all"].includes(request.action)&&missing.length)throw new NewDesignError(`AI 未完整准备必填项：${missing.slice(0,5).map(field=>field.key==="__title"?"资料名称":field.name).join("、")}。请在此重试生成建议，原草稿保留。`,422);
      if(!output||Array.isArray(output)||typeof output!=="object"||Object.keys(output).some(key=>!allowed.has(key)))throw new NewDesignError("AI 返回了当前表单范围以外的内容，请重试。",422);
      const candidate:FormAssistCandidate={id:randomUUID(),name:outputs.length>1?`方案 ${index+1}`:"修改建议",values:{},tags:{}};
      for(const [key,value] of Object.entries(output)){
        if(key==="__observations"){if(typeof value!=="string")throw new NewDesignError("AI 检查意见格式无效。",422);if(value.trim())observations.push({kind:"review",message:value});}
        else if(key.startsWith("__tags_")){if(!Array.isArray(value)||value.some(id=>typeof id!=="string"))throw new NewDesignError("AI 标签建议格式无效。",422);candidate.tags[key.slice(7)]=value as string[];}
        else if(key.startsWith("__new_")){if(typeof value!=="string")throw new NewDesignError("AI 新增选项建议格式无效。",422);if(value.trim())newNodes.push({id:randomUUID(),treeKey:key.slice(6),name:value.trim(),parentId:snapshot!.trees.find(tree=>tree.key===key.slice(6))?.rule.rootNodeId??null});}
        else candidate.values[key]=value;
      }
      const issues=validateFormCandidate(snapshot!,candidate,request.action);if(Object.keys(issues).length)throw new NewDesignError("AI 候选未通过类型或字典／标签范围校验。",422,issues);
      if(Object.keys(candidate.values).length||Object.keys(candidate.tags).length)candidates.push(candidate);
    }
    if(request.action==="check"&&!observations.length)throw new NewDesignError("AI 未返回有效检查意见，请重新生成。",422);
    await finishRun(request.target.bookId,id,{status:'review',stage:'review',progress:100,output_payload:{candidates,observations,newNodes}});
  }catch(error){await finishRun(request.target.bookId,id,{status:'failed',stage:'failed',error_message:error instanceof NewDesignError?error.message:"AI 生成失败，请检查模型连接后重新发起。"});}
  return getBusinessFormAi(request.target.bookId,id);
}

export async function adoptBusinessFormAi(bookId:string,id:string,input:z.infer<typeof formAiAdoptSchema>):Promise<FormAssistAdoption>{
  const pool=await getNewDesignPool(),db=await pool.connect(),hash=formHash(input);
  try{await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");const row=await readRun(db,bookId,id,true),run=mapRun(row);
    const previous=(await listRecordCards(db,'form_ai_draft_decision',{where:{batch_id:id,idempotency_key:input.idempotencyKey}}))[0];
    if(previous){if(previous.request_hash!==hash)throw new NewDesignError("同一次采用请求的内容发生变化。",409);await db.query("COMMIT");return {decisionId:previous.id,...previous.draft_snapshot};}
    if(run.status!=="review"&&run.status!=="applied")throw new NewDesignError("这组建议不可采用，请重新生成。",409);
    if(run.snapshot.worldUsage)await assertWorldUsageScopesCurrent(db,bookId,run.snapshot.worldUsage);
    const current=await freezeFormContext(db,run.snapshot.target,input.values,input.tagIds,run.snapshot.referenceCardIds??[],run.snapshot.referenceKnowledgeSources??[]);if(current.sourceHash!==run.snapshot.sourceHash)throw new NewDesignError("规格、关联资料或选项已变化，请复核后重新生成；本地草稿会保留。",409);
    const candidate=assertFound(run.candidates.find(item=>item.id===input.candidateId),"请先选择一个有效方案。");
    if(!input.fieldKeys.length&&!input.treeKeys.length)throw new NewDesignError("请勾选要采用的建议。",422);
    if(new Set(input.fieldKeys).size!==input.fieldKeys.length||new Set(input.treeKeys).size!==input.treeKeys.length)throw new NewDesignError("采用项目不能重复。",422);
    const values={...input.values};let tagIds=[...input.tagIds],title=input.title??run.snapshot.target.title;
    for(const key of input.fieldKeys){if(!Object.hasOwn(candidate.values,key))throw new NewDesignError("采用字段不属于此方案。",422);if(key==="__title"){if(formHash(title)!==formHash(run.snapshot.target.title))throw new NewDesignError("资料名称在生成后有人工修改，请保留草稿。",409);title=String(candidate.values[key]).trim();continue;}if(formHash(input.values[key]??null)!==formHash(run.snapshot.values[key]??null))throw new NewDesignError("勾选项目在生成后有人工修改，请保留草稿并重新生成。",409);values[key]=candidate.values[key];}
    for(const key of input.treeKeys){const tree=assertFound(run.snapshot.trees.find(item=>item.kind==="tag"&&item.key===key),"标签维度不属于本书。");if(!Object.hasOwn(candidate.tags,key))throw new NewDesignError("标签建议不属于此方案。",422);const ids=new Set(tree.nodes.map(node=>node.id));
      if(formHash(input.tagIds.filter(id=>ids.has(id)).sort())!==formHash(run.snapshot.tagIds.filter(id=>ids.has(id)).sort()))throw new NewDesignError("标签在生成后有人工修改，请重新生成。",409);
      tagIds=[...tagIds.filter(id=>!ids.has(id)),...candidate.tags[key]];
    }
    const issues=validateFormDraft(current,values);if(Object.keys(issues).length)throw new NewDesignError("合并后的草稿需要修正。",422,issues);
    const decisionId=randomUUID();
    await createRecordCard(db,{id:decisionId,spaceId:row.recordSpaceId,typeKey:'form_ai_draft_decision',title:'采用 AI 草稿',values:{id:decisionId,batch_id:id,candidate_id:input.candidateId,decision:'adopt',selected_field_keys:input.fieldKeys,selected_tree_keys:input.treeKeys,draft_snapshot:{values,tagIds,title},source_hash:run.snapshot.sourceHash,request_hash:hash,idempotency_key:input.idempotencyKey,created_at:new Date().toISOString()}});
    await replaceRecordCard(db,{id,spaceId:row.recordSpaceId,typeKey:'ai_generation_batch',values:{...row,revision:row.revision+1,updated_at:new Date().toISOString()}});await db.query("COMMIT");return {decisionId,values,tagIds,title};
  }catch(error){await db.query("ROLLBACK");throw error;}finally{db.release();}
}
export async function discardBusinessFormAi(bookId:string,id:string,key:string):Promise<FormAssistRun>{
  const pool=await getNewDesignPool(),db=await pool.connect();try{await db.query("BEGIN");const row=await readRun(db,bookId,id,true),run=mapRun(row);
    const previous=(await listRecordCards(db,'form_ai_draft_decision',{where:{batch_id:id,idempotency_key:key}}))[0];
    if(previous&&(previous.decision!=="discard"||previous.request_hash!==formHash({decision:"discard"})))throw new NewDesignError("此请求编号已用于其他确认动作。",409);
    if(run.status==="running")throw new NewDesignError("生成中不能丢弃，请等待完成。",409);
    if(!previous){const decisionId=randomUUID();await createRecordCard(db,{id:decisionId,spaceId:row.recordSpaceId,typeKey:'form_ai_draft_decision',title:'丢弃 AI 草稿',values:{id:decisionId,batch_id:id,candidate_id:null,decision:'discard',selected_field_keys:[],selected_tree_keys:[],draft_snapshot:{},source_hash:run.snapshot.sourceHash,request_hash:formHash({decision:'discard'}),idempotency_key:key,created_at:new Date().toISOString()}});}
    if(row.status!=='discarded')await replaceRecordCard(db,{id,spaceId:row.recordSpaceId,typeKey:'ai_generation_batch',values:{...row,status:'discarded',revision:row.revision+1,updated_at:new Date().toISOString()}});await db.query("COMMIT");return getBusinessFormAi(bookId,id);
  }catch(error){await db.query("ROLLBACK");throw error;}finally{db.release();}
}
