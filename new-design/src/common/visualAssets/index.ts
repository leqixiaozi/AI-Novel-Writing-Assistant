import {z} from "zod";
export const VISUAL_MAX_BYTES=10*1024*1024;
export const VISUAL_MIME_TYPES=["image/png","image/jpeg","image/webp","image/gif"] as const;
export const visualRoute=(bookId:string)=>`/new-design/books/${bookId}/visual-assets`;
export interface VisualVersion {id:string;assetId:string;version:number;title:string;description:string;filename:string;checksum:string;byteSize:number;mimeType:string;integrity:"pending"|"verified"|"missing"|"corrupt";readable:boolean;createdAt:string;}
export interface VisualAsset {id:string;title:string;kind:"cover"|"illustration";revision:number;status:"active"|"archived";currentVersionId:string|null;versions:VisualVersion[];}
export interface VisualOwner {kind:"book"|"card_version"|"chapter_body_version";stableId:string;versionId:string;title:string;}
export interface VisualMount {id:string;assetId:string;versionId:string;ownerKind:VisualOwner["kind"];ownerStableId:string;ownerVersionId:string;label:string;status:"active"|"ended";}
export interface VisualWorkspace {bookId:string;bookName:string;capability:{generation:boolean;reason:string;sourceRoute:string};assets:VisualAsset[];owners:VisualOwner[];mounts:VisualMount[];}
const uuid=z.string().uuid(),key=z.string().trim().min(8).max(160),revision=z.number().int().positive(),text=z.string().trim().max(240);
const ref={bookId:uuid,assetId:uuid,expectedRevision:revision,requestKey:key};
export const visualUploadSchema=z.object({bookId:uuid,assetId:uuid.nullable(),expectedRevision:revision.nullable(),kind:z.enum(["cover","illustration"]),title:text.min(1),description:z.string().max(4000),filename:z.string().min(1).max(240).refine(value=>!/[\\/\x00-\x1f]/.test(value),"文件名不能包含路径或控制字符。"),mimeType:z.enum(VISUAL_MIME_TYPES),base64:z.string().min(1).max(Math.ceil(VISUAL_MAX_BYTES/3)*4),requestKey:key}).strict().refine(value=>Boolean(value.assetId)===(value.expectedRevision!==null),"更新已有图片需提供原修订，新增不借原修订。");
export const visualCommandSchema=z.discriminatedUnion("operation",[
 z.object({...ref,operation:z.literal("description"),versionId:uuid,title:text.min(1),description:z.string().max(4000)}).strict(),
 z.object({...ref,operation:z.literal("adopt"),versionId:uuid,previewId:uuid}).strict(),
 z.object({...ref,operation:z.literal("archive"),previewId:uuid,reason:z.string().trim().min(1).max(2000)}).strict(),
 z.object({...ref,operation:z.literal("mount"),versionId:uuid,ownerKind:z.enum(["book","card_version","chapter_body_version"]),ownerStableId:uuid,ownerVersionId:uuid,label:text}).strict(),
]);
export type VisualUploadInput=z.infer<typeof visualUploadSchema>;
export type VisualCommand=z.infer<typeof visualCommandSchema>;
export const visualPreviewSchema=z.object({bookId:uuid,assetId:uuid,expectedRevision:revision,toVersionId:uuid.nullable(),requestKey:key}).strict();
export type VisualPreviewInput=z.infer<typeof visualPreviewSchema>;
export interface VisualImpactPreview {id:string;bookId:string;assetId:string;revision:number;toVersionId:string|null;impacts:Array<{id:string;label:string;strength:"hard"|"soft";sourceRoute?:string}>;hash:string;}
export interface VisualReceipt {bookId:string;requestKey:string;operation:"upload"|VisualCommand["operation"]|"preview";assetId:string;versionId:string|null;mountId:string|null;previewId:string|null;retainedResult:string;repeated:boolean;}
export interface VisualAssetsApi {workspace(bookId:string):Promise<VisualWorkspace>;upload(input:VisualUploadInput):Promise<VisualReceipt>;command(input:VisualCommand):Promise<VisualReceipt>;preview(input:VisualPreviewInput):Promise<VisualImpactPreview>;receipt(bookId:string,key:string):Promise<VisualReceipt|null>;previewByKey(bookId:string,key:string):Promise<VisualImpactPreview|null>;imageUrl(bookId:string,assetId:string,versionId:string):string;}
export function readVisualSelection(search:string):{assetId:string|null;versionId:string|null;valid:boolean}{const params=new URLSearchParams(search),assets=params.getAll("asset"),versions=params.getAll("version");if(assets.length>1||versions.length>1||versions.length&&!assets.length)return{assetId:null,versionId:null,valid:false};const asset=assets.length?uuid.safeParse(assets[0]):null,version=versions.length?uuid.safeParse(versions[0]):null;if(asset&&!asset.success||version&&!version.success)return{assetId:null,versionId:null,valid:false};return{assetId:asset?.success?asset.data.toLowerCase():null,versionId:version?.success?version.data.toLowerCase():null,valid:true};}
