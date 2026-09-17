import type {FieldDefinition} from '../contracts';
const group='资源策划';
const field=(key:string,name:string,type:FieldDefinition['type'],description:string,order:number):FieldDefinition=>({key,name,type,description,order,group,required:false,defaultValue:null,options:[],stateSettlement:'none',aiSuggestible:true});
/** These are author plans; reader knowledge and holdings require their own confirmed sources. */
export const RESOURCE_REFERENCE_FIELDS:FieldDefinition[]=[
 {...field('narrative_function','叙事用途','select','作者计划的用途，不证明道具已使用。',30),options:[{value:'tool',label:'工具'},{value:'clue',label:'线索'},{value:'weapon',label:'武器'},{value:'proof',label:'证据'},{value:'key',label:'关键钥匙'},{value:'cost',label:'代价'},{value:'promise',label:'承诺'},{value:'hidden_card',label:'底牌'},{value:'constraint',label:'约束'}]},
 field('resource_plan_summary','资源策划摘要','long_text','简述资源如何影响后续情节；确认前不是正文事实。',31),
 field('expected_use_start_chapter_order','预计使用起始章序','number','计划使用窗口的起始章序，未知时留空。',32),
 field('expected_use_end_chapter_order','预计使用结束章序','number','计划使用窗口的结束章序，未知时留空。',33),
 field('resource_constraints','资源使用限制','long_text','作者计划的使用限制，每行一项；不自动产生正式状态。',34),
];
export function resourceFieldAdditions(fields:FieldDefinition[]){const additions:FieldDefinition[]=[],conflicts:string[]=[];for(const field of RESOURCE_REFERENCE_FIELDS){const prior=fields.find(item=>item.key===field.key);if(!prior)additions.push(structuredClone(field));else if(prior.type!==field.type||prior.required||prior.stateSettlement&&prior.stateSettlement!=='none'||field.type==='select'&&(prior.optionSource?.kind==='dictionary_tree'||field.options.some(option=>!prior.options.some(item=>item.value===option.value))))conflicts.push(`“${field.name}”的稳定键已有不同规格，需明确映射。`);}return{additions,conflicts};}
