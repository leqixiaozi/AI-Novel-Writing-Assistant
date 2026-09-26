import {z} from 'zod';
import type {PublishedWorldPackage} from './worldPackages';

const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const WORLD_GENERATION_LAYERS=['overview','rules','factions','locations','relations','tensions'] as const;
const text=z.string().trim().min(1).max(4000),short=z.string().trim().min(1).max(160);
const reference=z.object({cardId:uuid,versionId:uuid}).strict();
const propertyValue=z.union([z.string().trim().max(2000),z.array(z.string().trim().min(1).max(240)).max(40)]);
export const worldGenerationBlueprintSchema=z.object({inspiration:z.string().trim().min(1).max(12000),templateKey:z.string().trim().min(1).max(80).nullable(),references:z.array(reference).max(30).refine(items=>new Set(items.map(item=>item.cardId)).size===items.length,'参考资料不能重复。'),properties:z.record(z.string().trim().min(1).max(80),propertyValue).refine(value=>Object.keys(value).length<=80),layers:z.array(z.enum(WORLD_GENERATION_LAYERS)).length(WORLD_GENERATION_LAYERS.length).refine(value=>value.every((item,index)=>item===WORLD_GENERATION_LAYERS[index]),'世界生成层次必须完整且顺序固定。')}).strict();
export const worldGenerationStartSchema=z.object({requestKey:uuid,name:short,blueprint:worldGenerationBlueprintSchema}).strict();
const named=z.object({name:short,summary:text}).strict();
export const worldGenerationCandidateSchema=z.object({
  title:short,elevatorPitch:text,era:text,spatialStructure:text,coreOrder:text,ordinaryLife:text,
  rules:z.array(named.extend({cost:text,boundary:text,enforcement:text}).strict()).min(1).max(30),
  factions:z.array(z.object({name:short,position:text,doctrine:text,goals:z.array(short).min(1).max(20),methods:z.array(short).min(1).max(20)}).strict()).min(1).max(30),
  locations:z.array(z.object({name:short,summary:text,risk:text,entryConstraint:text}).strict()).min(1).max(50),
  relations:z.array(z.object({source:short,target:short,relation:short,tension:text}).strict()).max(100),
  tensions:z.array(text).min(1).max(30),
  sixLayers:z.object({overview:text,rules:text,factions:text,locations:text,relations:text,tensions:text}).strict(),
}).strict();
export const worldGenerationPromptInputSchema=z.object({mode:z.enum(['generate','regenerate','deepen']),name:short,blueprint:worldGenerationBlueprintSchema,previous:worldGenerationCandidateSchema.nullable(),instruction:z.string().trim().max(4000)}).strict();
export const worldGenerationCandidateSaveSchema=z.object({requestKey:uuid,expectedSessionRevision:z.number().int().positive(),basedOnCandidateId:uuid.optional(),source:z.enum(['manual','ai']),candidate:worldGenerationCandidateSchema}).strict();
export const worldGenerationRegenerateSchema=z.object({requestKey:uuid,expectedSessionRevision:z.number().int().positive(),basedOnCandidateId:uuid.optional(),mode:z.enum(['regenerate','deepen']).default('regenerate'),instruction:z.string().trim().max(4000).default('')}).strict();
export const worldGenerationPublishSchema=z.object({requestKey:uuid,candidateId:uuid,expectedSessionRevision:z.number().int().positive()}).strict();

export type WorldGenerationBlueprint=z.infer<typeof worldGenerationBlueprintSchema>;
export type WorldGenerationStartInput=z.infer<typeof worldGenerationStartSchema>;
export type WorldGenerationCandidateContent=z.infer<typeof worldGenerationCandidateSchema>;
export type WorldGenerationCandidateSave=z.infer<typeof worldGenerationCandidateSaveSchema>;
export type WorldGenerationRegenerateInput=z.infer<typeof worldGenerationRegenerateSchema>;
export type WorldGenerationPromptInput=z.infer<typeof worldGenerationPromptInputSchema>;
export type WorldGenerationPublishInput=z.infer<typeof worldGenerationPublishSchema>;
export interface FrozenWorldGenerationReference {cardId:string;versionId:string;title:string;typeKey:string;values:Record<string,unknown>;hash:string;}
export interface WorldGenerationCandidate {id:string;sessionId:string;version:number;requestKey:string;source:'manual'|'ai';basedOnCandidateId:string|null;content:WorldGenerationCandidateContent;status:'candidate'|'published';promptSnapshot:Record<string,unknown>|null;modelSnapshot:Record<string,unknown>|null;usedTokens:number|null;createdAt:string;}
export interface WorldGenerationSession {id:string;requestKey:string;name:string;blueprint:WorldGenerationBlueprint;frozenReferences:FrozenWorldGenerationReference[];sourceHash:string;status:'active'|'published'|'failed'|'result_unknown';revision:number;failure:string|null;publicRootCardId:string|null;publishedPackageId:string|null;publishedCandidateId:string|null;candidates:WorldGenerationCandidate[];createdAt:string;updatedAt:string;}
export interface WorldGenerationReceipt {session:WorldGenerationSession;candidate:WorldGenerationCandidate;package:PublishedWorldPackage;requestKey:string;inputHash:string;repeated:boolean;}
export interface WorldGenerationCapability {installed:boolean;operational:boolean;publishOperational:boolean;reason:string;}
