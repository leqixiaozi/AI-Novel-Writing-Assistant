import type { BookAnalysisResult, BookDirectionCandidate, InitialCardDraft, MarketAnalysisResult } from "../../common/contracts";
import type { AiResearchRunResult, NewDesignAiGateway, PlanningCandidateOutput } from "./gateway";
import { storyBatchTask,preparePrompt, type PromptTaskType } from "./prompts";
import { AiExecutionError } from "./runtime/errors";
import { executeManagedPrompt, type ExecutionDependencies } from "./runtime/managedExecution";

export { readModelConfiguration } from "./runtime/configuration";
export { getIndependentModelStatus,getIndependentTaskAvailability } from "./runtime/managedStatus";
export { probeManagedModelConnection,configurationForConnection } from "./runtime/managedExecution";
export { probeModelConnection } from "./runtime/transport";
export { AiExecutionError } from "./runtime/errors";
export {executeManagedPrompt} from "./runtime/managedExecution";

export function createIndependentAiGateway(options:ExecutionDependencies={}):NewDesignAiGateway {
  async function execute<T>(taskType:Exclude<PromptTaskType,"stable_resource_supplement"|"stable_resource_correction"|"public_title_factory">,input:unknown):Promise<AiResearchRunResult<T>> {
    let prompt;
    try {prompt=preparePrompt(taskType,input);}catch{throw new AiExecutionError("准备创作资料","创作资料与当前表单规格不一致，请回来源页检查必填信息和可用内容类型。",422);}
    const visible=taskType==="character_resource_focus"||taskType==="character_resource_history_focus"||taskType==="character_experiences"||taskType==="character_recent_body_experiences"||taskType==="visible_prepare"||taskType==="visible_adjust";
    const managedTask=taskType==="image_prompt_preparation"?"form_assist":(taskType==="public_character_dialogue"||taskType==="character_author")?"character_dialogue":taskType==="character_resource_backfill"?"chapter_settlement":visible?"form_assist":taskType==="world_usage"?"planning_candidate":taskType==="story_workspace_batch"?((input as import("../../common/storyWorkspace").StoryBatchPromptInput).mode==="setting"?"form_assist":"planning_candidate"):taskType;
    let result;
    try{result=await executeManagedPrompt<T>(managedTask,prompt,(taskType==="story_workspace_batch"||taskType==="world_usage"||visible)?{...options,stopOnUnknownResponse:true}:options);}catch(error){if((taskType==="story_workspace_batch"||taskType==="world_usage"||visible)&&error instanceof AiExecutionError&&!error.executionSnapshot)error.executionSnapshot={attempts:[],usageStatus:"not_invoked",knownTokens:0};throw error;}
    return {...result,promptSnapshot:{assetId:prompt.assetId,version:prompt.version,taskType,contextPolicy:prompt.contextPolicy,outputSchema:prompt.outputSchema},modelSnapshot:{...result.modelSnapshot,temperature:prompt.temperature}};
  }
  return {
    diagnoseCreativeHub:input=>execute<import('../../common/creativeHub').CreativeHubDiagnostic>('creative_hub',input),
    generateWorldCandidate:input=>execute<import('../../common/worldGeneration').WorldGenerationCandidateContent>('world_generation',input),
    suggestWorldUsage:input=>execute<import('../../common/worldUsage').WorldUsageSelection>('world_usage',input),
    generateCharacterRecentBodyExperiences:input=>execute<import('../../common/characterExperiences/recentBodies').RecentBodyExperienceOutput>('character_recent_body_experiences',input),
    generateCharacterResourceHistoryFocus:input=>execute<import("../../common/characterResources/focus").ResourceFocusOutput>("character_resource_history_focus",input),
    generateCharacterResourceFocus:input=>execute<import("../../common/characterResources/focus").ResourceFocusOutput>("character_resource_focus",input),
    generateCharacterExperiences:input=>execute<import("../../common/characterExperiences").ExperienceOutput>("character_experiences",input),
    generateDirections:async input=>(await execute<{directions:BookDirectionCandidate[]}>("directions",input)).output.directions,
    generateInitialContent:async input=>(await execute<{cards:InitialCardDraft[]}>("initial_content",input)).output.cards,
    assistForm:async input=>(await execute<{suggestions:Record<string,unknown>}>("form_assist",input)).output.suggestions,
    analyzeMarket:input=>execute<MarketAnalysisResult>("market_analysis",input),
    analyzeBook:input=>execute<BookAnalysisResult>("book_analysis",input),
    generateStoryWorkspaceBatch:input=>execute<import("../../common/storyWorkspace").StoryBatchOutput>(storyBatchTask(input.mode),input),
    generatePlanningCandidate:input=>execute<PlanningCandidateOutput>("planning_candidate",input),
  };
}
