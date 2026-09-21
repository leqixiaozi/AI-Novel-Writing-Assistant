import {z} from 'zod';

export const comicSourceBundleContentSchema=z.object({
 synopsis:z.string().trim().min(1).max(20_000),
 beats:z.array(z.object({order:z.number().int().min(1).max(1000),summary:z.string().trim().min(1).max(2000)}).strict()).min(1).max(100),
 characters:z.array(z.object({name:z.string().trim().min(1).max(120),role:z.string().trim().max(500),visualAnchor:z.string().trim().max(2000)}).strict()).max(50),
}).strict().superRefine((value,context)=>{if(new Set(value.beats.map(item=>item.order)).size!==value.beats.length)context.addIssue({code:'custom',path:['beats'],message:'节拍序号不能重复。'});});
export const comicSourceBundleProposalSchema=z.object({requestKey:z.string().uuid(),expectedRevision:z.number().int().min(0),content:comicSourceBundleContentSchema}).strict();
export const comicSourceExtractionSchema=z.object({requestKey:z.string().uuid(),expectedRevision:z.number().int().min(0),instruction:z.string().trim().max(4000).default('')}).strict();
export const comicSourceExtractionPromptSchema=z.object({operation:z.literal('source_extract'),projectId:z.string().uuid(),sourceVersionId:z.string().uuid(),sourceText:z.string().trim().min(1).max(4_000_000),sourceManifest:z.record(z.string(),z.unknown()),instruction:z.string().trim().max(4000)}).strict();
export const comicSourceBundleAdoptionSchema=z.object({requestKey:z.string().uuid(),versionId:z.string().uuid(),expectedRevision:z.number().int().min(0)}).strict();
export type ComicSourceBundleContent=z.infer<typeof comicSourceBundleContentSchema>;
export type ComicSourceBundleProposalInput=z.infer<typeof comicSourceBundleProposalSchema>;
export type ComicSourceExtractionInput=z.infer<typeof comicSourceExtractionSchema>;
export type ComicSourceExtractionPrompt=z.infer<typeof comicSourceExtractionPromptSchema>;
export type ComicSourceBundleAdoptionInput=z.infer<typeof comicSourceBundleAdoptionSchema>;
export interface ComicSourceBundleVersion{id:string;projectId:string;version:number;sourceVersionId:string;sourceKind:'manual'|'ai_candidate';content:ComicSourceBundleContent;createdAt:string;}
export interface ComicSourceBundleWorkspace{projectId:string;sourceVersionId:string;revision:number;adoptedVersionId:string|null;versions:ComicSourceBundleVersion[];}
export interface ComicSourceBundleProposalReceipt{workspace:ComicSourceBundleWorkspace;version:ComicSourceBundleVersion;requestKey:string;repeated:boolean;}
export interface ComicSourceBundleAdoptionReceipt{workspace:ComicSourceBundleWorkspace;adoptedVersionId:string;adoptionRevision:number;requestKey:string;repeated:boolean;}
