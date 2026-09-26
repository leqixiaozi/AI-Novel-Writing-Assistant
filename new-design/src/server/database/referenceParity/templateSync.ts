import type {FieldDefinition,TemplateSyncPreview} from "../../../common/contracts";
import type {TemplatePayload} from "../templateStore";
import {NewDesignError} from "../../domain/errors";
import {structureWriteHash} from "../structureWrites";
export interface SyncPreconditions {bookRevision:number;fromVersionId:string;typeVersions:Array<{id:string;versionId:string;revision:number}>;inputHash:string;}
export function syncPreconditions(book:Record<string,unknown>,types:Record<string,unknown>[],targetVersionId:string,additions:unknown,trees:unknown,conflicts:unknown):SyncPreconditions{
  const value={bookRevision:Number(book.revision),fromVersionId:String(book.template_version_id),typeVersions:types.map(row=>({id:String(row.id),versionId:String(row.current_version_id),revision:Number(row.revision)})).sort((a,b)=>a.id.localeCompare(b.id))};
  return{...value,inputHash:structureWriteHash({bookId:book.id,targetVersionId,...value,additions,trees,conflicts})};
}
export function assertSyncPreconditions(sync:Record<string,unknown>,book:Record<string,unknown>,types:Record<string,unknown>[]){
  const trees=sync.tree_additions as Record<string,unknown>,saved=trees?.preconditions as SyncPreconditions|undefined;
  if(!saved)throw new NewDesignError("原升级缺少完整来源凭证，请保留原预览核对，重新准备新的差异预览。",409);
  const {preconditions:_,receipt:__,...plainTrees}=trees;
  const current=syncPreconditions(book,types,String(sync.to_template_version_id),sync.additions,plainTrees,sync.conflicts);
  if(current.inputHash!==saved.inputHash)throw new NewDesignError("书籍或填写规格在预览后已改变，请重新预览差异；本次没有覆盖书内内容。",409);
}
/** Record the subset actually installed. Uninstalled forms and relations retain their baseline. */
export function installedSyncPayload(installed:TemplatePayload,additions:TemplateSyncPreview["additions"],trees:NonNullable<TemplateSyncPreview["treeAdditions"]>):TemplatePayload{
  const next=structuredClone(installed);
  for(const addition of additions){const type=next.cardTypes.find(item=>item.key===addition.typeKey);if(type)type.fields.push(...structuredClone(addition.fields));}
  for(const dictionary of trees.dictionaries){const prior=next.dictionaries.find(item=>item.sourceId===dictionary.sourceId);if(prior)prior.items.push(...structuredClone(dictionary.items));else next.dictionaries.push(structuredClone(dictionary));}
  next.tagDimensions??=[];
  for(const dimension of trees.tagDimensions){const prior=next.tagDimensions.find(item=>item.sourceId===dimension.sourceId);if(prior)prior.nodes.push(...structuredClone(dimension.nodes));else next.tagDimensions.push(structuredClone(dimension));}
  next.tagBindings??=[];next.tagBindings.push(...structuredClone(trees.tagBindings));
  return next;
}
export function additiveSyncFields(published:FieldDefinition[],additions:FieldDefinition[]){
  if(additions.some(field=>field.required||published.some(existing=>existing.key===field.key)))throw new NewDesignError("升级字段与书内稳定键或必填约束冲突，请重新预览。",409);
  return[...published,...additions];
}
