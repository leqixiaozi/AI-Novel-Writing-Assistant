import type { NewDesignAiGateway } from "@ai-novel/new-design";
import { runStructuredPrompt } from "../../prompting/core/promptRunner";
import {
  newDesignBookDirectionsPrompt,
  newDesignFormAssistPrompt,
  newDesignInitialContentPrompt,
} from "../../prompting/prompts/newDesign/newDesignBookCreation.prompts";

export const newDesignAiGateway: NewDesignAiGateway = {
  async generateDirections(input) {
    const result = await runStructuredPrompt({
      asset: newDesignBookDirectionsPrompt,
      promptInput: input,
      options: { entrypoint: "new_design", stage: "book_direction", temperature: 0.72 },
    });
    return result.output.directions;
  },
  async generateInitialContent(input) {
    const result = await runStructuredPrompt({
      asset: newDesignInitialContentPrompt,
      promptInput: {
        direction: input.direction,
        sourceText: input.sourceText,
        schemaJson: JSON.stringify(input.schemaTypes),
      },
      options: { entrypoint: "new_design", stage: "initial_content", temperature: 0.55, maxTokens: 8000 },
    });
    return result.output.cards;
  },
  async assistForm(input) {
    const result = await runStructuredPrompt({
      asset: newDesignFormAssistPrompt,
      promptInput: {
        bookName: input.bookName,
        formName: input.formName,
        cardTitle: input.cardTitle,
        currentValuesJson: JSON.stringify(input.currentValues),
        fieldsJson: JSON.stringify(input.fields),
        instruction: input.instruction,
      },
      options: { entrypoint: "new_design", stage: "form_assist", temperature: 0.45, maxTokens: 3000 },
    });
    return result.output.suggestions;
  },
};
