import type { BookCreationMethod, BookDirectionCandidate, FieldDefinition, InitialCardDraft } from "../../common/contracts";

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

export interface NewDesignAiGateway {
  generateDirections(input: DirectionGenerationInput): Promise<BookDirectionCandidate[]>;
  generateInitialContent(input: InitialContentGenerationInput): Promise<InitialCardDraft[]>;
  assistForm(input: FormAssistInput): Promise<Record<string, unknown>>;
}
