import type { BookAnalysisResult, BookDirectionCandidate, InitialCardDraft, MarketAnalysisResult } from "../../common/contracts";
import type { AiResearchRunResult, NewDesignAiGateway, PlanningCandidateOutput } from "./gateway";
import { preparePrompt, type PromptTaskType } from "./prompts";
import { AiExecutionError } from "./runtime/errors";
import { executeManagedPrompt, type ExecutionDependencies } from "./runtime/managedExecution";

export { readModelConfiguration } from "./runtime/configuration";
export { getIndependentModelStatus } from "./runtime/managedStatus";
export { probeManagedModelConnection } from "./runtime/managedExecution";
export { probeModelConnection } from "./runtime/transport";
export { AiExecutionError } from "./runtime/errors";
export {executeManagedPrompt} from "./runtime/managedExecution";

export function createIndependentAiGateway(options:ExecutionDependencies={}):NewDesignAiGateway {
  async function execute<T>(taskType:PromptTaskType,input:unknown):Promise<AiResearchRunResult<T>> {
    let prompt;
    try {prompt=preparePrompt(taskType,input);}catch{throw new AiExecutionError("准备创作资料","创作资料与当前表单规格不一致，请回来源页检查必填信息和可用内容类型。",422);}
    const result=await executeManagedPrompt<T>(taskType,prompt,options);
    return {...result,promptSnapshot:{assetId:prompt.assetId,version:prompt.version,taskType,contextPolicy:prompt.contextPolicy,outputSchema:prompt.outputSchema},modelSnapshot:{...result.modelSnapshot,temperature:prompt.temperature}};
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
