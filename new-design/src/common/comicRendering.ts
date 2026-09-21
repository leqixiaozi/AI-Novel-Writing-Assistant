import {z} from 'zod';
import {IMAGE_SIZES} from './imageGeneration';
import {COMIC_VISUAL_ASSET_TYPES} from './comicVisualAssets';

const uuid=z.string().uuid();
export const comicRenderBatchSchema=z.object({requestKey:uuid,episodeId:uuid,panelSetId:uuid,connectionVersionId:uuid,size:z.enum(IMAGE_SIZES)}).strict();
export const comicBibleRenderSchema=z.object({requestKey:uuid,bibleEntityId:uuid,bibleVersionId:uuid,assetType:z.enum(COMIC_VISUAL_ASSET_TYPES),connectionVersionId:uuid,size:z.enum(IMAGE_SIZES),instruction:z.string().trim().max(2000).default('')}).strict();
export const comicRenderAdoptionSchema=z.object({requestKey:uuid,versionId:uuid,expectedRevision:z.number().int().min(0)}).strict();
export const comicExportManifestSchema=z.object({requestKey:uuid,variant:z.enum(['original_images','bubble_preview','project_manifest'])}).strict();
export const comicExportSubmitSchema=z.object({requestKey:uuid,manifestId:uuid,expectedSourceHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();

export type ComicRenderBatchInput=z.infer<typeof comicRenderBatchSchema>;
export type ComicBibleRenderInput=z.infer<typeof comicBibleRenderSchema>;
export type ComicRenderAdoptionInput=z.infer<typeof comicRenderAdoptionSchema>;
export type ComicExportManifestInput=z.infer<typeof comicExportManifestSchema>;
export type ComicExportSubmitInput=z.infer<typeof comicExportSubmitSchema>;
export interface ComicImageProtocolInput {requestKey:string;connectionVersionId:string;kind:'illustration';title:string;description:string;prompt:string;size:typeof IMAGE_SIZES[number];comicSource:{target:'panel'|'bible';facts:Record<string,unknown>};}
export interface ComicRenderVersion {id:string;projectId:string;episodeId:string|null;panelId:string|null;bibleEntityId:string|null;assetType:string|null;version:number;factSnapshotId:string;contentObjectId:string;mimeType:string;checksum:string;byteSize:number;sourceKind:'ai_candidate';createdAt:string;imageUrl:string;}
export interface ComicRenderTarget {targetKind:'panel'|'bible';targetId:string;revision:number;adoptedVersionId:string|null;versions:ComicRenderVersion[];}
export interface ComicRenderBatch {id:string;projectId:string;episodeId:string|null;panelSetId:string|null;requestKey:string;status:'running'|'succeeded'|'failed';totalCount:number;completedCount:number;stopPosition:number|null;lastError:string;versions:ComicRenderVersion[];createdAt:string;}
export interface ComicRenderWorkspace {projectId:string;episodeId:string|null;panelSetId:string|null;targets:ComicRenderTarget[];batches:ComicRenderBatch[];}
export interface ComicRenderAdoptionReceipt {target:ComicRenderTarget;adoptedVersionId:string;revision:number;requestKey:string;repeated:boolean;}
export interface ComicExportManifest {id:string;projectId:string;variant:'original_images'|'bubble_preview'|'project_manifest';sourceHash:string;sourceSnapshot:Record<string,unknown>;createdAt:string;}
export interface ComicExportArtifact {id:string;manifestId:string;variant:ComicExportManifest['variant'];filename:string;mediaType:string;checksum:string;byteSize:number;downloadUrl:string;createdAt:string;}
export interface ComicExportReceipt {manifest:ComicExportManifest;artifact:ComicExportArtifact|null;requestKey:string;repeated:boolean;}
