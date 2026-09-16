import type {CardGroupFormSummary,TemplateGroupSummary} from "./contracts";

export type StructureWriteKind="form"|"template";
export type StructureWriteOperation="save"|"publish";
export interface StructureWriteReceipt {
  kind:StructureWriteKind;operation:StructureWriteOperation;requestKey:string;inputHash:string;
  result:CardGroupFormSummary|TemplateGroupSummary;
}
