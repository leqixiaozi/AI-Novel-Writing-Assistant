import {z} from 'zod';

const character=z.object({name:z.string().trim().min(1).max(120),gender:z.enum(['male','female','other','unknown']),persona:z.string().trim().max(3000),visualAnchor:z.string().trim().max(3000)}).strict();
const scene=z.object({name:z.string().trim().min(1).max(120),sceneType:z.enum(['interior','exterior','landscape','abstract','other']),bible:z.object({palette:z.string().trim().max(1000),keyElements:z.string().trim().max(3000),materials:z.string().trim().max(2000),ambiance:z.string().trim().max(2000),layout:z.string().trim().max(2000)}).strict()}).strict();
export const comicBibleProposalSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('character'),requestKey:z.string().uuid(),entityId:z.string().uuid().optional(),expectedRevision:z.number().int().min(0),content:character}).strict(),
 z.object({kind:z.literal('scene'),requestKey:z.string().uuid(),entityId:z.string().uuid().optional(),expectedRevision:z.number().int().min(0),content:scene}).strict(),
]);
export const comicBibleAdoptionSchema=z.object({requestKey:z.string().uuid(),versionId:z.string().uuid(),expectedRevision:z.number().int().min(0)}).strict();
export type ComicBibleProposalInput=z.infer<typeof comicBibleProposalSchema>;
export type ComicBibleAdoptionInput=z.infer<typeof comicBibleAdoptionSchema>;
export type ComicCharacterBible=z.infer<typeof character>;
export type ComicSceneBible=z.infer<typeof scene>;
export type ComicBibleVersion={id:string;entityId:string;version:number;content:ComicCharacterBible|ComicSceneBible;sourceKind:'manual'|'ai_candidate';createdAt:string};
export type ComicBibleEntity={id:string;projectId:string;kind:'character'|'scene';revision:number;adoptedVersionId:string|null;versions:ComicBibleVersion[]};
export interface ComicBibleWorkspace {projectId:string;characters:ComicBibleEntity[];scenes:ComicBibleEntity[];}
export interface ComicBibleProposalReceipt {entity:ComicBibleEntity;version:ComicBibleVersion;requestKey:string;repeated:boolean;}
export interface ComicBibleAdoptionReceipt {entity:ComicBibleEntity;adoptedVersionId:string;adoptionRevision:number;requestKey:string;repeated:boolean;}
