import {z} from 'zod';
import type {FieldDefinition,FormResolutionKind} from '../contracts';
import type {AuthorMaterialWriteReceipt} from '../authorMaterials';
export const PUBLIC_CHARACTER_SPACE_ID='60000000-0000-4000-8000-000000000001';
const uuid=z.string().uuid(),values=z.record(z.string().max(100),z.unknown()).refine(value=>Object.keys(value).length<=500);
export const characterImportInputSchema=z.object({requestKey:uuid,resourceId:uuid,resourceVersionId:uuid,title:z.string().trim().min(1).max(500),mapping:z.array(z.object({sourceKey:z.string().min(1).max(100),targetKey:z.string().min(1).max(100),value:z.unknown().refine(value=>value!==undefined)}).strict().refine(value=>Object.hasOwn(value,'value'),'请明确核对映射后的值。')).max(500),additionalValues:values}).strict();
export const characterImportCommitSchema=characterImportInputSchema.extend({previewHash:z.string().regex(/^[a-f0-9]{64}$/)});
export type CharacterImportInput=z.infer<typeof characterImportInputSchema>;
export type CharacterImportCommit=z.infer<typeof characterImportCommitSchema>;
export interface CharacterImportCatalog {items:Array<{id:string;title:string;versions:Array<{id:string;revision:number;title:string}>;versionsTruncated:boolean}>;truncated:boolean;}
export interface CharacterImportWorkspace {
 bookId:string;source:{id:string;versionId:string;title:string;revision:number;typeVersionId:string;values:Record<string,unknown>;fields:FieldDefinition[]};
 target:{cardTypeId:string;typeVersionId:string;revision:number;formVersionId:string|null;formResolutionKind:FormResolutionKind;fields:FieldDefinition[];importFields:FieldDefinition[];sourceHash:string};
}
export interface CharacterImportPreview {bookId:string;input:CharacterImportInput;workspace:CharacterImportWorkspace;values:Record<string,unknown>;previewHash:string;}
export interface CharacterImportReceipt {bookId:string;requestKey:string;inputHash:string;input:CharacterImportCommit;mappedFields:Array<{sourceKey:string;sourceLabel:string;targetKey:string;targetLabel:string}>;adoptionId:string;resourceId:string;resourceVersionId:string;receipt:AuthorMaterialWriteReceipt;sourceRoute:string;repeated:boolean;}
export function importValuePresent(value:unknown){return value!==null&&value!==undefined&&(typeof value!=='string'||Boolean(value.trim()))&&(!Array.isArray(value)||value.length>0)&&(typeof value!=='object'||Array.isArray(value)||Object.keys(value as object).length>0);}
