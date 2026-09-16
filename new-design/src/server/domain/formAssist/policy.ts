import { z } from "zod";
import { FORM_ASSIST_ACTIONS, formAiFieldVisible, type FormAssistCandidate, type FormAssistSnapshot } from "../../../common/formAssist";
import { selectableTreeNodeIds, validateTreeSelection } from "../../../common/treePolicy";
import { validateCardValues, validateFieldValue } from "../validation";

const targetSchema=z.object({bookId:z.string().uuid(),cardTypeId:z.string().uuid(),cardId:z.string().uuid().nullable(),typeVersionId:z.string().uuid(),cardRevision:z.number().int().positive().nullable(),formVersionId:z.string().uuid().nullable(),title:z.string().trim().min(1,"请填写资料标题。").max(160)}).superRefine((target,ctx)=>{if(Boolean(target.cardId)!==Boolean(target.cardRevision))ctx.addIssue({code:"custom",path:["cardRevision"],message:"资料身份与修订号不匹配。"});});
export const formAiRequestSchema=z.object({target:targetSchema,action:z.enum(FORM_ASSIST_ACTIONS),instruction:z.string().trim().min(1).max(2000),values:z.record(z.string(),z.unknown()),tagIds:z.array(z.string().uuid()).max(200).default([]),fieldKeys:z.array(z.string().min(1)).max(300).default([]),idempotencyKey:z.string().trim().min(8).max(160)});
export const formAiAdoptSchema=z.object({candidateId:z.string().uuid(),fieldKeys:z.array(z.string()).max(300),treeKeys:z.array(z.string()).max(100).default([]),values:z.record(z.string(),z.unknown()),tagIds:z.array(z.string().uuid()).max(200).default([]),idempotencyKey:z.string().trim().min(8).max(160)});
export const formAiDiscardSchema=z.object({idempotencyKey:z.string().trim().min(8).max(160)});
export const formAiNewNodeSchema=z.object({suggestionId:z.string().uuid(),name:z.string().trim().min(1).max(80),idempotencyKey:z.string().trim().min(8).max(160)});
export const formAiSaveSourcesSchema=z.object({aiDraftDecisionIds:z.array(z.string().uuid()).max(100).optional(),tagIds:z.array(z.string().uuid()).max(200).optional()});

export function blankFormValue(value:unknown):boolean{return value===null||value===undefined||value===""||Array.isArray(value)&&value.length===0;}
export function validateFormDraft(snapshot:FormAssistSnapshot,values:Record<string,unknown>):Record<string,string>{
  const result=validateCardValues(snapshot.fields.map(field=>({...field,required:false})),values),issues={...result.issues};
  for(const tree of snapshot.trees){if(tree.kind!=="dictionary"||blankFormValue(values[tree.key]))continue;const value=values[tree.key],ids=Array.isArray(value)?value:typeof value==="string"?[value]:[];const checked=validateTreeSelection(tree.nodes,tree.rule,ids as string[]);if(!checked.valid)issues[tree.key]=`${tree.name}：${checked.message}`;}
  return issues;
}
export function validateFormCandidate(snapshot:FormAssistSnapshot,candidate:FormAssistCandidate,action:string):Record<string,string>{
  const byKey=new Map(snapshot.fields.map(field=>[field.key,field])),issues:Record<string,string>={};
  for(const [key,value] of Object.entries(candidate.values)){const field=byKey.get(key);if(!field||!formAiFieldVisible(field,snapshot.values)||field.aiSuggestible===false){issues[key]="AI 返回了当前范围以外或不允许 AI 建议的字段。";continue;}const invalid=validateFieldValue({...field,required:false},value);if(invalid)issues[key]=invalid;if(action==="fill_empty"&&!blankFormValue(snapshot.values[key]))issues[key]="填写空白项不能修改已有内容。";const tree=snapshot.trees.find(item=>item.kind==="dictionary"&&item.key===key);if(tree&&!tree.rule.aiSuggestible)issues[key]="这个字典字段不允许 AI 建议。";if(tree&&!blankFormValue(value)){const ids=Array.isArray(value)?value:typeof value==="string"?[value]:[],checked=validateTreeSelection(tree.nodes,tree.rule,ids as string[]);if(!checked.valid)issues[key]=`${field.name}：${checked.message}`;}}
  for(const [key,ids] of Object.entries(candidate.tags)){const tree=snapshot.trees.find(item=>item.kind==="tag"&&item.key===key);if(!tree||!tree.rule.aiSuggestible){issues[key]="AI 返回了当前范围以外或不允许建议的标签维度。";continue;}const checked=validateTreeSelection(tree.nodes,tree.rule,ids);if(!checked.valid)issues[key]=`${tree.name}：${checked.message}`;}
  return issues;
}
export function aiFormFields(snapshot:FormAssistSnapshot,action:string,fieldKeys:string[]){
  const fields=action==="check"?[]:snapshot.fields.filter(field=>formAiFieldVisible(field,snapshot.values)&&field.aiSuggestible!==false&&(!fieldKeys.length||fieldKeys.includes(field.key))&&(field.optionSource?.kind!=="dictionary_tree"||field.optionSource.rule.aiSuggestible)&&(action!=="fill_empty"||blankFormValue(snapshot.values[field.key]))&&(action!=="recommend"||field.optionSource?.kind==="dictionary_tree")).map(field=>{const tree=snapshot.trees.find(item=>item.kind==="dictionary"&&item.key===field.key);return tree?{...field,required:false,options:tree.nodes.filter(node=>selectableTreeNodeIds(tree.nodes,tree.rule).has(node.id)).map(node=>({value:node.id,label:node.path.join(" / ")||node.name}))}:{...field,required:false};});
  const synthetic=(key:string,name:string,type:"short_text"|"long_text"|"multi_select",options:Array<{value:string;label:string}>=[])=>({key,name,type,description:"",required:false,defaultValue:null,options,group:"AI 建议",order:fields.length});
  if(action==="check")fields.push(synthetic("__observations","检查意见：说明矛盾位置、依据与不确定性；没有矛盾时明确说明","long_text"));
  if(action==="recommend")for(const tree of snapshot.trees){if(!tree.rule.aiSuggestible)continue;if(tree.kind==="tag")fields.push(synthetic(`__tags_${tree.key}`,`${tree.name}推荐标签：仅选择允许节点，遵守选择数量`,"multi_select",tree.nodes.filter(node=>selectableTreeNodeIds(tree.nodes,tree.rule).has(node.id)).map(node=>({value:node.id,label:node.path.join(" / ")||node.name}))));fields.push(synthetic(`__new_${tree.key}`,`${tree.name}建议新增项名称：仅在现有选项不适用时提出，不会自动创建`,"short_text"));}
  return fields;
}
