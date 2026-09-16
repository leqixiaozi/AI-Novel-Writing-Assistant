import {isDeepStrictEqual} from "node:util";
import type {FieldDefinition} from "../../../common/contracts";
import type {DebugPreviewBundle} from "../../database/promptComposition";
import {validateFieldValue} from "../../domain/validation";
import {AiExecutionError} from "../runtime/errors";
import type {PreparedPrompt} from "../prompts";
import {supplementPreparedPrompt} from "./compile";

/** A frozen request is data, not permission to replace the code-owned PromptAsset. */
export function replayDebugPrompt(bundle:DebugPreviewBundle):PreparedPrompt {
  const prepared=supplementPreparedPrompt(bundle.recipe.taskType,bundle.taskInput,bundle,bundle.variables);
  if(!isDeepStrictEqual(bundle.inputSchema,{type:"object",const:bundle.taskInput})||
    !isDeepStrictEqual(prepared.messages,bundle.messages)||!isDeepStrictEqual(prepared.outputSchema,bundle.outputSchema)||
    prepared.assetId!==bundle.assetId||prepared.version!==bundle.assetVersion||prepared.contextPolicy!==bundle.contextPolicy||
    prepared.temperature!==bundle.temperature||prepared.maxTokens!==bundle.maxTokens){
    throw new AiExecutionError("核对冻结请求","请求规格与受控任务不一致。请保留此记录，返回组合页生成新预览；本次模型请求尚未发送。",409);
  }
  return {...prepared,parseOutput(value){const output=prepared.parseOutput(value);validateDebugOutput(bundle,output);return output;}};
}

function validateValues(fields:FieldDefinition[],values:Record<string,unknown>):void {
  const byKey=new Map(fields.map(field=>[field.key,field]));
  for(const [key,value] of Object.entries(values)){
    const field=byKey.get(key);
    if(!field||field.hidden||field.aiSuggestible===false)throw new Error("结果包含本次范围之外的字段。");
    const issue=validateFieldValue({...field,required:false},value);
    if(issue)throw new Error(issue);
    if(field.optionSource?.kind==="dictionary_tree"){
      const choices=Array.isArray(value)?value:value===null||value===""?[]:[value];
      if(!field.optionSource.rule.aiSuggestible||new Set(choices).size!==choices.length||choices.some(item=>!field.options.some(option=>option.value===item)))throw new Error("结果包含冻结字典范围之外或重复的选择。");
    }
  }
}

export function validateDebugOutput(bundle:DebugPreviewBundle,output:unknown):void {
  const result=output as Record<string,any>,input=bundle.taskInput as Record<string,any>;
  if(bundle.recipe.taskType==="form_assist")validateValues(input.fields,result.suggestions);
  if(bundle.recipe.taskType==="initial_content"||bundle.recipe.taskType==="book_analysis"){
    const types=new Map<string,{fields:FieldDefinition[]}>((input.schemaTypes??[]).map((type:any)=>[type.key,type]));
    for(const card of (bundle.recipe.taskType==="initial_content"?result.cards:result.candidates)??[]){
      const type=types.get(card.typeKey??card.targetTypeKey);
      if(!type)throw new Error("结果包含本次范围之外的内容类型。");
      validateValues(type.fields,card.values);
    }
  }
}
