import type { FieldDefinition, MarketScanDetail, ResearchRecordDetail } from "./contracts";

export function marketAnalysisMatchesSelection(record:ResearchRecordDetail,scan:MarketScanDetail,itemIds:string[],focus:string,budgetTokens:number):boolean {
  const version=record.currentVersion,scope=version.sourceScope;
  return record.type==="market_analysis"&&scope.scanRecordId===scan.record.id&&scope.scanVersionId===scan.version.id&&Array.isArray(scope.itemIds)&&scope.itemIds.length===itemIds.length&&scope.itemIds.every((id,index)=>id===itemIds[index])&&version.inputSnapshot.focus===focus&&version.budgetTokens===budgetTokens;
}

export function researchCandidateValueLabel(field:FieldDefinition|undefined,value:unknown,dictionaryLabels:ReadonlyMap<string,string>):string {
  if(value===null||value===undefined||value==="")return "未填写";
  const one=(item:unknown):string=>{
    if(field?.optionSource?.kind==="dictionary_tree")return typeof item==="string"?dictionaryLabels.get(`${field.optionSource.dictionaryId}:${item}`)??"未匹配字典项（原值保留）":"字典值需复核（原值保留）";
    if(field?.type==="select"||field?.type==="multi_select")return field.options.find(option=>option.value===item)?.label??"未匹配选项（原值保留）";
    if(typeof item==="boolean")return item?"是":"否";
    if(typeof item==="number")return Number.isFinite(item)?String(item):"数值需复核";
    if(typeof item==="string")return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item)?"资料引用（请核对原来源）":item;
    return "结构化来源内容（原值保留）";
  };
  return Array.isArray(value)?value.length?value.map(one).join("、"):"未填写":one(value);
}
