import {z} from 'zod';
import {VISUAL_MAX_BYTES,VISUAL_MIME_TYPES} from './visualAssets';

export const COMIC_VISUAL_ASSET_TYPES=['portrait','three_view','expression','costume','prop','scene_sheet'] as const;
const uuid=z.string().uuid(),requestKey=z.string().uuid(),revision=z.number().int().min(0);
const base64=z.string().min(4).max(Math.ceil(VISUAL_MAX_BYTES/3)*4).refine(value=>value.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(value),'图片 Base64 格式无效。');
export const comicVisualUploadSchema=z.object({
 requestKey,bibleEntityId:uuid,assetId:uuid.nullable(),expectedRevision:revision.nullable(),assetType:z.enum(COMIC_VISUAL_ASSET_TYPES),name:z.string().trim().min(1).max(240),description:z.string().max(4000),filename:z.string().min(1).max(240).refine(value=>!/[\\/\x00-\x1f]/.test(value),'文件名不能包含路径或控制字符。'),mimeType:z.enum(VISUAL_MIME_TYPES),base64,
}).strict().refine(value=>(value.assetId===null)===(value.expectedRevision===null),'更新已有视觉素材必须携带原修订。');
export const comicVisualAdoptionSchema=z.object({requestKey,versionId:uuid,expectedRevision:revision}).strict();

export type ComicVisualAssetType=typeof COMIC_VISUAL_ASSET_TYPES[number];
export type ComicVisualUploadInput=z.infer<typeof comicVisualUploadSchema>;
export type ComicVisualAdoptionInput=z.infer<typeof comicVisualAdoptionSchema>;
export interface ComicVisualAssetVersion {id:string;assetId:string;version:number;sourceBibleVersionId:string;name:string;description:string;filename:string;mimeType:string;byteSize:number;checksum:string;sourceKind:'upload'|'ai_candidate';createdAt:string;}
export interface ComicVisualAsset {id:string;projectId:string;bibleEntityId:string;assetType:ComicVisualAssetType;revision:number;adoptedVersionId:string|null;status:'active'|'archived';versions:ComicVisualAssetVersion[];}
export interface ComicVisualWorkspace {projectId:string;bibleEntityId:string;assets:ComicVisualAsset[];}
export interface ComicVisualUploadReceipt {asset:ComicVisualAsset;version:ComicVisualAssetVersion;requestKey:string;repeated:boolean;}
export interface ComicVisualAdoptionReceipt {asset:ComicVisualAsset;adoptedVersionId:string;adoptionRevision:number;requestKey:string;repeated:boolean;}
