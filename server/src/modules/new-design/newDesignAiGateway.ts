import type { NewDesignAiGateway } from "@ai-novel/new-design";
import { runStructuredPrompt } from "../../prompting/core/promptRunner";
import {
  newDesignBookDirectionsPrompt,
  newDesignFormAssistPrompt,
  newDesignInitialContentPrompt,
  newDesignMarketAnalysisPrompt,
} from "../../prompting/prompts/newDesign/newDesignBookCreation.prompts";
import { newDesignBookAnalysisPrompt } from "../../prompting/prompts/newDesign/newDesignResearch.prompts";

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
  async analyzeMarket(input) {
    const result=await runStructuredPrompt({asset:newDesignMarketAnalysisPrompt,promptInput:{itemsJson:JSON.stringify(input.items),focus:input.focus},options:{entrypoint:"new_design",stage:"market_analysis",temperature:0.35,maxTokens:input.budgetTokens}});
    return {output:result.output,promptSnapshot:{promptId:result.meta.invocation.promptId,promptVersion:result.meta.invocation.promptVersion},modelSnapshot:{provider:result.meta.provider??"configured-route",model:result.meta.model??"configured-route"},usedTokens:result.meta.tokenUsage?.totalTokens??0};
  },
  async analyzeBook(input){
    const result=await runStructuredPrompt({asset:newDesignBookAnalysisPrompt,promptInput:{title:input.title,text:input.text,focus:input.focus,planJson:JSON.stringify(input.plan),schemaJson:JSON.stringify(input.schemaTypes)},options:{entrypoint:"new_design",stage:input.plan.purpose==="diagnosis"?"manuscript_diagnosis":"book_analysis",temperature:0.25,maxTokens:input.budgetTokens}});
    return {output:result.output,promptSnapshot:{promptId:result.meta.invocation.promptId,promptVersion:result.meta.invocation.promptVersion},modelSnapshot:{provider:result.meta.provider??"configured-route",model:result.meta.model??"configured-route",usageReported:Boolean(result.meta.tokenUsage)},usedTokens:result.meta.tokenUsage?.totalTokens??0};
  },
};
