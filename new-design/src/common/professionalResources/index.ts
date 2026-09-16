import {z} from "zod";
import type {FieldDefinition,BookSummary} from "../contracts";
import type {CompositionCatalog,DebugPreviewInput,CompositionDebugPreview,CompositionDebugResult} from "../promptComposition";
export const PROFESSIONAL_ROUTE="/new-design/resources/professional";
export const RESOURCE_KINDS=["title_candidate","writing_config","quality_rule","genre_strategy","progression_mode"] as const;
export type ProfessionalResourceKind=(typeof RESOURCE_KINDS)[number];
export const RESOURCE_LABELS:Record<ProfessionalResourceKind,string>={title_candidate:"标题候选",writing_config:"写法资源",quality_rule:"质量规则",genre_strategy:"题材策略",progression_mode:"推进模式"};
export interface ProfessionalResource {id:string;versionId:string;typeId:string;typeVersionId:string;kind:ProfessionalResourceKind;title:string;revision:number;values:Record<string,unknown>;fields:FieldDefinition[];favorite:boolean;status:"active"|"archived";}
export interface ProfessionalReceipt {requestKey:string;operation:ProfessionalCommand["operation"];resourceIds:string[];bookId:string|null;versionIds:string[];adoptionIds:string[];targetCardIds:string[];retainedResult:string;createdAt:string;repeated:boolean;}
export interface ProfessionalFeedback {resourceId:string;resourceVersionId:string;previewId:string|null;issueId:string|null;effect:"helpful"|"neutral"|"harmful";note:string;createdAt:string;}
export interface ProfessionalCatalog {resources:ProfessionalResource[];types:Array<{id:string;kind:ProfessionalResourceKind;fields:FieldDefinition[]}>;books:BookSummary[];feedback:ProfessionalFeedback[];}
const uuid=z.string().uuid(),key=z.string().trim().min(8).max(160),revision=z.number().int().positive();
const valueMap=z.record(z.string().min(1).max(100),z.unknown()).refine(value=>Object.keys(value).length<=100&&JSON.stringify(value).length<=100000,"填写内容超过允许范围。");
const resource=z.object({resourceId:uuid,expectedRevision:revision,versionId:uuid});
export const professionalCommandSchema=z.discriminatedUnion("operation",[
 z.object({operation:z.literal("create"),requestKey:key,typeId:uuid,title:z.string().trim().min(1).max(240),values:valueMap}).strict(),
 resource.extend({operation:z.literal("edit"),requestKey:key,title:z.string().trim().min(1).max(240),values:valueMap}).strict(),
 resource.extend({operation:z.literal("archive"),requestKey:key}).strict(),
 resource.extend({operation:z.literal("favorite"),requestKey:key,favorite:z.boolean()}).strict(),
 resource.extend({operation:z.literal("adopt_title"),requestKey:key,bookId:uuid,expectedBookRevision:revision}).strict(),
 z.object({operation:z.literal("install"),requestKey:key,bookId:uuid,expectedBookRevision:revision,resources:z.array(resource.strict()).min(1).max(20)}).strict(),
 resource.extend({operation:z.literal("rule_settings"),requestKey:key,enabled:z.boolean(),scopes:z.array(z.enum(["book","volume","chapter","scene","field"])).min(1).max(5)}).strict(),
 resource.extend({operation:z.literal("feedback"),requestKey:key,previewId:uuid.nullable(),issueId:uuid.nullable(),effect:z.enum(["helpful","neutral","harmful"]),note:z.string().trim().min(1).max(2000)}).strict().refine(value=>Boolean(value.previewId)!==Boolean(value.issueId),"反馈必须引用一个真实试运行或质量问题。"),
]);
export type ProfessionalCommand=z.infer<typeof professionalCommandSchema>;
export interface ProfessionalRecovery {failedStep:string;summary:string;savedResult:string;retainedResult:string;sourceRoute:string;actionLabel:string;mutationOutcome:"not_written"|"unknown";requestKey:string|null;}
export interface ProfessionalResourcesApi {catalog():Promise<ProfessionalCatalog>;command(input:ProfessionalCommand):Promise<ProfessionalReceipt>;receipt(key:string):Promise<ProfessionalReceipt|null>;}
export interface ProfessionalTrialApi {catalog():Promise<CompositionCatalog>;preview(input:DebugPreviewInput):Promise<CompositionDebugPreview>;previewByKey(key:string):Promise<CompositionDebugPreview|null>;readPreview(id:string):Promise<CompositionDebugPreview>;run(id:string,input:{expectedRevision:number;idempotencyKey:string}):Promise<CompositionDebugResult>;result(id:string):Promise<CompositionDebugResult|null>;}
