import type { BookAnalysisPlan, BookAnalysisResult, BookCreationMethod, BookDirectionCandidate, FieldDefinition, InitialCardDraft, MarketAnalysisResult, MarketRankingItem } from "../../common/contracts";

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

export interface NewDesignAiGateway {
  generateDirections(input: DirectionGenerationInput): Promise<BookDirectionCandidate[]>;
  generateInitialContent(input: InitialContentGenerationInput): Promise<InitialCardDraft[]>;
  assistForm(input: FormAssistInput): Promise<Record<string, unknown>>;
  analyzeMarket(input:MarketAnalysisInput):Promise<AiResearchRunResult<MarketAnalysisResult>>;
  analyzeBook(input:BookAnalysisInput):Promise<AiResearchRunResult<BookAnalysisResult>>;
}
