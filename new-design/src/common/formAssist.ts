import type { FieldDefinition, TreeSelectionRule } from "./contracts";
import type {KnowledgeSourceSelection} from "./knowledgeReference/selection";

export const FORM_ASSIST_ACTIONS=["fill_required","fill_empty","supplement","prepare_all","check","alternatives","adjust","recommend"] as const;
export type FormAssistAction=typeof FORM_ASSIST_ACTIONS[number];
export interface FormAssistTarget {bookId:string;cardTypeId:string;cardId:string|null;typeVersionId:string;cardRevision:number|null;formVersionId:string|null;title:string;}
export interface FormAssistNode {id:string;parentId:string|null;name:string;status:"active"|"archived";revision:number;path:string[];}
export interface FormAssistTree {kind:"dictionary"|"tag";key:string;name:string;sourceId:string;scope:string;revision:number;rule:TreeSelectionRule;nodes:FormAssistNode[];}
export interface FormAssistSnapshot {target:FormAssistTarget;fields:FieldDefinition[];localFieldKeys:string[];values:Record<string,unknown>;tagIds:string[];trees:FormAssistTree[];relations:Record<string,unknown>[];sourceHash:string;referenceCardIds?:string[];referenceKnowledgeSources?:KnowledgeSourceSelection[];knowledgeReferences?:Array<KnowledgeSourceSelection&{title:string;text:string;parsedAssetId:string;revision:number;resourceId:string}>;}
export interface FormAssistCandidate {id:string;name:string;values:Record<string,unknown>;tags:Record<string,string[]>;}
export interface FormAssistObservation {message:string;kind:"review";}
export interface FormAssistNewNode {id:string;treeKey:string;name:string;parentId:string|null;}
export interface FormAssistRun {id:string;action:FormAssistAction;status:"running"|"review"|"failed"|"discarded"|"applied";revision:number;instruction:string;snapshot:FormAssistSnapshot;candidates:FormAssistCandidate[];observations:FormAssistObservation[];newNodes:FormAssistNewNode[];error:string|null;createdAt:string;}
export interface FormAssistRequest {target:FormAssistTarget;action:FormAssistAction;instruction:string;values:Record<string,unknown>;tagIds:string[];fieldKeys:string[];idempotencyKey:string;referenceCardIds?:string[];referenceKnowledgeSources?:KnowledgeSourceSelection[];}
export interface FormAssistAdoption {decisionId:string;values:Record<string,unknown>;tagIds:string[];title?:string;}

export function formAiFieldVisible(field:FieldDefinition,values:Record<string,unknown>):boolean {
  if(field.hidden)return false;const rule=field.visibleWhen;if(!rule)return true;
  const actual=values[rule.fieldKey],blank=actual===null||actual===undefined||actual===""||Array.isArray(actual)&&!actual.length;
  if(rule.operator==="equals")return actual===rule.value;
  if(rule.operator==="not_equals")return actual!==rule.value;
  if(rule.operator==="is_empty")return blank;
  if(rule.operator==="is_not_empty")return !blank;
  return Array.isArray(actual)&&actual.includes(rule.value);
}
