import {z} from "zod";
import {fieldInput,fieldOutput,typeInput,type PromptField} from "./fields";
import {directionSchema} from "./creationDirection";
import {BOOK_CREATION_METHODS} from "../../../common/contracts";
import type {FieldDefinition} from "../../../common/contracts";
import {formAiFieldVisible} from "../../../common/formAssist";
import {isBlankCreationReviewValue} from "../../../common/creationReviewAi";
import {selectableTreeNodeIds,validateTreeSelection} from "../../../common/treePolicy";
import {storyFormatSchema,shortStoryShapeIssues} from '../../../common/storyFormat';

const targetSchema=z.object({reviewCardId:z.uuid(),typeKey:z.string().min(1),isNew:z.boolean(),title:z.string().max(160),values:z.record(z.string(),z.unknown()),allowTitle:z.boolean(),fieldKeys:z.array(z.string()).max(300)}).strict();
const relationSpec=z.object({sourceId:z.uuid(),key:z.string(),label:z.string(),description:z.string(),direction:z.enum(["directed","undirected"]),sourceTypeKeys:z.array(z.string()),targetTypeKeys:z.array(z.string()),sourceMax:z.number().nullable(),targetMax:z.number().nullable(),fields:z.array(fieldInput),editable:z.boolean(),unavailableReason:z.string().nullable(),specificationHash:z.string()}).strict();
export const creationPreparationPromptInputSchema=z.object({
 contract:z.literal("creation_preparation_v1"),sessionId:z.uuid(),sessionRevision:z.number().int().positive(),
 specificationHash:z.string().regex(/^[a-f0-9]{64}$/),stage:z.enum(["direction","project","world","characters","skeleton"]).nullable(),
 mode:z.enum(["required","remaining","all"]),method:z.enum(BOOK_CREATION_METHODS),
 storyFormat:storyFormatSchema.nullable().optional(),
 bookName:z.string().max(300),sourceReference:z.string().max(30000),sourceText:z.string().max(400000),
 direction:directionSchema.nullable(),schemaTypes:z.array(typeInput).max(100),targets:z.array(targetSchema).max(300),
 contextCards:z.array(z.object({id:z.uuid(),typeKey:z.string(),title:z.string(),values:z.record(z.string(),z.unknown())}).strict()).max(300),
 catalog:z.object({templateVersionId:z.uuid(),reviewCardsHash:z.string(),dictionaries:z.array(z.object({id:z.uuid(),label:z.string(),nodes:z.array(z.object({id:z.uuid(),parentId:z.uuid().nullable(),label:z.string(),path:z.array(z.string())}).strict())}).strict()),relationSpecs:z.array(relationSpec),planningLevels:z.array(z.object({key:z.enum(["story","volume","chapter","scene"]),label:z.string(),parentLevel:z.enum(["story","volume","chapter","scene"]).nullable(),cardTypeKey:z.string().nullable()}).strict())}).strict(),
}).strict();
export type CreationPreparationPromptInput=z.infer<typeof creationPreparationPromptInputSchema>;
function unionOrEmpty(schemas:z.ZodType[]):z.ZodType{return schemas.length===0?z.never():schemas.length===1?schemas[0]!:z.union([schemas[0]!,schemas[1]!,...schemas.slice(2)]);}
const uuid=z.uuid();
const planningContent=z.object({goal:z.string().trim().min(1).max(3000),storyTime:z.string().max(1000),mustHappen:z.array(z.string().max(3000)).max(100),mustPreserve:z.array(z.string().max(3000)).max(100),forbiddenBoundaries:z.array(z.string().max(3000)).max(100),expectedChanges:z.array(z.string().max(3000)).max(100),characterArc:z.string().max(3000),notes:z.string().max(10000)}).strict();
const roleType:Record<string,string[]>={viewpoint:["character"],participant:["character"],location:["location"],event:["event"],foreshadow:["foreshadow"],item:["prop"],organization:["organization"]};
export function prepareCreationPreparationPrompt(value:unknown){
 const input=creationPreparationPromptInputSchema.parse(value);
 function creationFields(fields:PromptField[],allDeclared:boolean){
  const shape:Record<string,z.ZodType>=Object.create(null);
  for(const field of fields){if(field.hidden||field.aiSuggestible===false){if(field.required)throw new Error("必填字段禁止模型建议，请先人工填写。");continue;}
   const definition=field as unknown as FieldDefinition;let schema=fieldOutput({...field,required:allDeclared||field.required});
   if(definition.optionSource?.kind==="dictionary_tree"){
    const source=definition.optionSource,dictionary=input.catalog.dictionaries.find(dictionary=>dictionary.id===source.dictionaryId);if(!dictionary)throw new Error("字段字典不属于本次精确模板。");
    const allowed=selectableTreeNodeIds(dictionary.nodes,source.rule),choices=field.options.map(option=>option.value).filter(value=>allowed.has(value));
    if(field.type==="select"){if(!choices.length||source.rule.maxSelections===0||source.rule.minSelections>1)throw new Error("字典没有当前规则可选节点。");schema=z.enum(choices as [string,...string[]]);}
    else if(field.type==="multi_select"){const minimum=Math.max(allDeclared||field.required?1:0,source.rule.minSelections),maximum=source.rule.maxSelections??300;if(minimum>maximum||choices.length<minimum)throw new Error("字典可选节点数量不能满足正式规则。");schema=z.array(choices.length?z.enum(choices as [string,...string[]]):z.never()).min(minimum).max(maximum);}
   }
   shape[field.key]=allDeclared||field.required?schema:schema.optional();
  }
  return z.object(shape).strict();
 }
 const types=new Map(input.schemaTypes.map(type=>[type.key,type]));
 if(new Set(input.targets.map(target=>target.reviewCardId)).size!==input.targets.length)throw new Error("开书资料位置标识重复。");
 const cards=new Map(input.contextCards.map(card=>[card.id,{typeKey:card.typeKey}]));
 for(const target of input.targets)cards.set(target.reviewCardId,{typeKey:target.typeKey});
 const candidateSchemas=input.targets.map(target=>{
  const type=types.get(target.typeKey);if(!type)throw new Error("开书准备缺少正式内容类型。");
  const fields=type.fields.filter(field=>target.fieldKeys.includes(field.key));
  if(fields.length!==new Set(target.fieldKeys).size||fields.some(field=>!formAiFieldVisible(field as unknown as FieldDefinition,target.values)||field.aiSuggestible===false||!isBlankCreationReviewValue(target.values[field.key])))throw new Error("开书字段范围无效，不能覆盖已填写或不可见内容。");
  if(target.allowTitle&&!isBlankCreationReviewValue(target.title))throw new Error("已有资料名称不能作为空白候选覆盖。");
  return z.object({reviewCardId:z.literal(target.reviewCardId),typeKey:z.literal(target.typeKey),isNew:z.literal(target.isNew),titleSuggestion:target.allowTitle?z.string().trim().min(1).max(160):z.null(),values:creationFields(fields,true)}).strict();
 });
 const relationSchemas=input.catalog.relationSpecs.filter(spec=>spec.editable).flatMap(spec=>{
  const sources=[...cards].filter(([,card])=>!spec.sourceTypeKeys.length||spec.sourceTypeKeys.includes(card.typeKey)).map(([id])=>id),targets=[...cards].filter(([,card])=>!spec.targetTypeKeys.length||spec.targetTypeKeys.includes(card.typeKey)).map(([id])=>id);
  if(!sources.length||!targets.length)return[];
  return[z.object({id:uuid,relationTypeSourceId:z.literal(spec.sourceId),sourceReviewCardId:z.enum(sources as [string,...string[]]),targetReviewCardId:z.enum(targets as [string,...string[]]),properties:creationFields(spec.fields,false),decision:z.literal("pending")}).strict()];
 });
 const referenceSchemas=Object.entries(roleType).flatMap(([role,keys])=>{
  const ids=[...cards].filter(([,card])=>keys.includes(card.typeKey)).map(([id])=>id);if(!ids.length)return[];
  return[z.object({role:z.literal(role),reviewCardId:z.enum(ids as [string,...string[]]),action:role==="foreshadow"?z.enum(["plant","reinforce","recover","misdirect","reveal"]).nullable():z.null(),note:z.string().max(2000),sortOrder:z.number().int().min(0).max(1000000)}).strict()];
 });
 const planSchemas=input.catalog.planningLevels.map(level=>{
  const ids=[...cards].filter(([,card])=>card.typeKey===level.cardTypeKey).map(([id])=>id);
  const content=level.key==='story'&&input.storyFormat?planningContent.extend({storyFormat:z.object({form:z.literal(input.storyFormat.form),targetWordCount:z.literal(input.storyFormat.targetWordCount)}).strict()}):planningContent;
  return z.object({id:uuid,parentDraftId:level.parentLevel?uuid:z.null(),reviewCardId:level.cardTypeKey?(ids.length?z.enum(ids as [string,...string[]]):z.never()):z.null(),level:z.literal(level.key),title:z.string().trim().min(1).max(160),sortOrder:z.number().int().min(0).max(1000000),content,executionMode:z.enum(["manual","ai_assisted","automatic"]),references:z.array(unionOrEmpty(referenceSchemas)).max(200),decision:z.literal("pending")}).strict();
 });
 const schema=z.object({candidates:z.array(unionOrEmpty(candidateSchemas)).max(300),directions:z.array(directionSchema).max(input.stage==="direction"?5:0),relations:z.array(unionOrEmpty(relationSchemas)).max(input.stage===null?0:300),plans:z.array(unionOrEmpty(planSchemas)).max(input.stage==="skeleton"?300:0),notes:z.array(z.string().max(2000)).max(30)}).strict().superRefine((output,ctx)=>{
  const candidates=output.candidates as Array<{reviewCardId:string}>;
  if(new Set(candidates.map(card=>card.reviewCardId)).size!==candidates.length)ctx.addIssue({code:"custom",path:["candidates"],message:"资料位置不能重复。"});
  for(const target of input.targets)if(!candidates.some(card=>card.reviewCardId===target.reviewCardId))ctx.addIssue({code:"custom",path:["candidates"],message:"指定资料位置必须准备候选。"});
  if(input.stage==="direction"&&!output.directions.length)ctx.addIssue({code:"custom",path:["directions"],message:"请准备可选择的创作方向。"});
  if(input.stage!=="direction"&&output.directions.length)ctx.addIssue({code:"custom",path:["directions"],message:"当前阶段不能替换创作方向。"});
 const plans=output.plans as Array<{id:string;parentDraftId:string|null;level:string}>,byId=new Map(plans.map(plan=>[plan.id,plan]));
  if(input.stage==='skeleton')for(const message of shortStoryShapeIssues((output.plans as Array<{level:string;content:{storyFormat?:import('../../../common/storyFormat').StoryFormat}}>).map(plan=>({...plan,decision:'adopt'})),input.storyFormat??null,true))ctx.addIssue({code:'custom',path:['plans'],message});
  if(byId.size!==plans.length)ctx.addIssue({code:"custom",path:["plans"],message:"规划标识不能重复。"});
  for(const plan of plans){const parentLevel=input.catalog.planningLevels.find(level=>level.key===plan.level)?.parentLevel;if(parentLevel&&byId.get(plan.parentDraftId??"")?.level!==parentLevel)ctx.addIssue({code:"custom",path:["plans"],message:"规划必须使用同一候选结果中的合法父层级。"});}
  if(input.stage!=="skeleton"&&plans.length)ctx.addIssue({code:"custom",path:["plans"],message:"正式规划草稿只在骨架准备阶段产生。"});
  if(new Set((output.relations as Array<{id:string}>).map(item=>item.id)).size!==output.relations.length)ctx.addIssue({code:"custom",path:["relations"],message:"关系标识不能重复。"});
  if(new Set(output.directions.map(direction=>direction.id)).size!==output.directions.length)ctx.addIssue({code:"custom",path:["directions"],message:"方向标识不能重复。"});
  const pairs=new Set<string>();for(const [index,raw]of output.relations.entries()){
   const relation=raw as {relationTypeSourceId:string;sourceReviewCardId:string;targetReviewCardId:string};
   if(relation.sourceReviewCardId===relation.targetReviewCardId)ctx.addIssue({code:"custom",path:["relations",index],message:"关系必须连接两个不同的实际资料位置。"});
   const spec=input.catalog.relationSpecs.find(spec=>spec.sourceId===relation.relationTypeSourceId),pair=spec?.direction==="undirected"?[relation.sourceReviewCardId,relation.targetReviewCardId].sort().join(":"):`${relation.sourceReviewCardId}:${relation.targetReviewCardId}`,key=`${relation.relationTypeSourceId}:${pair}`;
   if(pairs.has(key))ctx.addIssue({code:"custom",path:["relations",index],message:"同一规格和两端资料的关系不能重复。"});pairs.add(key);
  }
  let roots=0;const planCards=new Set<string>(),orders=new Set<string>();for(const [index,raw]of output.plans.entries()){
   const plan=raw as {level:string;parentDraftId:string|null;reviewCardId:string|null;sortOrder:number;references:Array<{role:string;reviewCardId:string;action:string|null}>};
   if(plan.level==="story")roots++;
   if(plan.reviewCardId){if(planCards.has(plan.reviewCardId))ctx.addIssue({code:"custom",path:["plans",index,"reviewCardId"],message:"同一资料只能有一个正式规划草稿。"});planCards.add(plan.reviewCardId);}
   const order=`${plan.parentDraftId}:${plan.level}:${plan.sortOrder}`;if(orders.has(order))ctx.addIssue({code:"custom",path:["plans",index,"sortOrder"],message:"同一层级规划顺序不能重复。"});orders.add(order);
   const references=new Set<string>();for(const reference of plan.references){const key=`${reference.role}:${reference.reviewCardId}:${reference.action}`;if(references.has(key))ctx.addIssue({code:"custom",path:["plans",index,"references"],message:"同一用途不能重复引用同一资料。"});references.add(key);}
  }
  if(roots>1)ctx.addIssue({code:"custom",path:["plans"],message:"只能准备一个故事总纲。"});
  if(input.stage==="skeleton"&&input.schemaTypes.length){for(const level of input.catalog.planningLevels){if((!level.cardTypeKey||[...cards.values()].some(card=>card.typeKey===level.cardTypeKey))&&!plans.some(plan=>plan.level===level.key))ctx.addIssue({code:"custom",path:["plans"],message:`请准备“${level.label}”的真实规划草稿。`});}}
  if(input.stage===null&&output.relations.length)ctx.addIssue({code:"custom",path:["relations"],message:"表单补全不能另外建立关系草稿。"});
  const checkTree=(field:PromptField,value:unknown,path:(string|number)[])=>{const definition=field as unknown as FieldDefinition;if(definition.optionSource?.kind!=="dictionary_tree"||value===undefined||value===null)return;const source=definition.optionSource,dictionary=input.catalog.dictionaries.find(dictionary=>dictionary.id===source.dictionaryId),validation=dictionary?validateTreeSelection(dictionary.nodes,source.rule,Array.isArray(value)?value as string[]:[value as string]):null;if(!validation?.valid)ctx.addIssue({code:"custom",path,message:"字典选择不符合本模板正式树规则。"});};
  for(const [index,raw]of output.candidates.entries()){const candidate=raw as {reviewCardId:string;values:Record<string,unknown>},target=input.targets.find(target=>target.reviewCardId===candidate.reviewCardId);for(const field of types.get(target?.typeKey??"")?.fields??[])if(Object.hasOwn(candidate.values,field.key))checkTree(field,candidate.values[field.key],["candidates",index,"values",field.key]);}
  for(const [index,raw]of output.relations.entries()){const relation=raw as {relationTypeSourceId:string;properties:Record<string,unknown>};for(const field of input.catalog.relationSpecs.find(spec=>spec.sourceId===relation.relationTypeSourceId)?.fields??[])checkTree(field,relation.properties[field.key],["relations",index,"properties",field.key]);}
 });
 return{input,schema,describeOutputError(error:unknown,output:unknown){
  const first=error instanceof z.ZodError?error.issues[0]:null;let path=first?.path??[];const section=typeof path[0]==="string"?path[0]:"candidates",index=typeof path[1]==="number"?path[1]:null;
  const rows=output&&typeof output==="object"&&!Array.isArray(output)?(output as Record<string,unknown>)[section]:null,raw=index!==null&&Array.isArray(rows)&&rows[index]&&typeof rows[index]==="object"?rows[index] as Record<string,unknown>:{};
  const target=input.targets.find(target=>target.reviewCardId===raw.reviewCardId),type=target?types.get(target.typeKey):null;
  const relation=input.catalog.relationSpecs.find(spec=>spec.sourceId===raw.relationTypeSourceId),level=input.catalog.planningLevels.find(level=>level.key===raw.level);
  if(first&&"errors" in first&&Array.isArray(first.errors)){const nested=(first.errors as Array<Array<{path:PropertyKey[]}>>).flat(),allowed=new Set((type?.fields??relation?.fields??[]).map(field=>field.key)),located=nested.find(issue=>issue.path.some(part=>typeof part==="string"&&allowed.has(part)));if(located)path=located.path;}
  const field=(type?.fields??relation?.fields??[]).find(field=>path.includes(field.key));
  const labels:Record<string,string>={titleSuggestion:"资料名称",reviewCardId:"资料位置",typeKey:"内容类型",values:"填写内容",relationTypeSourceId:"关系规格",sourceReviewCardId:"关系来源",targetReviewCardId:"关系目标",properties:"关系属性",parentDraftId:"上级规划",level:"规划层级",title:"名称",sortOrder:"顺序",content:"规划内容",references:"规划引用",goal:"规划目标",notes:"说明",directions:"故事方向",plans:"规划草稿",relations:"关系草稿",candidates:"资料候选"};
  const leaf=[...path].reverse().find(part=>typeof part==="string"&&Object.hasOwn(labels,part)),position=section==="relations"?relation?.label??"关系草稿":section==="plans"?level?.label??"规划草稿":section==="directions"?"创作方向":type?.name??"资料候选";
  const summary=`${position}${index!==null?`第 ${index+1} 项`:""} · ${field?.name??(typeof leaf==="string"?labels[leaf]:"正式规格或填写值")}不符合本次冻结的表单要求。已保存人工内容保留；请在本次开书核对对应资料、字典或上级引用后明确重新准备，没有内容自动采用。`;
  const issueKey=target?`${target.reviewCardId}.${field?.key??"$title"}`:`${section}${index!==null?`.${index}`:""}`;
  return{summary,issues:{[issueKey]:summary}};
 }};
}
