import type { BookCreationReviewCard, BookCreationReviewType } from "../../../common/contracts";
import { validateTreeSelection } from "../../../common/treePolicy";
import { validateCardValues } from "../validation";

interface ReviewDictionary {
  sourceId:string;
  items:Array<{sourceId:string;parentSourceId?:string|null}>;
}

function isBlank(value:unknown):boolean{return value===null||value===undefined||value===""||Array.isArray(value)&&value.length===0;}

export function normalizeBookCreationReview(incoming:BookCreationReviewCard[],existing:BookCreationReviewCard[]):BookCreationReviewCard[]{
  const byId=new Map(existing.map(card=>[card.id,card]));
  return incoming.map(card=>{const original=byId.get(card.id);return original?{...card,typeKey:original.typeKey,sourceKind:original.sourceKind,sourceId:original.sourceId,sourceVersionId:original.sourceVersionId,originalTitle:original.originalTitle,originalValues:structuredClone(original.originalValues),aiFieldBatchIds:structuredClone(original.aiFieldBatchIds??{})}:{...card,sourceKind:"manual" as const,sourceId:null,sourceVersionId:null,originalTitle:card.title,originalValues:structuredClone(card.values),aiFieldBatchIds:{}};});
}

export function validateBookCreationReviewCards(cards:BookCreationReviewCard[],types:BookCreationReviewType[],dictionaries:ReviewDictionary[],requireComplete:boolean):{cards:BookCreationReviewCard[];issues:Record<string,string>}{
  const typeByKey=new Map(types.map(type=>[type.key,type])),dictionaryById=new Map(dictionaries.map(dictionary=>[dictionary.sourceId,dictionary])),issues:Record<string,string>={};
  const normalized=cards.map(card=>{
    if(requireComplete&&!card.title.trim())issues[`${card.id}.title`]="请填写资料标题。";
    const type=typeByKey.get(card.typeKey);
    if(!type){issues[card.id]="这类资料不在当前开书模板中。";return card;}
    const validated=validateCardValues(requireComplete?type.fields:type.fields.map(field=>({...field,required:false})),card.values);
    for(const [fieldKey,message] of Object.entries(validated.issues))issues[`${card.id}.${fieldKey}`]=message;
    for(const field of type.fields){
      const source=field.optionSource;
      if(source?.kind!=="dictionary_tree"||!requireComplete&&isBlank(validated.values[field.key]))continue;
      const dictionary=dictionaryById.get(source.dictionaryId);
      if(!dictionary){issues[`${card.id}.${field.key}`]=`${field.name}绑定的字典不在当前模板中。`;continue;}
      const value=validated.values[field.key],selected=field.type==="select"?(typeof value==="string"?[value]:[]):Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):[];
      const checked=validateTreeSelection(dictionary.items.map(item=>({id:item.sourceId,parentId:item.parentSourceId??null,status:"active" as const})),source.rule,selected);
      if(!checked.valid)issues[`${card.id}.${field.key}`]=`${field.name}${checked.message??"的选择无效。"}`;
    }
    return {...card,values:validated.values};
  });
  return {cards:normalized,issues};
}
