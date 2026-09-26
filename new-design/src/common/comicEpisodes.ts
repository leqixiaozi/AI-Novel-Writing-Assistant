import {z} from 'zod';

export const comicEpisodeContentSchema=z.object({
 title:z.string().trim().min(1).max(120),
 outline:z.string().trim().min(1).max(20_000),
 hookType:z.string().trim().max(80).nullable(),
 cliffhanger:z.string().trim().max(1000).nullable(),
 isPaywalled:z.boolean(),
 sourceText:z.string().trim().max(200_000).nullable(),
}).strict();
export const comicEpisodeProposalSchema=z.object({requestKey:z.string().uuid(),order:z.number().int().min(1).max(1000),expectedRevision:z.number().int().min(0),content:comicEpisodeContentSchema}).strict();
export const comicEpisodeOutlineSchema=z.object({requestKey:z.string().uuid(),order:z.number().int().min(1).max(1000),expectedRevision:z.number().int().min(0),instruction:z.string().trim().max(4000).default('')}).strict();
export const comicEpisodeOutlinePromptSchema=z.object({operation:z.literal('episode_outline'),projectId:z.string().uuid(),sourceVersionId:z.string().uuid(),sourceBundleVersionId:z.string().uuid(),sourceBundle:z.object({synopsis:z.string(),beats:z.array(z.object({order:z.number(),summary:z.string()})),characters:z.array(z.object({name:z.string(),role:z.string(),visualAnchor:z.string()}))}),order:z.number().int().min(1).max(1000),instruction:z.string().trim().max(4000)}).strict();
export const comicEpisodeAdoptionSchema=z.object({requestKey:z.string().uuid(),versionId:z.string().uuid(),expectedRevision:z.number().int().min(0)}).strict();
export type ComicEpisodeContent=z.infer<typeof comicEpisodeContentSchema>;
export type ComicEpisodeProposalInput=z.infer<typeof comicEpisodeProposalSchema>;
export type ComicEpisodeOutlineInput=z.infer<typeof comicEpisodeOutlineSchema>;
export type ComicEpisodeOutlinePrompt=z.infer<typeof comicEpisodeOutlinePromptSchema>;
export type ComicEpisodeAdoptionInput=z.infer<typeof comicEpisodeAdoptionSchema>;
export interface ComicEpisodeVersion {id:string;episodeId:string;version:number;sourceKind:'manual'|'ai_candidate';sourceVersionId:string;content:ComicEpisodeContent;createdAt:string;}
export interface ComicEpisode {id:string;projectId:string;order:number;revision:number;adoptedVersionId:string|null;versions:ComicEpisodeVersion[];}
export interface ComicEpisodeWorkspace {projectId:string;sourceVersionId:string;episodes:ComicEpisode[];}
export interface ComicEpisodeProposalReceipt {episode:ComicEpisode;version:ComicEpisodeVersion;requestKey:string;repeated:boolean;}
export interface ComicEpisodeAdoptionReceipt {episode:ComicEpisode;adoptedVersionId:string;adoptionRevision:number;requestKey:string;repeated:boolean;}
