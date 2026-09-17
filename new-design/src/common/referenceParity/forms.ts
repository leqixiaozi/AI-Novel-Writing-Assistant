import type {CardGroupFormDefinition,CardGroupFormSlot,CardGroupFormSummary,FieldDefinition} from "../contracts";
export type ReferencePrimaryType="character"|"world_setting"|"world_rule";
export interface FrozenDefinitionReference {kind:"template_snapshot";versionId:string;definitionHash:string;}
export interface ReferenceFormInstallation {
  sourceTemplateVersionId:string;sourceFormId:string;sourceFormVersionId:string;sourceDefinitionHash:string;
  previousFormVersionId:string|null;
  typeMappings:Array<{key:string;sourceId:string;sourceVersionId:string;targetId:string;targetVersionId:string}>;
  relationMappings:Array<{key:string;targetKey:string;sourceId:string;sourceVersion:FrozenDefinitionReference;targetId:string;targetDefinitionHash:string}>;
  dictionaryMappings:Array<{sourceId:string;sourceVersion:FrozenDefinitionReference;targetId:string;nodes:Array<{sourceId:string;targetId:string;targetVersionId:string}>}>;
}
export interface ReferenceFormsWorkspace {
  bookId:string;bookRevision:number;spaceId:string;templateId:string;
  activeForms:Record<string,string>;
  forms:Array<{id:string;name:string;revision:number;currentVersionId:string;primaryTypeKey:string;versions:Array<{id:string;version:number;definition:CardGroupFormDefinition}>}>;
  sources:Array<{templateVersionId:string;templateVersion:number;formId:string;formVersionId:string;key:string;name:string;primaryTypeKey:string}>;
  instances:Array<{id:string;primaryCardId:string;formId:string;formVersionId:string;revision:number}>;
}
export interface ReferenceFormPreviewInput {sourceTemplateVersionId:string;sourceFormVersionId:string;targetFormId?:string|null;setActive:boolean;}
export interface ReferenceFormInstallInput extends ReferenceFormPreviewInput {previewHash:string;requestKey:string;}
export interface ReferenceFormPreview {
  bookId:string;bookRevision:number;source:ReferenceFormPreviewInput;primaryTypeKey:string;targetFormId:string|null;targetFormRevision:number|null;
  installation:ReferenceFormInstallation;definition:CardGroupFormDefinition;inputHash:string;conflicts:string[];canInstall:boolean;
  messages:string[];preservedInstanceCount:number;
}
export interface ReferenceFormReceipt extends CardGroupFormSummary {
  installationResult:{bookId:string;bookRevision:number;command:"install"|"select"|"instance_upgrade";formVersionId:string;active:boolean;instanceId?:string;instanceRevision?:number;sourceTemplateVersionId?:string;};
}
export interface ReferenceFormSelectionInput {formVersionId:string;expectedBookRevision:number;requestKey:string;}
export interface ReferenceInstanceUpgradeInput {instanceId:string;targetFormVersionId:string;expectedInstanceRevision:number;previewHash:string;requestKey:string;}
export interface ReferenceAssociationPublicationPreview {
  sourceTemplateVersionId:string;templateId:string;templateRevision:number;primaryTypeKeys:ReferencePrimaryType[];availablePrimaryTypeKeys:ReferencePrimaryType[];
  forms:Array<{key:string;name:string;definition:CardGroupFormDefinition}>;conflicts:string[];canPublish:boolean;inputHash:string;
}
export interface ReferenceAssociationPublicationInput {sourceTemplateVersionId:string;primaryTypeKeys:ReferencePrimaryType[];templateRevision:number;previewHash:string;requestKey:string;}
const local=(key:string,name:string,description:string,order:number):FieldDefinition=>({key,name,description,order,group:"使用规划",type:"long_text",required:false,defaultValue:null,options:[],stateSettlement:"none",aiSuggestible:true});
export function referenceAssociationDefinition(primary:ReferencePrimaryType,typeKeys:string[]):CardGroupFormDefinition{
  const types=new Set(typeKeys),slots:CardGroupFormSlot[]=[{key:"primary",name:primary==="character"?"人物":"世界资料",kind:"primary_card",allowedTypeKeys:[primary],min:1,max:1,localFields:[]}];
  const add=(key:string,name:string,allowed:string[],fields:FieldDefinition[])=>{const available=allowed.filter(type=>types.has(type));if(available.length)slots.push({key,name,kind:"card_reference",allowedTypeKeys:available,relationTypeKey:`reference_${primary}_${key}`,min:0,max:50,localFields:fields});};
  if(primary==="character"){
    add("props","关联道具",["prop"],[local("usage_intent","使用意图","仅记录写作关联；资源持有以明确初始状态或正文结算为准。",0)]);
    add("locations","关联地点",["location"],[local("story_purpose","剧情用途","人物与地点的写作用途，不代表当前所在位置。",0)]);
    add("affiliations","组织与势力",["organization","faction"],[local("stance_intent","立场与关系设想","明确确认前不建立正式成员或阵营状态。",0)]);
    add("goals","关联目标",["goal_task"],[local("action_stage_intent","行动阶段规划","目标推进的写作意图，不自动改变正式生命周期。",0)]);
  }else{
    add("factions","核心势力",["organization","faction"],[local("scope_purpose","本书用途","本书的使用规划，来源资料独立保留。",0),local("story_pressure","剧情压力","准备让势力推动的冲突。",1)]);
    add("locations","关键地点",["location"],[local("scope_purpose","剧情用途","本书准备如何使用地点。",0),local("risk_intent","风险与限制","写作计划中的风险，确切事实需正文确认。",1)]);
    add("props","关键道具",["prop"],[local("scope_purpose","本书用途","不自动确立资源持有或可用状态。",0)]);
    add("rules","适用规则",["world_rule","time_rule","power_system"],[local("applicability","适用范围","本书的范围与例外描述；生成约束从上下文配置明确装配。",0)]);
  }
  return{primaryTypeKey:primary,groups:[{key:"reference",name:primary==="character"?"人物关联":"本书世界使用范围",order:0,sections:[{key:"reference",name:"资料与使用规划",order:0,slots}]}]};
}
