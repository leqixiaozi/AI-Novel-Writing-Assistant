import {z} from "zod";
import type {FieldDefinition,MarketRankingItem} from "../../../common/contracts";
import {BOOK_CREATION_METHODS} from "../../../common/contracts";
import type {DebugParameters} from "../../../common/promptComposition";
import type {ModelTaskKey} from "../../../common/modelRouting";
import type {ExactCompositionSource} from "../../database/promptComposition";
import {NewDesignError} from "../../domain/errors";

export const ANALYSIS_DIMENSIONS=["story_structure","characters","world","conflict","pacing","hooks_payoffs","writing_technique","quality_risks"] as const;
const boundedText=z.string().max(30000),shortText=z.string().max(300),ids=z.array(z.string().uuid()).max(100);
export const debugParametersSchema=z.object({
  instruction:boundedText,sourceText:z.string().max(400000),sourceReference:boundedText,method:z.enum(BOOK_CREATION_METHODS),schemaTypeIds:ids,
  direction:z.object({title:shortText,premise:z.string().max(4000),protagonist:z.string().max(2000),centralConflict:z.string().max(4000),readerPromise:z.string().max(2000),styleKeywords:z.array(z.string().min(1).max(4000)).max(100)}).strict(),
  planning:z.object({level:z.enum(["story","volume","chapter","scene"]),title:shortText}).strict(),
  analysis:z.object({purpose:z.enum(["reference_learning","continuation","diagnosis"]),preset:z.enum(["quick","standard","full"]),dimensions:z.array(z.enum(ANALYSIS_DIMENSIONS)).min(1).max(8)}).strict(),rankingSnapshotIds:ids,
}).strict().superRefine((value,ctx)=>{
  for(const [key,items] of [["schemaTypeIds",value.schemaTypeIds],["rankingSnapshotIds",value.rankingSnapshotIds],["analysis.dimensions",value.analysis.dimensions]] as const)if(new Set(items).size!==items.length)ctx.addIssue({code:"custom",path:key.split("."),message:"所选项目不能重复。"});
});
export interface DebugSchemaType {id:string;key:string;name:string;description:string;fields:FieldDefinition[];}
export interface TaskInputSources {book:{name:string;description:string};types:DebugSchemaType[];sources:ExactCompositionSource[];rankingItems:MarketRankingItem[];}

/** Task selection is an explicit author setting; this is contract assembly, not semantic intent routing. */
export function buildDebugTaskInput(taskType:ModelTaskKey,parameters:DebugParameters,snapshot:TaskInputSources):Record<string,unknown> {
  const p=debugParametersSchema.parse(parameters),book=snapshot.book;
  const selected=p.schemaTypeIds.map(id=>snapshot.types.find(type=>type.id===id));
  if(selected.some(type=>!type))throw new NewDesignError("所选内容类型不属于参考书籍的已发布规格，请重新选择。",422,{schemaTypeIds:"请选择此书的内容类型。"});
  const schemaTypes=selected.map(type=>({key:type!.key,name:type!.name,description:type!.description,fields:type!.fields.filter(field=>!field.hidden&&field.aiSuggestible!==false&&!(field.optionSource?.kind==="dictionary_tree"&&field.optionSource.rule.aiSuggestible===false))}));
  switch(taskType){
    case "directions":return {method:p.method,bookName:book.name,sourceReference:p.sourceReference,sourceText:p.sourceText};
    case "initial_content":
      if(!schemaTypes.length)throw new NewDesignError("请选择需要准备的内容类型。",422,{schemaTypeIds:"至少选择一种内容类型。"});
      return {direction:{id:"debug-direction",...p.direction},sourceText:p.sourceText,schemaTypes};
    case "form_assist":{
      if(schemaTypes.length!==1||!schemaTypes[0].fields.length)throw new NewDesignError("请选择一种包含可建议字段的内容类型。",422,{schemaTypeIds:"表单建议需要选择一种内容类型。"});
      const type=schemaTypes[0],current=snapshot.sources.find(source=>source.typeKey===type.key&&source.role==="formal");
      return {bookName:book.name,formName:type.name,cardTitle:current?.title??"",currentValues:current?.values??{},fields:type.fields,instruction:p.instruction};
    }
    case "planning_candidate":return {bookName:book.name,bookDescription:book.description,target:{level:p.planning.level,title:p.planning.title,currentContent:null,parentContent:null},materials:snapshot.sources.map(source=>({cardId:source.cardId,typeKey:source.typeKey,typeName:snapshot.types.find(type=>type.key===source.typeKey)?.name??"本书资料",title:source.title,values:source.values})),adoptedPlans:[],instruction:p.instruction};
    case "market_analysis":
      if(!p.rankingSnapshotIds.length||!snapshot.rankingItems.length)throw new NewDesignError("请选择已采集成功且有榜单项目的来源快照。",422,{rankingSnapshotIds:"请选择实际榜单来源，空样本不能生成趋势分析。"});
      if(snapshot.rankingItems.some(item=>!p.rankingSnapshotIds.includes(item.snapshotId)))throw new NewDesignError("榜单来源与本次选择不一致。",422);
      return {items:snapshot.rankingItems,focus:p.instruction,budgetTokens:65536};
    case "book_analysis":{
      if(!p.sourceText.trim())throw new NewDesignError("请填写需要拆书或诊断的参考文本。",422,{sourceText:"参考文本不能为空。"});
      const allowCandidates=p.analysis.purpose!=="diagnosis"&&schemaTypes.length>0;
      return {title:p.sourceReference,text:p.sourceText,focus:p.instruction,budgetTokens:65536,plan:{purpose:p.analysis.purpose,preset:p.analysis.preset,dimensions:p.analysis.dimensions,targetForms:[],targets:allowCandidates?schemaTypes.map(type=>({typeKey:type.key,typeName:type.name,allowedFields:type.fields.map(field=>field.key),maxCandidates:10,mergePolicy:"reference_only"})):[],evidenceRequired:true,candidateLimit:allowCandidates?Math.min(20,schemaTypes.length*10):0},schemaTypes};
    }
  }
}
