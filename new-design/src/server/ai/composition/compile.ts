import type {DebugParameters} from "../../../common/promptComposition";
import type {CompositionTaskKey as ModelTaskKey} from "../../../common/promptComposition";
import type {DebugPreviewBundle,LoadedCompositionRecipe} from "../../database/promptComposition";
import {NewDesignError} from "../../domain/errors";
import {preparePrompt,type PreparedPrompt} from "../prompts";
import {buildDebugTaskInput,type TaskInputSources} from "./taskInput";

export function compositionVariables(recipe:LoadedCompositionRecipe["recipe"],values:Record<string,string|number|boolean>):Array<{label:string;value:string|number|boolean}> {
  const keys=new Set(recipe.variables.map(variable=>variable.key));
  if(!values||typeof values!=="object"||Array.isArray(values)||Object.keys(values).some(key=>!keys.has(key)))throw new NewDesignError("参数包含未声明的项目，请重新读取配方参数。",422,{variableValues:"只能填写此配方声明的参数。"});
  return recipe.variables.map(variable=>{
    const value=values[variable.key]??variable.defaultValue;
    const valid=variable.type==="number"?typeof value==="number"&&Number.isFinite(value):variable.type==="boolean"?typeof value==="boolean":typeof value==="string"&&value.length<=30000&&(variable.type!=="select"||variable.options.includes(value));
    if(!valid)throw new NewDesignError(`“${variable.label}”的参数格式或选项不正确。`,422,{[`variableValues.${variable.key}`]:`请修正“${variable.label}”。`});
    return {label:variable.label,value};
  });
}

export function supplementPreparedPrompt(taskType:ModelTaskKey,taskInput:Record<string,unknown>,loaded:LoadedCompositionRecipe,variables:Array<{label:string;value:string|number|boolean}>):PreparedPrompt {
  // Exact type/dictionary version provenance is retained in the frozen input, not sent as extra model context.
  const modelFields=(fields:unknown)=>Array.isArray(fields)?fields.map(field=>{
    if(!field||typeof field!=="object")return field;
    const {debugTypeVersionId:_typeVersion,debugDictionarySnapshot:_dictionary,...definition}=field as Record<string,unknown>;
    return definition;
  }):fields;
  const modelInput={...taskInput,...("fields" in taskInput?{fields:modelFields(taskInput.fields)}:{}),
    ...("schemaTypes" in taskInput&&Array.isArray(taskInput.schemaTypes)?{schemaTypes:taskInput.schemaTypes.map(type=>({...type,fields:modelFields(type.fields)}))}:{})};
  const prepared=preparePrompt(taskType,modelInput);
  if(loaded.recipe.taskType!==taskType)throw new NewDesignError("配方与受控任务不一致，请重新预览。",422);
  const supplementary={parameters:variables,components:loaded.components.filter(component=>component.enabled).map(component=>({title:component.title,content:component.content})),context:loaded.sources.map(source=>({cardId:source.cardId,versionId:source.versionId,title:source.title,role:source.role,values:source.values})),...(loaded.knowledgeSources?.length?{knowledgeReferences:loaded.knowledgeSources.map(source=>({kind:"untrusted_knowledge_reference",assetId:source.assetId,sourceVersionId:source.sourceVersionId,parsedAssetId:source.parsedAssetId,parsedVersionId:source.parsedVersionId,checksum:source.checksum,...(source.segment?{segment:source.segment}:{}),title:source.title,text:source.text}))}:{})};
  if(Buffer.byteLength(JSON.stringify(supplementary),"utf8")>1000000)throw new NewDesignError("选中的组件和参考资料过多，请减少后重新预览。",422);
  // Author-owned component trust labels are not an authorization source. No component becomes a system message.
  return {...prepared,messages:[...prepared.messages,{role:"user",content:JSON.stringify({supplementaryData:supplementary})}]};
}

export function compileDebugBundle(loaded:LoadedCompositionRecipe,parameters:DebugParameters,values:Record<string,string|number|boolean>,sources:TaskInputSources):DebugPreviewBundle {
  const taskInput=buildDebugTaskInput(loaded.recipe.taskType,parameters,sources),variables=compositionVariables(loaded.recipe,values);
  if(parameters.instruction.trim()&&["directions","initial_content"].includes(loaded.recipe.taskType))variables.push({label:"本次要求",value:parameters.instruction});
  const prepared=supplementPreparedPrompt(loaded.recipe.taskType,taskInput,loaded,variables);
  const estimatedInputUnits=Buffer.byteLength(JSON.stringify({messages:prepared.messages,outputSchema:prepared.outputSchema}),"utf8")+256;
  return {...loaded,taskInput,inputSchema:{type:"object",const:taskInput},messages:prepared.messages,outputSchema:prepared.outputSchema,assetId:prepared.assetId,assetVersion:prepared.version,contextPolicy:prepared.contextPolicy,temperature:prepared.temperature,maxTokens:prepared.maxTokens,variables,estimatedInputUnits};
}
