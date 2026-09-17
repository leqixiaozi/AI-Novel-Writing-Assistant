import type {FieldDefinition} from '../contracts';
/** Old visible-profile concepts become optional published card fields, never formal state writes. */
export const CHARACTER_VISIBLE_REFERENCE_FIELDS:FieldDefinition[]=[
 ['physique','体态基底','年龄感、身形、行动姿态与身体表现基底。'],
 ['attire_style','常见穿着','日常穿着、身份外观、阶层或职业痕迹。'],
 ['signature_detail','标志细节','标志物、微习惯、气味或反复可用的识别细节。'],
 ['voice_texture','声音口吻','声线、节奏、句式习惯与口吻。'],
 ['presence_impression','登场印象','登场时给读者的直观感受。'],
].map(([key,name,description],index)=>({key,name,description,type:'long_text',required:false,defaultValue:null,options:[],group:'外显',order:30+index,stateSettlement:'none',aiSuggestible:true}));
export function characterVisibleAdditions(fields:FieldDefinition[]){
 const additions:FieldDefinition[]=[],conflicts:string[]=[];
 const appearance=fields.find(field=>field.key==='appearance');if(!appearance||appearance.type!=='long_text'||appearance.hidden||!['外在表现','外显档案','外显字段','外显'].includes(appearance.group.trim()))conflicts.push('样貌字段缺失或含义／分组不同，须先明确映射，不覆盖已有字段。');
 for(const field of CHARACTER_VISIBLE_REFERENCE_FIELDS){const prior=fields.find(item=>item.key===field.key);if(!prior)additions.push(structuredClone(field));else if(prior.type!==field.type||prior.required||prior.group!==field.group||prior.stateSettlement&&prior.stateSettlement!=='none')conflicts.push(`“${field.name}”已有不同规格，须明确处理。`);}
 return{additions,conflicts};
}
