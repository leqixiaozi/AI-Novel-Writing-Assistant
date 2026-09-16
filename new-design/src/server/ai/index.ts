import type { BookAnalysisResult, BookDirectionCandidate, InitialCardDraft, MarketAnalysisResult } from "../../common/contracts";
import type { AiResearchRunResult, NewDesignAiGateway, PlanningCandidateOutput } from "./gateway";
import { preparePrompt, type PromptTaskType } from "./prompts";
import { readModelConfiguration } from "./runtime/configuration";
import { AiExecutionError } from "./runtime/errors";
import { invokeStructuredModel } from "./runtime/transport";

export { getIndependentModelStatus, readModelConfiguration } from "./runtime/configuration";
export { probeModelConnection } from "./runtime/transport";
export { AiExecutionError } from "./runtime/errors";

export function createIndependentAiGateway(options:{fetcher?:typeof fetch;environment?:NodeJS.ProcessEnv}={}):NewDesignAiGateway {
  async function execute<T>(taskType:PromptTaskType,input:unknown):Promise<AiResearchRunResult<T>> {
    const config=readModelConfiguration(options.environment);
    let prompt;
    try {prompt=preparePrompt(taskType,input);}catch{throw new AiExecutionError("准备创作资料","创作资料与当前表单规格不一致，请回来源页检查必填信息和可用内容类型。",422);}
    const result=await invokeStructuredModel(config,prompt,options.fetcher);
    let output:T;
    try {output=prompt.parseOutput(result.value) as T;}catch{throw new AiExecutionError("核对创作结果","模型生成结果不符合此任务的表单规格。本次回复未采用，请在来源页重试生成或检查模型设置。");}
    return {output,usedTokens:result.usedTokens,promptSnapshot:{assetId:prompt.assetId,version:prompt.version,taskType,contextPolicy:prompt.contextPolicy,outputSchema:prompt.outputSchema},modelSnapshot:{provider:config.provider,model:config.model,configurationHash:config.identity,timeoutMs:config.timeoutMs,maxTokens:Math.min(config.maxTokens,prompt.maxTokens),temperature:prompt.temperature,usageReported:result.usageReported,usageStatus:result.usageReported?"reported":"unavailable",retryCount:0,independent:true}};
  }
  return {
    generateDirections:async input=>(await execute<{directions:BookDirectionCandidate[]}>("directions",input)).output.directions,
    generateInitialContent:async input=>(await execute<{cards:InitialCardDraft[]}>("initial_content",input)).output.cards,
    assistForm:async input=>(await execute<{suggestions:Record<string,unknown>}>("form_assist",input)).output.suggestions,
    analyzeMarket:input=>execute<MarketAnalysisResult>("market_analysis",input),
    analyzeBook:input=>execute<BookAnalysisResult>("book_analysis",input),
    generatePlanningCandidate:input=>execute<PlanningCandidateOutput>("planning_candidate",input),
  };
}
