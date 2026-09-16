import type { CardGroupFormSummary, TemplateGroupSummary, TemplateGroupVersion } from "../common/contracts";
import {normalizeFormLocalField} from "../common/formLocalFieldNormalization";

function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
export function structureDraftHash(value: CardGroupFormSummary | TemplateGroupSummary): string {
  return JSON.stringify(canonical({id:value.id,key:value.key,name:value.name,description:value.description,
    definition:"draftDefinition" in value ? value.draftDefinition : value.draftConfig}));
}
export function normalizedStructureDraft<T extends CardGroupFormSummary|TemplateGroupSummary>(draft:T):T {
  const value=structuredClone(draft);value.key=value.key.trim();value.name=value.name.trim();value.description=value.description.trim();
  if("draftDefinition" in value){value.draftDefinition.primaryTypeKey=value.draftDefinition.primaryTypeKey.trim();for(const group of value.draftDefinition.groups){group.key=group.key.trim();group.name=group.name.trim();for(const section of group.sections){section.key=section.key.trim();section.name=section.name.trim();for(const slot of section.slots){slot.key=slot.key.trim();slot.name=slot.name.trim();slot.allowedTypeKeys=slot.allowedTypeKeys.map(key=>key.trim());if(slot.relationTypeKey!==undefined)slot.relationTypeKey=slot.relationTypeKey.trim();slot.localFields=slot.localFields.map(normalizeFormLocalField);}}}}
  return value;
}
export function newStructureKey(kind:"form"|"template"):string {
  return `${kind}_${crypto.randomUUID().replaceAll("-", "")}`;
}
export function structureIssueLabel(draft:CardGroupFormSummary|TemplateGroupSummary,path:string):string {
  const labels:Record<string,string>={name:"名称",key:"内部标识",description:"用途说明",min:"最少数量",max:"最多数量",relationTypeKey:"资料关系",allowedTypeKeys:"允许添加的资料",primaryTypeKey:"主要内容类型",defaultValue:"默认值",options:"选项",optionSource:"字典来源",requestKey:"原请求凭证",revision:"来源修订",slots:"资料位置",sections:"资料区块",groups:"分组",localFields:"补充字段"};
  const parts=path.split('.'),names:string[]=[];
  if('draftDefinition' in draft){const groupIndex=parts.indexOf('groups'),sectionIndex=parts.indexOf('sections'),slotIndex=parts.indexOf('slots'),fieldIndex=parts.indexOf('localFields');const group=groupIndex>=0?draft.draftDefinition.groups[Number(parts[groupIndex+1])]:undefined,section=sectionIndex>=0?group?.sections[Number(parts[sectionIndex+1])]:undefined,slot=slotIndex>=0?section?.slots[Number(parts[slotIndex+1])]:undefined,field=fieldIndex>=0?slot?.localFields[Number(parts[fieldIndex+1])]:undefined;if(group)names.push(group.name);if(section)names.push(section.name);if(slot)names.push(slot.name);if(field)names.push(field.name);}
  names.push(labels[parts.at(-1)??'']??'来源规格需核对');return names.join('／');
}
export function templateConflictLabel(version:TemplateGroupVersion|undefined,typeKey:string,fieldKey:string):string {
  if(typeKey==="字典树"){const dictionaries=version?.payload.dictionaries;if(Array.isArray(dictionaries)&&dictionaries.some(value=>Array.isArray(value?.items)&&value.items.some((item:{label?:unknown})=>item.label===fieldKey)))return `字典树／${fieldKey}`;}
  if(typeKey==="标签树"){const dimensions=version?.payload.tagDimensions;if(Array.isArray(dimensions)&&dimensions.some(value=>Array.isArray(value?.nodes)&&value.nodes.some((item:{name?:unknown})=>item.name===fieldKey)))return `标签树／${fieldKey}`;}
  if(typeKey==="标签规则"){const bindings=version?.payload.tagBindings,types=version?.payload.cardTypes,dimensions=version?.payload.tagDimensions;if(Array.isArray(bindings)&&Array.isArray(types)&&Array.isArray(dimensions)){const binding=bindings.find(value=>`${value?.sourceTypeId}:${value?.sourceDimensionId}`===fieldKey),type=types.find(value=>value?.sourceId===binding?.sourceTypeId),dimension=dimensions.find(value=>value?.sourceId===binding?.sourceDimensionId);if(binding&&typeof type?.name==='string'&&typeof dimension?.name==='string')return `${type.name}／${dimension.name}标签规则`;}}
  const types=version?.payload.cardTypes;
  if(!Array.isArray(types))return "历史内容类型／字段需核对";
  const type=types.find((value:unknown)=>!!value&&typeof value==="object"&&"key" in value&&value.key===typeKey);
  if(!type||typeof type!=="object")return "历史内容类型／字段需核对";
  const fields="fields" in type?type.fields:null;
  const field=Array.isArray(fields)?fields.find((value:unknown)=>!!value&&typeof value==="object"&&"key" in value&&value.key===fieldKey):null;
  const typeName="name" in type&&typeof type.name==="string"?type.name:"历史内容类型";
  const fieldName=field&&typeof field==="object"&&"name" in field&&typeof field.name==="string"?field.name:"历史字段需核对";
  return `${typeName}／${fieldName}`;
}
