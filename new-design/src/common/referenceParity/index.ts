import type {FieldDefinition,ScopedFieldDefinition} from "../contracts";
export * from "./forms";
export * from "./associationWrites";
export * from "./selection";
export interface FieldWriteReceipt {bookId:string;operation:string;requestKey:string;inputHash:string;result:ScopedFieldDefinition;}

const text=(key:string,name:string,description:string,group:string,order:number):FieldDefinition=>({key,name,description,group,order,type:"long_text",required:false,defaultValue:null,options:[],stateSettlement:"none",aiSuggestible:true});
/** Writing intentions and initial drafts never establish settled story facts. */
export const CHARACTER_REFERENCE_FIELDS:FieldDefinition[]=[
  {key:"gender",name:"性别",description:"未指定时保持未知，不根据姓名或外貌推断。",group:"基本信息",order:4,type:"select",required:false,defaultValue:"unknown",options:[{value:"unknown",label:"未指定"},{value:"male",label:"男"},{value:"female",label:"女"},{value:"other",label:"其他"}],stateSettlement:"none",aiSuggestible:false},
  text("background","背景","人物经历的档案描述；明确确认前不作为已发生事件。","人物背景",20),
  text("development_plan","成长方向","作者计划的人物成长方向；已发生成长查看动态与确认的章节状态。","成长规划",21),
  text("current_action_goal","当前行动目标","近期行动的规划意图，与长期目标分别填写；不自动确立目标状态。","行动规划",22),
  text("initial_situation_draft","起始处境草稿","故事开始时的处境设想；正式状态从初始状态确认或已采用正文结算。","起始设定",23),
];
export interface ReferenceSpecificationPreview {
  sourceTemplateVersionId:string;templateId:string;templateRevision:number;inputHash:string;
  additions:FieldDefinition[];conflicts:string[];canPublish:boolean;
}
export interface ReferenceSpecificationPublishInput {
  sourceTemplateVersionId:string;templateRevision:number;previewHash:string;requestKey:string;
}
export function characterFieldAdditions(fields:FieldDefinition[]):{additions:FieldDefinition[];conflicts:string[]}{
  const additions:FieldDefinition[]=[],conflicts:string[]=[];
  for(const field of CHARACTER_REFERENCE_FIELDS){const prior=fields.find(item=>item.key===field.key);if(!prior)additions.push(structuredClone(field));else if(prior.type!==field.type||prior.required||prior.stateSettlement&&prior.stateSettlement!=="none"||field.key==="gender"&&(prior.optionSource?.kind==="dictionary_tree"||field.options.some(option=>!prior.options.some(item=>item.value===option.value))))conflicts.push(`“${field.name}”的稳定键已有不同规格，需明确映射。`);}
  return{additions,conflicts};
}
