import {type ImageGenerationInput} from "../../../common/imageGeneration";
import {NewDesignError} from "../../domain/errors";
import {prepareImageGeneration,completeSavedImageGeneration,ImageGenerationError} from "../../database/imageGeneration";
import {executeImageProtocol} from "../../ai/imageGeneration";
import {writeImageReply} from "../../ai/imageGeneration/receipts";
export async function generateImageCandidate(input:ImageGenerationInput){const prepared=await prepareImageGeneration(input);if(!prepared.dispatch)return prepared.result;const dispatch=prepared.dispatch;try{const reply=await executeImageProtocol(dispatch.input,dispatch.connection,dispatch.credential);await writeImageReply({bookId:input.bookId,requestId:dispatch.requestId,attemptId:dispatch.attemptId,inputHash:dispatch.inputHash},reply);return await completeSavedImageGeneration(dispatch.requestId);}catch(error){throw new ImageGenerationError(error instanceof NewDesignError?error.message:'原图片生成结果尚未确认；画面输入与原请求保留，不自动重试。',error instanceof NewDesignError?error.status:503,input.bookId,'核对原单图调用与保存的原回复','unknown',error instanceof NewDesignError?error.issues:undefined);}}
