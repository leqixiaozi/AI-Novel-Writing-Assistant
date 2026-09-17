import { z } from "zod";
import { COMPOSITION_TASK_KEYS, type CompositionTaskKey as ModelTaskKey } from "../../../common/promptComposition";
import type { CompositionSettings } from "../../../common/promptComposition";
import {knowledgeReferenceSchema} from "../knowledgeReference";
import {knowledgeSegmentSchema} from "../../../common/knowledgeIndex/segments";
export const taskSchema=z.enum(COMPOSITION_TASK_KEYS);
const variable=z.object({key:z.string().regex(/^[a-z][a-z0-9_]{0,79}$/).refine(key=>!["__proto__","constructor","prototype"].includes(key),"变量稳定键不能使用系统保留名称。"),label:z.string().trim().min(1).max(160),type:z.enum(["text","number","boolean","select"]),options:z.array(z.string().min(1).max(160)).max(100),defaultValue:z.union([z.string().max(10000),z.number().finite(),z.boolean()])}).strict().superRefine((item,ctx)=>{
  const valid=item.type==="number"?typeof item.defaultValue==="number":item.type==="boolean"?typeof item.defaultValue==="boolean":typeof item.defaultValue==="string";
  if(!valid||item.type==="select"&&(!item.options.length||!item.options.includes(String(item.defaultValue))))ctx.addIssue({code:"custom",path:["defaultValue"],message:"变量默认值必须符合类型，选项变量需选择有效选项。"});
  if(new Set(item.options).size!==item.options.length)ctx.addIssue({code:"custom",path:["options"],message:"变量选项不能重复。"});
});
export const settingsSchema=z.object({taskType:taskSchema,components:z.array(z.object({cardId:z.string().uuid(),versionId:z.string().uuid(),enabled:z.boolean()}).strict()).max(100),variables:z.array(variable).max(100),context:z.object({bookId:z.string().uuid().nullable(),sources:z.array(z.object({cardId:z.string().uuid(),versionId:z.string().uuid(),role:z.enum(["formal","reference"])}).strict()).max(100),knowledgeSources:z.array(knowledgeReferenceSchema.shape.sources.element.extend({segment:knowledgeSegmentSchema.optional()}).strict()).max(20).optional()}).strict()}).strict().superRefine((input,ctx)=>{
  for(const [name,keys] of [["components",input.components.map(item=>item.cardId)],["variables",input.variables.map(item=>item.key)],["sources",input.context.sources.map(item=>item.cardId)]] as const)if(new Set(keys).size!==keys.length)ctx.addIssue({code:"custom",path:[name],message:"同一组合中的组件、变量或资料不能重复。"});
  if(!input.context.bookId&&(input.context.sources.length||input.context.knowledgeSources?.length))ctx.addIssue({code:"custom",path:["context","bookId"],message:"选择参考资料前必须选择书籍。"});
  if(new Set(input.context.knowledgeSources?.map(item=>item.parsedVersionId)).size!==(input.context.knowledgeSources?.length??0))ctx.addIssue({code:"custom",path:["context","knowledgeSources"],message:"知识精确版本不能重复选择。"});
});
export const saveSchema=settingsSchema.safeExtend({id:z.string().uuid().nullable(),expectedRevision:z.number().int().positive().nullable(),name:z.string().trim().min(1).max(160),description:z.string().trim().max(1000),idempotencyKey:z.string().trim().min(8).max(160)}).superRefine((input,ctx)=>{if((input.id===null)!==(input.expectedRevision===null))ctx.addIssue({code:"custom",path:["expectedRevision"],message:"组合身份与修订必须同时提供。"});});
export const TASK_FAMILIES:Record<ModelTaskKey,string[]>= {directions:["ideation"],initial_content:["ideation","world_character"],form_assist:["form_card","world_character"],market_analysis:["resource_processing"],book_analysis:["resource_processing"],planning_candidate:["structure_planning"]};
export function variableSchema(input:CompositionSettings):Record<string,unknown>{
  const properties:Record<string,unknown>={};for(const item of input.variables)properties[item.key]={title:item.label,type:item.type==="number"?"number":item.type==="boolean"?"boolean":"string",...(item.type==="select"?{enum:item.options}:{}),default:item.defaultValue};
  return {type:"object",properties,required:input.variables.map(item=>item.key),additionalProperties:false};
}
