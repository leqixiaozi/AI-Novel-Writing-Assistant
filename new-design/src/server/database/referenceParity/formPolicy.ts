import type {CardGroupFormDefinition} from "../../../common/contracts";
import {structureWriteHash} from "../structureWrites";
export const formSlots=(definition:CardGroupFormDefinition)=>definition.groups.flatMap(group=>group.sections.flatMap(section=>section.slots));
export function relationDefinition(row:Record<string,unknown>){return{key:String(row.relation_key),name:String(row.name),description:String(row.description??''),direction:row.direction,sourceTypeKeys:row.source_type_keys,targetTypeKeys:row.target_type_keys,sourceMax:row.source_max,targetMax:row.target_max,propertiesSchema:row.properties_schema};}
export function formEvolutionConflicts(old:CardGroupFormDefinition,next:CardGroupFormDefinition):string[]{
  const conflicts:string[]=[],after=formSlots(next);if(old.primaryTypeKey!==next.primaryTypeKey)return['关联表单的主资料类型不同，不能自动转换。'];
  const originalRelation=(definition:CardGroupFormDefinition,key:string|undefined)=>definition.installation?.relationMappings.find(item=>item.targetKey===key)?.key??key;
  for(const prior of formSlots(old)){
    const current=after.find(slot=>slot.key===prior.key);
    if(!current||current.kind!==prior.kind||prior.allowedTypeKeys.some(key=>!current.allowedTypeKeys.includes(key))||current.min>prior.min||current.max<prior.max||originalRelation(old,prior.relationTypeKey)!==originalRelation(next,current.relationTypeKey)){conflicts.push(`“${prior.name}”的稳定位置、允许类型、数量或关系含义不能被覆盖。`);continue;}
    for(const field of prior.localFields){const target=current.localFields.find(item=>item.key===field.key);if(!target||target.type!==field.type||!field.required&&target.required||structureWriteHash(field.optionSource??null)!==structureWriteHash(target.optionSource??null)||target&&(field.options??[]).some(option=>!(target.options??[]).some(nextOption=>nextOption.value===option.value)))conflicts.push(`“${prior.name}／${field.name}”的已保存局部字段不兼容。`);}
    if(current.localFields.some(field=>field.required&&!prior.localFields.some(item=>item.key===field.key)))conflicts.push(`“${prior.name}”不能增加必填局部字段。`);
  }
  if(after.some(slot=>slot.min>0&&!formSlots(old).some(prior=>prior.key===slot.key)))conflicts.push("已有实例不能增加必填关联位置。");
  return conflicts;
}
