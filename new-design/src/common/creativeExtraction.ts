import {z} from 'zod';
import type {BookSummary,FieldDefinition} from './contracts';
import type {AiRuntimeRecovery} from './aiRuntime';
import type {KnowledgeReferenceCandidate} from './knowledgeReference';
export const CREATIVE_EXTRACTION_ROUTE='/new-design/resources/extraction';
export const CREATIVE_MODES=['writing_resource','style_cleaning','title_groups'] as const;
export type CreativeMode=(typeof CREATIVE_MODES)[number];
export const CREATIVE_LABELS:Record<CreativeMode,string>={writing_resource:'提炼写法资源',style_cleaning:'仿写与清洗正文',title_groups:'中文标题专项'};
const uuid=z.string().uuid(),key=z.string().trim().min(8).max(160),hash=z.string().regex(/^[a-f0-9]{64}$/),rev=z.number().int().positive();
const range={start:z.number().int().nonnegative(),end:z.number().int().positive()};
export const creativeSourceSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('text'),title:z.string().trim().min(1).max(240),text:z.string().min(1).max(30000).refine(value=>Boolean(value.trim()),'请填写可用参考。')}).strict(),
 z.object({kind:z.literal('knowledge'),assetId:uuid,sourceVersionId:uuid,parsedVersionId:uuid,checksum:hash,...range}).strict(),
 z.object({kind:z.literal('research'),documentId:uuid,versionId:uuid,checksum:hash,...range}).strict(),
]);
export type CreativeSource=z.infer<typeof creativeSourceSchema>;
export const prepareCreativeSchema=z.object({requestKey:key,bookId:uuid,mode:z.enum(CREATIVE_MODES),instruction:z.string().trim().min(1).max(4000),source:creativeSourceSchema.nullable(),typeId:uuid.nullable(),typeVersionId:uuid.nullable(),documentId:uuid.nullable(),bodyVersionId:uuid.nullable(),expectedDocumentRevision:rev.nullable(),groupCount:z.number().int().min(1).max(5).default(3),candidatesPerGroup:z.number().int().min(1).max(5).default(3)}).strict().superRefine((input,context)=>{
 if(input.mode==='writing_resource'&&(!input.source||!input.typeId||!input.typeVersionId))context.addIssue({code:'custom',path:['typeId'],message:'请选择参考及已发布写法内容类型。'});
 if(input.mode==='style_cleaning'&&(!input.source||!input.documentId||!input.bodyVersionId||!input.expectedDocumentRevision))context.addIssue({code:'custom',path:['bodyVersionId'],message:'请选择参考和本章精确正文版本。'});
 if(input.source&&input.source.kind!=='text'&&(input.source.end<=input.source.start||input.source.end-input.source.start>30000))context.addIssue({code:'custom',path:['source'],message:'参考范围须完整且不超过三万字。'});
});
export type PrepareCreativeInput=z.infer<typeof prepareCreativeSchema>;
export interface CreativeCandidate {id:string;group:string;title:string;values:Record<string,unknown>;content:string|null;reason:string;risks:string[]}
export interface CreativeOutput {candidates:CreativeCandidate[];notes:string[]}
export const creativeModelOutputSchema=z.object({candidates:z.array(z.object({group:z.string().min(1).max(120),title:z.string().min(1).max(240),values:z.record(z.string(),z.unknown()),content:z.string().min(1).max(2000000).nullable(),reason:z.string().max(3000),risks:z.array(z.string().max(2000)).max(20)}).strict()).min(1).max(25),notes:z.array(z.string().max(2000)).max(30)}).strict();
export const creativeSavedOutputSchema=creativeModelOutputSchema.extend({candidates:z.array(creativeModelOutputSchema.shape.candidates.element.extend({id:uuid}).strict()).min(1).max(25)}).strict();
export interface CreativeSourceSnapshot {kind:CreativeSource['kind'];stableId:string|null;versionId:string|null;hash:string;title:string;text:string;start:number;end:number}
export interface CreativeTaskInput {book:{id:string;name:string;revision:number;description:string};mode:CreativeMode;instruction:string;source:CreativeSourceSnapshot|null;fields:FieldDefinition[];typeId:string|null;typeVersionId:string|null;body:{documentId:string;versionId:string;hash:string;content:string;revision:number;planningObjectId:string;planningVersionId:string;planningHash:string}|null;groupCount:number;candidatesPerGroup:number}
export interface CreativePreview {id:string;requestKey:string;bookId:string;mode:CreativeMode;revision:number;status:'ready'|'blocked'|'running'|'succeeded'|'failed';originalInput:PrepareCreativeInput;runInput:{requestKey:string;expectedRevision:number}|null;input:CreativeTaskInput;output:CreativeOutput|null;taskId:string|null;attemptId:string|null;failure:AiRuntimeRecovery|null;replySaved:boolean;ledgerPending:boolean;repeated:boolean}
export interface CreativeCatalog {book:BookSummary;types:Array<{id:string;versionId:string;name:string;fields:FieldDefinition[]}>;knowledge:{items:KnowledgeReferenceCandidate[];truncated:boolean};research:Array<{id:string;versionId:string;checksum:string;title:string;characters:number}>;chapters:Array<{documentId:string;title:string;revision:number;versions:Array<{id:string;title:string;hash:string}>}>;configured:boolean;message:string}
export const creativeCommandSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('save_resource'),requestKey:key,previewId:uuid,candidateId:uuid.nullable(),expectedPreviewRevision:rev,title:z.string().trim().min(1).max(240),values:z.record(z.string(),z.unknown())}).strict(),
 z.object({operation:z.literal('save_body_candidate'),requestKey:key,previewId:uuid,candidateId:uuid.nullable(),expectedPreviewRevision:rev,content:z.string().min(1).max(2000000),expectedDocumentRevision:rev}).strict(),
 z.object({operation:z.literal('adopt_title'),requestKey:key,previewId:uuid,candidateId:uuid.nullable(),expectedPreviewRevision:rev,title:z.string().trim().min(1).max(240),expectedBookRevision:rev,confirm:z.literal(true)}).strict(),
]);
export type CreativeCommand=z.infer<typeof creativeCommandSchema>;
export interface CreativeWriteReceipt {requestKey:string;previewId:string;operation:CreativeCommand['operation'];bookId:string;command:CreativeCommand;resourceId:string|null;versionId:string|null;bodyVersionId:string|null;bookRevision:number|null;savedResult:string;repeated:boolean}
export interface CreativeExtractionApi {catalog(bookId:string):Promise<CreativeCatalog>;prepare(input:PrepareCreativeInput):Promise<CreativePreview>;byKey(key:string):Promise<CreativePreview|null>;read(id:string):Promise<CreativePreview>;run(id:string,input:{requestKey:string;expectedRevision:number}):Promise<CreativePreview>;complete(id:string):Promise<CreativePreview>;command(id:string,input:CreativeCommand):Promise<CreativeWriteReceipt>;receipt(key:string):Promise<CreativeWriteReceipt|null>}
export const creativeRunSchema=z.object({requestKey:key,expectedRevision:rev}).strict();
