import type { BookAnalysisPlan, BookAnalysisResult, BookCreationMethod, BookDirectionCandidate, FieldDefinition, InitialCardDraft, MarketAnalysisResult, MarketRankingItem, PlanningLevel } from "../../common/contracts";

export interface AiSchemaType {
  key: string;
  name: string;
  description: string;
  fields: FieldDefinition[];
}

export interface DirectionGenerationInput {
  method: BookCreationMethod;
  bookName: string;
  sourceReference: string;
  sourceText: string;
}

export interface InitialContentGenerationInput {
  direction: BookDirectionCandidate;
  sourceText: string;
  schemaTypes: AiSchemaType[];
}

export interface FormAssistInput {
  bookName: string;
  formName: string;
  cardTitle: string;
  currentValues: Record<string, unknown>;
  fields: FieldDefinition[];
  instruction: string;
}

export interface MarketAnalysisInput {items:MarketRankingItem[];focus:string;budgetTokens:number;}
export interface AiResearchRunResult<T> {output:T;promptSnapshot:Record<string,unknown>;modelSnapshot:Record<string,unknown>;usedTokens:number;}
export interface BookAnalysisInput {title:string;text:string;focus:string;plan:BookAnalysisPlan;schemaTypes:AiSchemaType[];budgetTokens:number;}
export interface PlanningCandidateInput {bookName:string;bookDescription:string;target:{level:PlanningLevel;title:string;currentContent:Record<string,unknown>|null;parentContent:Record<string,unknown>|null};materials:Array<{cardId:string;typeKey:string;typeName:string;title:string;values:Record<string,unknown>}>;adoptedPlans:Array<{level:PlanningLevel;title:string;content:Record<string,unknown>}>;instruction:string;}
export interface PlanningCandidateOutput {title:string;goal:string;storyTime:string;mustHappen:string[];mustPreserve:string[];forbiddenBoundaries:string[];expectedChanges:string[];characterArc:string;notes:string;sourceCardIds:string[];}

export interface NewDesignAiGateway {
  generateCharacterExperiences?(input:import("../../common/characterExperiences").ExperienceSnapshot):Promise<AiResearchRunResult<import("../../common/characterExperiences").ExperienceOutput>>;
  generateStoryWorkspaceBatch?(input:import("../../common/storyWorkspace").StoryBatchPromptInput):Promise<AiResearchRunResult<import("../../common/storyWorkspace").StoryBatchOutput>>;
  generateDirections(input: DirectionGenerationInput): Promise<BookDirectionCandidate[]>;
  generateInitialContent(input: InitialContentGenerationInput): Promise<InitialCardDraft[]>;
  assistForm(input: FormAssistInput): Promise<Record<string, unknown>>;
  analyzeMarket(input:MarketAnalysisInput):Promise<AiResearchRunResult<MarketAnalysisResult>>;
  analyzeBook(input:BookAnalysisInput):Promise<AiResearchRunResult<BookAnalysisResult>>;
  generatePlanningCandidate(input:PlanningCandidateInput):Promise<AiResearchRunResult<PlanningCandidateOutput>>;
}
