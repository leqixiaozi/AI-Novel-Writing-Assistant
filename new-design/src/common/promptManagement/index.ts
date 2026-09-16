import type { CardSummary, CardTypeSummary, FieldDefinition, MaterialManagementWorkspace } from "../contracts";
export interface PromptCatalog {
  organization: MaterialManagementWorkspace;
  type: CardTypeSummary;
  fields: FieldDefinition[];
  components: CardSummary[];
  primaryGroups: Record<string,string>;
}
export interface PromptClassificationInput {
  groupId: string;
  expectedCardRevision: number;
  expectedGroupRevision: number;
  idempotencyKey: string;
}
export interface PromptSaveInput {
  cardId: string | null;
  expectedRevision: number | null;
  title: string;
  values: Record<string,unknown>;
  idempotencyKey: string;
}
export interface PromptReorderInput {
  parentId: string|null;
  orderedIds: string[];
  expectedRevisions: Record<string,number>;
  idempotencyKey: string;
}
export interface PromptCategoryCreateInput {key:string;name:string;parentId?:string|null;sortOrder:number;idempotencyKey:string;}
export type PromptCategoryRevisionInput=Omit<PromptCategoryCreateInput,"key">&{expectedRevision:number};
export interface PromptCategoryArchiveInput {expectedRevision:number;childMode:"promote";idempotencyKey:string;}
export function promptCategoryDescendants(groups: PromptCatalog["organization"]["groups"], id: string): Set<string> {
  const result=new Set([id]);let changed=true;
  while(changed){changed=false;for(const group of groups)if(group.status==="active"&&group.parentId&&result.has(group.parentId)&&!result.has(group.id)){result.add(group.id);changed=true;}}
  return result;
}
