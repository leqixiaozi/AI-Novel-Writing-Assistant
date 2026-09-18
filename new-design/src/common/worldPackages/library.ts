import {z} from 'zod';
import {worldInstallInputSchema,WORLD_SECTIONS,type WorldPackageFrame,type PublishedWorldPackage,type WorldInstallTarget,type FrozenWorldCard,type FrozenWorldRelation} from './base';
import type {FieldDefinition} from '../contracts';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const worldLibraryInputSchema=z.object({requestKey:uuid,rootCardId:uuid,cards:z.array(worldInstallInputSchema.shape.cards.element.extend({sourceVersionId:uuid,section:z.enum(WORLD_SECTIONS),privateKeys:z.array(z.string().min(1).max(100)).max(500).default([])})).min(1).max(300),relations:z.array(worldInstallInputSchema.shape.relations.element.extend({sourceVersionId:uuid})).max(500)}).strict().superRefine((input,ctx)=>{if(!input.cards.some(card=>card.sourceCardId===input.rootCardId)||new Set(input.cards.map(card=>card.sourceCardId)).size!==input.cards.length||new Set(input.relations.map(relation=>relation.sourceRelationId)).size!==input.relations.length)ctx.addIssue({code:'custom',message:'请选择唯一世界根及完整资料与关系版本。'});});
export const worldLibraryCommitSchema=worldLibraryInputSchema.extend({previewHash:hash});
export const worldLibraryPublishSchema=z.object({requestKey:uuid,candidateId:uuid,publicRequestKey:uuid,previewHash:hash}).strict().refine(input=>input.requestKey!==input.publicRequestKey,{message:'本书操作与公共发布原键须独立。'});
export type WorldLibraryInput=z.infer<typeof worldLibraryInputSchema>;
export type WorldLibraryCommit=z.infer<typeof worldLibraryCommitSchema>;
export type WorldLibraryPublish=z.infer<typeof worldLibraryPublishSchema>;
export interface WorldLibraryPreview {bookId:string;input:WorldLibraryInput;sourceFrame:WorldPackageFrame;targets:WorldInstallTarget[];relationTargets:Record<string,unknown>[];sourceHash:string;previewHash:string;}
export interface WorldLibraryCandidate {id:string;bookId:string;input:WorldLibraryCommit;preview:WorldLibraryPreview;createdAt:string;publishedPackageId:string|null;}
export interface WorldLibraryReceipt {id:string;bookId:string;requestKey:string;inputHash:string;input:WorldLibraryCommit|WorldLibraryPublish;operation:'prepare'|'publish';candidate:WorldLibraryCandidate;package:PublishedWorldPackage|null;installation:import('./index').WorldInstallReceipt|null;sourceRoute:string;repeated:boolean;}
export interface WorldLibraryWorkspace {capability:{installed:boolean;operational:boolean};cards:FrozenWorldCard[];relations:FrozenWorldRelation[];types:Array<{id:string;key:string;name:string;fields:FieldDefinition[]}>;candidates:WorldLibraryCandidate[];}

