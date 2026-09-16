import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {BookCreationFormalReview,BookCreationProductionReceipt} from "../../../common/bookCreationProduction";
import type {InstalledBookPayload} from "../templateStore";
import {NewDesignError} from "../../domain/errors";
import {createPlanningObjectInTransaction,adoptInitialPlanningVersionInTransaction} from "../planning";
import {fieldDefinitionSchema,validateCardValues} from "../../domain/validation";
import {validateDictionaryTreeValues} from "../treeResources";

export async function installBookCreationProduction(client:PoolClient,bookId:string,spaceId:string,review:BookCreationFormalReview,mapping:InstalledBookPayload,requestKey:string):Promise<NonNullable<BookCreationProductionReceipt["installed"]>>{
 const installed:NonNullable<BookCreationProductionReceipt["installed"]>={cards:[...mapping.cards].map(([reviewCardId,value])=>({reviewCardId,...value})),relations:[],plans:[]};
 const card=(reviewId:string)=>{const found=mapping.cards.get(reviewId);if(!found)throw new NewDesignError("审阅对象没有精确安装映射，不能按名称猜正式资料。",409);return found;};
 for(const draft of review.relations.filter(d=>d.decision==="include")){
  const relationTypeId=mapping.relationTypeIds.get(draft.relationTypeSourceId);if(!relationTypeId)throw new NewDesignError("关系规格不属于本次安装模板。",409);
  const type=(await client.query("SELECT * FROM new_design.relation_types WHERE id=$1 AND owner_space_id=$2 AND scope='book' AND status='published'",[relationTypeId,spaceId])).rows[0];if(!type)throw new NewDesignError("本书正式关系规格不可用。",409);
  const source=card(draft.sourceReviewCardId),target=card(draft.targetReviewCardId),values={...draft.properties};
  const fields=type.properties_schema.map((raw:Record<string,unknown>,index:number)=>({...fieldDefinitionSchema.strict().parse({...raw,order:raw.order??index}),defaultValue:raw.defaultValue??null}));
  for(const field of fields)if(field.optionSource?.kind==="dictionary_tree"){const value=values[field.key];if(typeof value==="string")values[field.key]=mapping.dictionaryItemIds.get(value)??value;else if(Array.isArray(value))values[field.key]=value.map(item=>typeof item==="string"?mapping.dictionaryItemIds.get(item)??item:item);}
  const validated=validateCardValues(fields,values);if(Object.keys(validated.issues).length)throw new NewDesignError("关系属性未满足安装后的正式规格。",422,validated.issues);const trees=await validateDictionaryTreeValues(client,fields,validated.values);if(Object.keys(trees).length)throw new NewDesignError("关系属性不在安装后的精确字典范围。",422,trees);
  const id=randomUUID(),versionId=randomUUID();await client.query("INSERT INTO new_design.card_relations(id,space_id,relation_type_id,source_card_id,target_card_id,properties,status,revision,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,'active',1,'user')",[id,spaceId,relationTypeId,source.cardId,target.cardId,JSON.stringify(validated.values)]);
  await client.query("INSERT INTO new_design.card_relation_versions(id,card_relation_id,revision,source_card_version_id,target_card_version_id,status,properties,created_by) VALUES($1,$2,1,$3,$4,'active',$5::jsonb,'user')",[versionId,id,source.cardVersionId,target.cardVersionId,JSON.stringify(validated.values)]);await client.query("UPDATE new_design.card_relations SET current_version_id=$2 WHERE id=$1",[id,versionId]);installed.relations.push({draftId:draft.id,relationId:id,versionId});
 }
 const parentMappings=new Map<string,{objectId:string;versionId:string;adopted:boolean}>();const levels=["story","volume","chapter","scene"];
 for(const draft of [...review.plans].filter(p=>p.decision==="draft"||p.decision==="adopt").sort((a,b)=>levels.indexOf(a.level)-levels.indexOf(b.level)||a.sortOrder-b.sortOrder)){
  const parent=draft.parentDraftId?parentMappings.get(draft.parentDraftId):null;if(draft.level!=="story"&&(!parent||(draft.decision==="adopt"&&!parent.adopted)))throw new NewDesignError("子规划必须依据明确保存或采用的父级精确版本。",409);
  const references=draft.references.map(reference=>{const mapped=card(reference.reviewCardId);return{role:reference.role,cardId:mapped.cardId,cardVersionId:mapped.cardVersionId,action:reference.action,note:reference.note,sortOrder:reference.sortOrder};});
  const created=await createPlanningObjectInTransaction(client,{bookId,level:draft.level,parentObjectId:parent?.objectId??null,cardId:draft.reviewCardId?card(draft.reviewCardId).cardId:null,title:draft.title,sortOrder:draft.sortOrder,content:{...draft.content},source:"manual",executionMode:draft.executionMode,references,basedOnParentVersionId:parent?.versionId??null,createdBy:"user",idempotencyKey:`creation:${requestKey}:plan:${draft.id}`},{allowDraftParent:draft.decision==="draft"});
  const adopted=draft.decision==="adopt";if(adopted)await adoptInitialPlanningVersionInTransaction(client,created.objectId,created.versionId,`creation:${requestKey}:adopt:${draft.id}`);parentMappings.set(draft.id,{...created,adopted});installed.plans.push({draftId:draft.id,...created,adopted});
 }
 return installed;
}
