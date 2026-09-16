import type {FieldDefinition} from "../../../common/contracts";
import type {ProfessionalSourceAction} from "../../../common/worldCharacterMaintenance";
import {fieldDefinitionSchema} from "../../domain/validation";
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function professionalFields(value:unknown):FieldDefinition[]{if(!Array.isArray(value))return[];return value.flatMap(item=>{const parsed=fieldDefinitionSchema.safeParse(item);return parsed.success?[{...parsed.data,defaultValue:parsed.data.defaultValue??null}]:[];});}
export function professionalDisplay(value:unknown,field:FieldDefinition|undefined,objectLabels:Map<string,string>,dictionaryLabels:Map<string,string>):string {
 if(value===null||value===undefined||value==="")return "未设置";
 if(Array.isArray(value))return value.map(item=>professionalDisplay(item,field,objectLabels,dictionaryLabels)).join("、")||"未设置";
 if(typeof value==="boolean")return value?"是":"否";
 if(typeof value==="number")return Number.isFinite(value)?String(value):"历史数值需核对";
 if(typeof value!=="string")return "结构化历史值，请打开来源表单核对";
 if(field?.optionSource?.kind==="dictionary_tree")return dictionaryLabels.get(`${field.optionSource.dictionaryId}:${value}`)??"历史字典选项需核对";
 if(field?.type==="select"||field?.type==="multi_select")return field.options.find(option=>option.value===value)?.label??"历史选项需核对";
 if(uuid.test(value))return objectLabels.get(value)??"历史资料引用不可用";
 return value;
}
export function professionalWritingAction(bookId:string,documentId:string|null,sessionId:string|null,subjectId?:string):ProfessionalSourceAction {
 const query=new URLSearchParams();if(documentId&&uuid.test(documentId))query.set("chapterDocument",documentId);if(sessionId&&uuid.test(sessionId))query.set("session",sessionId);if(subjectId&&uuid.test(subjectId)&&sessionId)query.set("subject",subjectId);
 return{label:sessionId?"打开来源章节确认":documentId?"打开来源章节重新准备":"进入章节创作建立来源",route:`/new-design/books/${bookId}/writing${query.size?`?${query}`:""}`};
}
export function professionalRelationAction(bookId:string):ProfessionalSourceAction {return{label:"打开本书关系配置",route:`/new-design/structure/dictionaries-relations?view=relations&book=${bookId}`};}
