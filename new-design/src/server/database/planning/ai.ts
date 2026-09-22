import {findRecordCard,listRecordCards} from '../recordCards';
import {insertPlanningRecord,patchPlanningRecord,planningTransaction} from './records';
import { randomUUID } from "node:crypto";
import type { PlanningAiCandidateRun, PlanningLevel, PlanningObject, PlanningReferenceRole } from "../../../common/contracts";
import type { NewDesignAiGateway } from "../../ai/gateway";
import { NewDesignError, assertFound } from "../../domain/errors";
import { getNewDesignPool } from "../runtime";
import { addPlanningVersion, createPlanningObject, getPlanningObject } from "./store";
import {getActiveWorldUsageCreativeScopes,assertWorldUsageScopesCurrent} from '../worldUsage';

const roleByType:Record<string,PlanningReferenceRole>={character:"participant",location:"location",event:"event",foreshadow:"foreshadow",prop:"item",organization:"organization"};
const iso=(value:unknown)=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();

export async function generatePlanningAiCandidate(ai:NewDesignAiGateway,input:{bookId:string;targetObjectId?:string|null;instruction:string;createdBy?:string}):Promise<PlanningAiCandidateRun>{
  const pool=await getNewDesignPool();
  const book=assertFound((await pool.query("SELECT id,space_id,name,description FROM new_design.books WHERE id=$1 AND status='active'",[input.bookId])).rows[0],"书籍不存在或已归档。");
  let target:PlanningObject|null=null;
  if(input.targetObjectId){target=await getPlanningObject(input.targetObjectId);if(target.bookId!==input.bookId||target.status!=="active")throw new NewDesignError("AI 规划目标不属于当前书籍或已归档。",422);}
  else {const row=(await listRecordCards(pool,'planning_object',{where:{book_id:input.bookId,level:'story',status:'active'}})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||a.id.localeCompare(b.id))[0];if(row)target=await getPlanningObject(String(row.id));}
  let materialRows=(await pool.query(`SELECT card.id,card.current_version_id,type.type_key,type.name type_name,card.title,card.values
    FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id
    WHERE card.space_id=$1 AND card.status='active' AND NOT type.is_internal AND type.type_key<>'character_author_guidance' AND card.current_version_id IS NOT NULL
    ORDER BY type.sort_order,card.updated_at DESC,card.id LIMIT 120`,[book.space_id])).rows;
  const worldUsage=await getActiveWorldUsageCreativeScopes(input.bookId),selectedWorldIds=new Set(worldUsage.flatMap(scope=>[scope.rootCardId,...scope.factions.map(card=>card.cardId),...scope.locations.map(card=>card.cardId),...scope.rules.map(card=>card.cardId)])),worldTypes=new Set(['world_setting','world_overview','faction','organization','location','world_rule','time_rule','power_system']);
  const missing=[...selectedWorldIds].filter(id=>!materialRows.some(row=>String(row.id)===id));
  if(missing.length){const exact=(await pool.query(`SELECT card.id,card.current_version_id,type.type_key,type.name type_name,card.title,card.values FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id WHERE card.space_id=$1 AND card.status='active' AND card.id=ANY($2::uuid[])`,[book.space_id,missing])).rows;if(exact.length!==missing.length)throw new NewDesignError('已采用世界范围的精确资料未完整读取，未开始规划生成。',409);materialRows=[...materialRows,...exact];}
  if(worldUsage.some(scope=>[{cardId:scope.rootCardId,versionId:scope.rootVersionId},...scope.factions,...scope.locations,...scope.rules].some(source=>!materialRows.some(row=>String(row.id)===source.cardId&&String(row.current_version_id)===source.versionId))))throw new NewDesignError('规划材料与已采用世界范围的精确版本不一致，未开始生成。',409);
  materialRows=materialRows.filter(row=>!worldUsage.length||!worldTypes.has(String(row.type_key))||selectedWorldIds.has(String(row.id)));
  if(materialRows.length>300)throw new NewDesignError('规划来源超过完整冻结上限，未截断后生成。',422);
  const adoptedRows:Record<string,any>[]=[];
  for(const object of (await listRecordCards(pool,'planning_object',{where:{book_id:input.bookId,status:'active'}})).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||a.id.localeCompare(b.id))){const version=object.adopted_version_id?await findRecordCard(pool,object.adopted_version_id,'planning_version'):null;if(version)adoptedRows.push({level:object.level,title:object.title,version_id:version.id,content:version.content});}
  let parentContent:Record<string,unknown>|null=null;
  if(target?.parentObjectId){const parent=await getPlanningObject(target.parentObjectId);parentContent=parent.adoptedVersion?.content??null;}
  const materials=materialRows.map((row)=>({cardId:String(row.id),typeKey:String(row.type_key),typeName:String(row.type_name),title:String(row.title),values:(row.values??{}) as Record<string,unknown>}));
  const adoptedPlans=adoptedRows.map((row)=>({level:row.level as PlanningLevel,title:String(row.title),content:(row.content??{}) as Record<string,unknown>}));
  const level:PlanningLevel=target?.level??"story",runId=randomUUID(),sourceSnapshot={targetObjectId:target?.id??null,targetRevision:target?.revision??null,baseVersionId:target?.currentVersionId??null,materialVersions:materialRows.map(row=>({cardId:String(row.id),cardVersionId:String(row.current_version_id)})),adoptedPlanVersions:adoptedRows.map(row=>String(row.version_id)),worldUsage};
  await planningTransaction(db=>insertPlanningRecord(db,input.bookId,'planning_ai_candidate_run',{id:runId,target_object_id:target?.id??null,base_version_id:target?.currentVersionId??null,status:'running',instruction:input.instruction,source_snapshot:sourceSnapshot,created_by:input.createdBy??'user',result_object_id:null,result_version_id:null,prompt_snapshot:null,model_snapshot:null,used_tokens:0,error_message:null,completed_at:null}));
  try{
    const generated=await ai.generatePlanningCandidate({bookName:String(book.name),bookDescription:String(book.description??""),target:{level,title:target?.title??"故事总览",currentContent:target?.currentVersion.content??null,parentContent},materials,adoptedPlans,instruction:input.instruction,worldUsage});
    const check=await pool.connect();try{await check.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await assertWorldUsageScopesCurrent(check,input.bookId,worldUsage);await check.query('COMMIT');}catch(error){await check.query('ROLLBACK');throw error;}finally{check.release();}
    const materialById=new Map(materialRows.map(row=>[String(row.id),row]));let sortOrder=0;
    const references=[...new Set(generated.output.sourceCardIds)].flatMap(cardId=>{const row=materialById.get(cardId),role=row?roleByType[String(row.type_key)]:undefined;if(!row||!role)return[];return[{role,cardId,cardVersionId:String(row.current_version_id),action:role==="foreshadow"?"reinforce" as const:null,note:"AI 规划候选引用",sortOrder:sortOrder++}];});
    const content={...(target?.currentVersion.content??{}),...(generated.output.stageFields??{}),goal:generated.output.goal,storyTime:generated.output.storyTime,mustHappen:generated.output.mustHappen,mustPreserve:generated.output.mustPreserve,forbiddenBoundaries:generated.output.forbiddenBoundaries,expectedChanges:generated.output.expectedChanges,characterArc:generated.output.characterArc,notes:generated.output.notes};
    let saved:PlanningObject;
    if(target)saved=await addPlanningVersion(target.id,{content,source:"ai",executionMode:"ai_assisted",references,baseVersionId:target.currentVersionId,basedOnParentVersionId:target.level==="story"?null:(await getPlanningObject(assertFound(target.parentObjectId,"下级规划缺少父级。"))).adoptedVersionId,sourceBodyVersionId:null,createdBy:input.createdBy??"user",idempotencyKey:`planning-ai:${runId}`,expectedRevision:target.revision});
    else saved=await createPlanningObject({bookId:input.bookId,level:"story",parentObjectId:null,cardId:null,title:generated.output.title,sortOrder:0,content,source:"ai",executionMode:"ai_assisted",references,baseVersionId:null,basedOnParentVersionId:null,sourceBodyVersionId:null,createdBy:input.createdBy??"user",idempotencyKey:`planning-ai:${runId}`});
    const version=saved.versions.find(item=>item.id===saved.currentVersionId)??saved.currentVersion;
    const row=await planningTransaction(db=>patchPlanningRecord(db,runId,'planning_ai_candidate_run',{status:'completed',result_object_id:saved.id,result_version_id:version.id,prompt_snapshot:generated.promptSnapshot,model_snapshot:generated.modelSnapshot,used_tokens:generated.usedTokens,completed_at:new Date().toISOString()}));
    return{id:String(row.id),bookId:String(row.book_id),planningObjectId:saved.id,planningVersionId:version.id,status:"completed",instruction:String(row.instruction),createdAt:iso(row.created_at),completedAt:iso(row.completed_at),object:saved};
  }catch(error){const message=error instanceof Error?error.message:"AI 规划生成失败。";await planningTransaction(db=>patchPlanningRecord(db,runId,'planning_ai_candidate_run',{status:'failed',error_message:message,completed_at:new Date().toISOString()})).catch(()=>undefined);throw error;}
}
