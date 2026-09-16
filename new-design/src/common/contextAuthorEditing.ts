import type { ContextActivationRule, ContextSelectorKind, ContextSourceSelector, ContextSourceType } from "./contracts";

export interface ContextSelectorDraft {
  selectors:Array<Omit<ContextSourceSelector,"id">>;
  selectorKind:ContextSelectorKind;
  selectorSourceType:ContextSourceType;
  selectorPrimary:string;
  selectorSecondary:string;
  selectorRangeEnd:number;
}

// Only the selected first entry is edited. Other entries and non-visible configuration survive unchanged.
export function buildAuthorSelectors(draft:ContextSelectorDraft):Array<Omit<ContextSourceSelector,"id">>{
  const previous=draft.selectors[0],same=previous?.selectorKind===draft.selectorKind;
  const common={sortOrder:previous?.sortOrder??0,stableObjectId:null,exactVersionId:null};
  const config=same?{...previous.config}:{};
  let selector:Omit<ContextSourceSelector,"id">;
  switch(draft.selectorKind){
    case "explicit_source":selector={...common,selectorKind:draft.selectorKind,sourceType:draft.selectorSourceType,stableObjectId:draft.selectorPrimary,exactVersionId:draft.selectorSecondary,config};break;
    case "prompt_component":selector={...common,selectorKind:draft.selectorKind,sourceType:"prompt_component",stableObjectId:draft.selectorPrimary,exactVersionId:draft.selectorSecondary,config};break;
    case "tag":selector={...common,selectorKind:draft.selectorKind,sourceType:"card_version",config:{...config,tagId:draft.selectorPrimary}};break;
    case "smart_view":selector={...common,selectorKind:draft.selectorKind,sourceType:"card_version",config:{limit:100,...config,smartViewId:draft.selectorPrimary}};break;
    case "relation":selector={...common,selectorKind:draft.selectorKind,sourceType:"card_version",config:{...config,relationTypeId:draft.selectorPrimary}};break;
    case "story_range":selector={...common,selectorKind:draft.selectorKind,sourceType:draft.selectorSourceType==="story_time"?"story_time":"card_version",config:{...config,start:Number(draft.selectorPrimary),end:draft.selectorRangeEnd}};break;
    case "research_pack":selector={...common,selectorKind:draft.selectorKind,sourceType:"research_version",config:{...config,packVersionId:draft.selectorPrimary}};break;
    case "retrieval_trace":selector={...common,selectorKind:draft.selectorKind,sourceType:"retrieval_chunk",config:{limit:20,...config,retrievalRunId:draft.selectorPrimary}};break;
    default:selector={...common,selectorKind:"card_type",sourceType:"card_version",config:{...config,typeKey:draft.selectorPrimary}};
  }
  return [selector,...draft.selectors.slice(1)];
}

export function replaceActivationChild(rule:ContextActivationRule,index:number,child:ContextActivationRule|null):ContextActivationRule{
  if(rule.kind!=="group")return child??{kind:"group",operator:"and",items:[]};
  return {...rule,items:child?rule.items.map((item,i)=>i===index?child:item):rule.items.filter((_,i)=>i!==index)};
}
