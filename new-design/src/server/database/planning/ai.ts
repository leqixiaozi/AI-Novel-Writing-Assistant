import { randomUUID } from "node:crypto";
import type { PlanningAiCandidateRun, PlanningLevel, PlanningObject, PlanningReferenceRole } from "../../../common/contracts";
import type { NewDesignAiGateway } from "../../ai/gateway";
import { NewDesignError, assertFound } from "../../domain/errors";
import { getNewDesignPool } from "../runtime";
import { addPlanningVersion, createPlanningObject, getPlanningObject } from "./store";

const roleByType:Record<string,PlanningReferenceRole>={character:"participant",location:"location",event:"event",foreshadow:"foreshadow",prop:"item",organization:"organization"};
const iso=(value:unknown)=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();

export async function generatePlanningAiCandidate(ai:NewDesignAiGateway,input:{bookId:string;targetObjectId?:string|null;instruction:string;createdBy?:string}):Promise<PlanningAiCandidateRun>{
  const pool=await getNewDesignPool();
  const book=assertFound((await pool.query("SELECT id,space_id,name,description FROM new_design.books WHERE id=$1 AND status='active'",[input.bookId])).rows[0],"书籍不存在或已归档。");
  let target:PlanningObject|null=null;
  if(input.targetObjectId){target=await getPlanningObject(input.targetObjectId);if(target.bookId!==input.bookId||target.status!=="active")throw new NewDesignError("AI 规划目标不属于当前书籍或已归档。",422);}
  else {const row=(await pool.query("SELECT id FROM new_design.planning_objects WHERE book_id=$1 AND level='story' AND status='active' ORDER BY sort_order,id LIMIT 1",[input.bookId])).rows[0];if(row)target=await getPlanningObject(String(row.id));}
  const materialRows=(await pool.query(`SELECT card.id,card.current_version_id,type.type_key,type.name type_name,card.title,card.values
    FROM new_design.cards card JOIN new_design.card_types type ON type.id=card.card_type_id
    WHERE card.space_id=$1 AND card.status='active' AND type.type_key<>'character_author_guidance' AND card.current_version_id IS NOT NULL
    ORDER BY type.sort_order,card.updated_at DESC,card.id LIMIT 120`,[book.space_id])).rows;
  const adoptedRows=(await pool.query(`SELECT object.level,object.title,version.id version_id,version.content FROM new_design.planning_objects object
    JOIN new_design.planning_versions version ON version.id=object.adopted_version_id
    WHERE object.book_id=$1 AND object.status='active' ORDER BY object.sort_order,object.id`,[input.bookId])).rows;
  let parentContent:Record<string,unknown>|null=null;
  if(target?.parentObjectId){const parent=await getPlanningObject(target.parentObjectId);parentContent=parent.adoptedVersion?.content??null;}
  const materials=materialRows.map((row)=>({cardId:String(row.id),typeKey:String(row.type_key),typeName:String(row.type_name),title:String(row.title),values:(row.values??{}) as Record<string,unknown>}));
  const adoptedPlans=adoptedRows.map((row)=>({level:row.level as PlanningLevel,title:String(row.title),content:(row.content??{}) as Record<string,unknown>}));
  const level:PlanningLevel=target?.level??"story",runId=randomUUID(),sourceSnapshot={targetObjectId:target?.id??null,targetRevision:target?.revision??null,baseVersionId:target?.currentVersionId??null,materialVersions:materialRows.map(row=>({cardId:String(row.id),cardVersionId:String(row.current_version_id)})),adoptedPlanVersions:adoptedRows.map(row=>String(row.version_id))};
  await pool.query(`INSERT INTO new_design.planning_ai_candidate_runs(id,book_id,target_object_id,base_version_id,status,instruction,source_snapshot,created_by)
    VALUES($1,$2,$3,$4,'running',$5,$6::jsonb,$7)`,[runId,input.bookId,target?.id??null,target?.currentVersionId??null,input.instruction,JSON.stringify(sourceSnapshot),input.createdBy??"user"]);
  try{
    const generated=await ai.generatePlanningCandidate({bookName:String(book.name),bookDescription:String(book.description??""),target:{level,title:target?.title??"故事总览",currentContent:target?.currentVersion.content??null,parentContent},materials,adoptedPlans,instruction:input.instruction});
    const materialById=new Map(materialRows.map(row=>[String(row.id),row]));let sortOrder=0;
    const references=[...new Set(generated.output.sourceCardIds)].flatMap(cardId=>{const row=materialById.get(cardId),role=row?roleByType[String(row.type_key)]:undefined;if(!row||!role)return[];return[{role,cardId,cardVersionId:String(row.current_version_id),action:role==="foreshadow"?"reinforce" as const:null,note:"AI 规划候选引用",sortOrder:sortOrder++}];});
    const content={...(target?.currentVersion.content??{}),...(generated.output.stageFields??{}),goal:generated.output.goal,storyTime:generated.output.storyTime,mustHappen:generated.output.mustHappen,mustPreserve:generated.output.mustPreserve,forbiddenBoundaries:generated.output.forbiddenBoundaries,expectedChanges:generated.output.expectedChanges,characterArc:generated.output.characterArc,notes:generated.output.notes};
    let saved:PlanningObject;
    if(target)saved=await addPlanningVersion(target.id,{content,source:"ai",executionMode:"ai_assisted",references,baseVersionId:target.currentVersionId,basedOnParentVersionId:target.level==="story"?null:(await getPlanningObject(assertFound(target.parentObjectId,"下级规划缺少父级。"))).adoptedVersionId,sourceBodyVersionId:null,createdBy:input.createdBy??"user",idempotencyKey:`planning-ai:${runId}`,expectedRevision:target.revision});
    else saved=await createPlanningObject({bookId:input.bookId,level:"story",parentObjectId:null,cardId:null,title:generated.output.title,sortOrder:0,content,source:"ai",executionMode:"ai_assisted",references,baseVersionId:null,basedOnParentVersionId:null,sourceBodyVersionId:null,createdBy:input.createdBy??"user",idempotencyKey:`planning-ai:${runId}`});
    const version=saved.versions.find(item=>item.id===saved.currentVersionId)??saved.currentVersion;
    const row=(await pool.query(`UPDATE new_design.planning_ai_candidate_runs SET status='completed',result_object_id=$2,result_version_id=$3,prompt_snapshot=$4::jsonb,model_snapshot=$5::jsonb,used_tokens=$6,completed_at=now()
      WHERE id=$1 RETURNING *`,[runId,saved.id,version.id,JSON.stringify(generated.promptSnapshot),JSON.stringify(generated.modelSnapshot),generated.usedTokens])).rows[0];
    return{id:String(row.id),bookId:String(row.book_id),planningObjectId:saved.id,planningVersionId:version.id,status:"completed",instruction:String(row.instruction),createdAt:iso(row.created_at),completedAt:iso(row.completed_at),object:saved};
  }catch(error){const message=error instanceof Error?error.message:"AI 规划生成失败。";await pool.query("UPDATE new_design.planning_ai_candidate_runs SET status='failed',error_message=$2,completed_at=now() WHERE id=$1",[runId,message]).catch(()=>undefined);throw error;}
}
