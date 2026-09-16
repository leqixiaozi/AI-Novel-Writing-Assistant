import {z} from "zod";
import {CREATION_DIRECTOR_MODES,CREATION_DIRECTOR_STAGES,creationDirectorState,type CreationDirectorCommand} from "../../../common/creationDirector";
import type {BookDirectionCandidate,BookCreationSession} from "../../../common/contracts";
import type {NewDesignAiGateway} from "../../ai/gateway";
import {getBookCreationSession} from "../../database/bookCreationStore";
import {claimDirectorStage,findDirectorReceipt,finishDirectorStage,failDirectorStage} from "../../database/creationDirector";
import {NewDesignError} from "../../domain/errors";

export const directorCommandSchema=z.object({expectedRevision:z.number().int().positive(),idempotencyKey:z.string().trim().min(8).max(160)}).strict();
export const directorControlSchema=z.object({expectedRevision:z.number().int().positive(),mode:z.enum(CREATION_DIRECTOR_MODES),cursor:z.number().int().min(0).max(CREATION_DIRECTOR_STAGES.length).optional(),takeOver:z.boolean().optional(),directionId:z.string().min(1).max(80).optional()}).strict();
const directionsSchema=z.array(z.object({id:z.string().min(1).max(80),title:z.string().trim().min(1).max(100),premise:z.string().trim().min(1).max(800),protagonist:z.string(),centralConflict:z.string(),readerPromise:z.string(),styleKeywords:z.array(z.string())})).min(1).max(10).superRefine((items,ctx)=>{if(new Set(items.map(item=>item.id)).size!==items.length)ctx.addIssue({code:"custom",message:"方向身份不能重复。"});});
const cardsSchema=z.array(z.object({typeKey:z.string().min(1),title:z.string().trim().min(1).max(160),values:z.record(z.string(),z.unknown())})).max(100);

export async function executeCreationDirector(id:string,command:CreationDirectorCommand,ai?:NewDesignAiGateway):Promise<BookCreationSession>{
  if(await findDirectorReceipt(id,command))return getBookCreationSession(id);
  let session=await getBookCreationSession(id);if(session.revision!==command.expectedRevision)throw new NewDesignError("开书草稿已更新，请保存或读取最新内容后继续。",409);
  for(let count=0;count<CREATION_DIRECTOR_STAGES.length;count++){
    const claim=await claimDirectorStage(id,command,session.revision);
    try{
      if(!ai)throw new NewDesignError("AI 服务尚未连接，请检查模型设置后重试。",502);
      const stage=CREATION_DIRECTOR_STAGES[claim.state.cursor];
      if(stage.key==="direction"){
        const directions=directionsSchema.parse(await ai.generateDirections({method:claim.session.method,bookName:claim.session.bookName,sourceReference:claim.session.sourceReference,sourceText:claim.sourceText})) as BookDirectionCandidate[];
        session=await finishDirectorStage(id,claim,{directions});
      }else{
        const direction=claim.session.directionCandidates.find(item=>item.id===claim.session.selectedDirectionId);if(!direction)throw new NewDesignError("请先准备并选择创作方向。",422);
        const schemaTypes=claim.schemaTypes.filter(type=>(stage.typeKeys as readonly string[]).includes(type.key));
        if(!schemaTypes.length)session=await finishDirectorStage(id,claim,{cards:[],skipped:true});
        else{const cards=cardsSchema.parse(await ai.generateInitialContent({direction,sourceText:claim.sourceText,schemaTypes}));if(!cards.length)throw new NewDesignError("AI 没有准备当前阶段资料，请重试或人工接管。",422);session=await finishDirectorStage(id,claim,{cards});}
      }
    }catch(error){await failDirectorStage(id,claim.batchId,error);if(error instanceof NewDesignError)throw error;throw new NewDesignError("AI 当前阶段准备失败，已保留草稿，请重试。",502);}
    const next=creationDirectorState(session.inputPayload);if(next?.mode!=="automatic"||next.cursor>=CREATION_DIRECTOR_STAGES.length)break;
  }return session;
}
