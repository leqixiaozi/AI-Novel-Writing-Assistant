import type { AiRuntimeRecovery } from "../../../common/aiRuntime";
import type {TechnicalFallbackCategory} from "../../../common/contracts";
import { NewDesignError } from "../../domain/errors";

/** Private diagnostic evidence, never public recovery copy or an adopted candidate. */
export interface FailedModelResponseEvidence {
  content:string|null;contentSha256:string|null;contentBytes:number;retainedBytes:number;truncated:boolean;
  finishReason:string|null;responseId:string|null;responseModel:string|null;maxOutputTokens:number;
  inputTokens:number|null;outputTokens:number|null;usedTokens:number;usageReported:boolean;capturedAt:string;
}

export class AiExecutionError extends NewDesignError {
  readonly recovery:AiRuntimeRecovery;
  executionSnapshot?:Record<string,unknown>;
  transportReceipt?:{responseReceived:true;usedTokens:number;usageReported:boolean;inputTokens:number|null;outputTokens:number|null;responseEvidence?:FailedModelResponseEvidence};
  constructor(failedStep:string,message:string,status=502,readonly category:TechnicalFallbackCategory|null=null,issues?:Record<string,string>) {
    super(message,status,issues);
    this.recovery={failedStep,summary:message,savedResult:"本次调用未确认生成成功；已有资料和人工编辑不会由模型调用覆盖。返回来源页核对候选状态后再重试。",actionLabel:"打开模型设置",sourceRoute:"/new-design/structure/models"};
  }
}
