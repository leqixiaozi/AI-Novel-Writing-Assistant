import {z} from "zod";
import type {PoolClient} from "pg";
import type {SettlementRelationDefinition} from "../../../../common/chapterSettlementEditing";
import {fieldDefinitionSchema,validateFieldValue} from "../../../domain/validation";
import {NewDesignError} from "../../../domain/errors";
import {validateDictionaryTreeBindings,validateDictionaryTreeValues} from "../../treeResources";
import {SettlementEditingError} from "../editingPolicy";

const key=z.string().regex(/^[a-z][a-z0-9_-]{1,62}$/);
const strictFields=z.array(fieldDefinitionSchema.strict().transform(field=>({...field,defaultValue:field.defaultValue??null}))).max(100).superRefine((fields,ctx)=>{if(new Set(fields.map(f=>f.key)).size!==fields.length)ctx.addIssue({code:"custom",message:"关系字段标识不能重复。"});});
export function parseExistingField(value:unknown,index:number){if(!value||typeof value!=="object"||Array.isArray(value))return null;const raw=value as Record<string,unknown>;const parsed=fieldDefinitionSchema.strict().safeParse({...raw,order:raw.order??index});return parsed.success?parsed.data:null;}
export const settlementRelationDefinitionSchema=z.object({name:z.string().trim().min(1).max(80),description:z.string().max(500),direction:z.enum(["directed","undirected"]),sourceTypeKeys:z.array(key).max(100),targetTypeKeys:z.array(key).max(100),sourceMax:z.number().int().positive().nullable(),targetMax:z.number().int().positive().nullable(),fields:strictFields,capability:z.enum(["disabled","optional","required"]),mode:z.enum(["none","relation_state","lifecycle"]),dimensions:z.array(z.object({fieldKey:key,label:z.string().trim().min(1).max(80),direction:z.enum(["forward","inverse","bidirectional"]),policy:z.enum(["tracked","derived","lifecycle_only"]),mode:z.enum(["absolute","delta","derived","lifecycle"])}).strict()).max(100)}).strict().superRefine((value,ctx)=>{
  if(new Set(value.sourceTypeKeys).size!==value.sourceTypeKeys.length||new Set(value.targetTypeKeys).size!==value.targetTypeKeys.length)ctx.addIssue({code:"custom",message:"允许的内容类型不能重复。"});
  if((value.capability==="disabled")!==(value.mode==="none"))ctx.addIssue({code:"custom",path:["mode"],message:"停用结算必须选择不结算模式；启用结算必须选择实际状态模式。"});
  if(value.capability!=="disabled"&&!value.dimensions.some(d=>d.policy!=="derived"))ctx.addIssue({code:"custom",path:["dimensions"],message:"启用结算至少需要一个对应正式字段的可结算维度。"});
  if(new Set(value.dimensions.map(item=>item.fieldKey)).size!==value.dimensions.length)ctx.addIssue({code:"custom",path:["dimensions"],message:"结算维度不能重复。"});
  for(const [index,item] of value.dimensions.entries()){
    const field=value.fields.find(field=>field.key===item.fieldKey);
    if(!field)ctx.addIssue({code:"custom",path:["dimensions",index,"fieldKey"],message:"结算维度必须对应实际正式字段。"});
    if(item.mode==="delta"&&field?.type!=="number")ctx.addIssue({code:"custom",path:["dimensions",index,"mode"],message:"增减模式只能用于数值字段。"});
    if((item.policy==="derived")!==(item.mode==="derived")||(item.policy==="lifecycle_only")!==(item.mode==="lifecycle"))ctx.addIssue({code:"custom",path:["dimensions",index,"mode"],message:"维度策略与状态模式不一致。"});
    if(value.mode==="lifecycle"&&item.policy!=="derived"&&item.mode!=="lifecycle")ctx.addIssue({code:"custom",path:["dimensions",index,"mode"],message:"生命周期能力只能发布生命周期维度。"});
  }
  for(const field of value.fields)if(["__proto__","constructor","prototype"].includes(field.key))ctx.addIssue({code:"custom",path:["fields"],message:"字段标识不可使用保留名称。"});
});
const base={requestKey:z.string().trim().min(8).max(160),actor:z.string().trim().min(1).max(120).optional()};
export const settlementRelationDraftInputSchema=z.object({...base,draftId:z.string().uuid().optional(),expectedRevision:z.number().int().positive().optional(),relationTypeId:z.string().uuid().nullable().optional(),sourceRelationTypeId:z.string().uuid().nullable().optional(),expectedRelationTypeRevision:z.number().int().positive().nullable(),definition:settlementRelationDefinitionSchema}).strict().superRefine((v,c)=>{if(Boolean(v.draftId)!==Boolean(v.expectedRevision))c.addIssue({code:"custom",path:["expectedRevision"],message:"编辑既有草稿必须提供读取时的草稿版本。"});if(Boolean(v.relationTypeId||v.sourceRelationTypeId)!==(v.expectedRelationTypeRevision!==null))c.addIssue({code:"custom",path:["expectedRelationTypeRevision"],message:"请选择真实关系规格并提供读取时的正式版本。"});if(v.relationTypeId&&v.sourceRelationTypeId)c.addIssue({code:"custom",message:"请选择本书目标或系统来源，不能同时指定。"});});
export const settlementRelationPublishInputSchema=z.object({...base,draftId:z.string().uuid(),expectedRevision:z.number().int().positive(),confirmPublish:z.boolean(),confirmInstanceRebind:z.boolean(),rebindRelations:z.array(z.object({id:z.string().uuid(),expectedRevision:z.number().int().positive()}).strict()).max(200),createRelations:z.array(z.object({sourceCardId:z.string().uuid(),targetCardId:z.string().uuid()}).strict()).max(100).optional()}).strict();
export function relationError(bookId:string,message:string,status=422,issues?:Record<string,string>):never{
  const error=new SettlementEditingError(message,status,null,issues,"核对关系规格");
  error.recovery.sourceRoute=`/new-design/structure/dictionaries-relations?view=relations&book=${bookId}`;
  error.recovery.actionLabel="打开关系配置";
  error.recovery.savedResult="已保存的关系规格、草稿和章节清单保留；请核对原请求回执。";
  throw error;
}
export async function validateDefinition(client:PoolClient,bookId:string,spaceId:string,definition:SettlementRelationDefinition):Promise<void>{
  const types=(await client.query("SELECT id,type_key FROM new_design.card_types WHERE status='published' AND current_version_id IS NOT NULL AND space_id IN ($1,'00000000-0000-4000-8000-000000000001') FOR SHARE",[spaceId])).rows;
  for(const key of [...definition.sourceTypeKeys,...definition.targetTypeKeys])if(!types.some(row=>row.type_key===key))relationError(bookId,"允许的内容类型已失效，请重新选择。",409);
  for(const field of definition.fields){
    if(field.optionSource?.kind==="dictionary_tree"){
      const dictionary=(await client.query("SELECT id FROM new_design.dictionary_definitions WHERE id=$1 AND status='published' AND (owner_space_id=$2 OR owner_space_id IS NULL) FOR SHARE",[field.optionSource.dictionaryId,spaceId])).rows[0];
      if(!dictionary)relationError(bookId,`${field.name}的字典不是本书可用的正式字典。`,422,{[field.key]:"请选择正式字典。"});
      await client.query("SELECT id FROM new_design.dictionary_items WHERE dictionary_id=$1 FOR SHARE",[field.optionSource.dictionaryId]);
    }
    if(field.defaultValue!==undefined&&field.defaultValue!==null){const message=validateFieldValue(field,field.defaultValue);if(message)relationError(bookId,message,422,{[field.key]:message});}
  }
  const issues=await validateDictionaryTreeBindings(client,definition.fields);
  const defaultFields=definition.fields.filter(f=>f.defaultValue!==undefined&&f.defaultValue!==null);
  Object.assign(issues,await validateDictionaryTreeValues(client,defaultFields,Object.fromEntries(defaultFields.map(f=>[f.key,f.defaultValue]))));
  if(Object.keys(issues).length)relationError(bookId,"字典范围或默认值无效，请修改标识字段。",422,issues);
}
export function parsedDefinition(value:unknown):SettlementRelationDefinition|null{const result=settlementRelationDefinitionSchema.safeParse(value);return result.success?result.data as SettlementRelationDefinition:null;}
export function normalizeError(bookId:string,error:unknown,rolledBack:boolean,committing:boolean):never{
  if(rolledBack&&!committing){const wrapped=error instanceof SettlementEditingError?error:error instanceof NewDesignError?new SettlementEditingError(error.message,error.status,null,error.issues,"核对关系规格"):new SettlementEditingError("关系配置未完成，服务器已确认回滚；请保留草稿，修复服务后重新读取并明确准备保存或发布。",503,null,undefined,"保存关系配置");wrapped.recovery.sourceRoute=`/new-design/structure/dictionaries-relations?view=relations&book=${bookId}`;wrapped.recovery.actionLabel="打开关系配置";wrapped.recovery.mutationOutcome="not_written";wrapped.recovery.savedResult="本次未写入；已保存的草稿、正式规格和清单保留。";throw wrapped;}
  relationError(bookId,"关系配置写入结果尚未确认，请按原请求核对回执，勿重复发布。",503);
}
