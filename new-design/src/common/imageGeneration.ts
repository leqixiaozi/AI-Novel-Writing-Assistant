import {z} from "zod";
import type {ManagedCredentialChoice} from "./modelRouting";
import type {AiRuntimeRecovery} from "./aiRuntime";
import type {VisualReceipt} from "./visualAssets";

export const IMAGE_PROTOCOL="openai_images_b64_v1" as const;
export const IMAGE_CAPABILITIES=["image_generation","image_base64"] as const;
export const IMAGE_SIZES=["1024x1024","1024x1792","1792x1024"] as const;
export const IMAGE_CONTRACT={assetId:"new_design.image.generate",assetVersion:"v1",protocol:IMAGE_PROTOCOL,maxImages:1} as const;
const endpoint=z.string().trim().min(1).max(1000).superRefine((value,ctx)=>{try{const url=new URL(value);if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.protocol!=="https:"&&!["localhost","127.0.0.1","[::1]"].includes(url.hostname))throw new Error();}catch{ctx.addIssue({code:"custom",message:"服务地址只接受无凭据和查询参数的 HTTPS 地址，或本机 HTTP 地址。"});}});
export const imageConnectionInputSchema=z.object({provider:z.literal("openai-compatible"),endpoint,model:z.string().trim().min(1).max(300),credentialId:z.string().uuid().nullable(),protocol:z.literal(IMAGE_PROTOCOL),capabilities:z.tuple([z.literal("image_generation"),z.literal("image_base64")]),sizes:z.array(z.enum(IMAGE_SIZES)).min(1).max(3).refine(values=>new Set(values).size===values.length),timeoutMs:z.number().int().min(1000).max(600000),expectedConfigId:z.string().uuid().nullable(),expectedRevision:z.number().int().positive().nullable(),idempotencyKey:z.string().uuid()}).strict().refine(value=>(value.expectedConfigId===null)===(value.expectedRevision===null),{path:["expectedRevision"],message:"配置与修订必须同时提供。"});
export type SaveImageConnectionInput=z.infer<typeof imageConnectionInputSchema>;
export interface ImageConnectionVersion extends Omit<SaveImageConnectionInput,"expectedConfigId"|"expectedRevision"|"idempotencyKey"> {id:string;configId:string;configRevision:number;version:number;label:string;connectionHash:string}
export interface ImageConnectionCatalog {connections:ImageConnectionVersion[];credentials:ManagedCredentialChoice[];configurationIssue:string|null}
export interface ImageConnectionSaveResult {connection:ImageConnectionVersion;configRevision:number;savedVersionId:string;repeated:boolean}
export const imageGenerationInputSchema=z.object({bookId:z.string().uuid(),requestKey:z.string().uuid(),connectionVersionId:z.string().uuid(),kind:z.enum(["cover","illustration"]),title:z.string().trim().min(1).max(240),description:z.string().max(4000),prompt:z.string().trim().min(1).max(4000),size:z.enum(IMAGE_SIZES)}).strict();
export type ImageGenerationInput=z.infer<typeof imageGenerationInputSchema>;
export const imageReplySchema=z.object({base64:z.string().min(4).max(13981016).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),mimeType:z.enum(["image/png","image/jpeg","image/webp"]),checksum:z.string().regex(/^[a-f0-9]{64}$/),byteSize:z.number().int().positive().max(10485760),inputTokens:z.number().int().nonnegative().nullable(),outputTokens:z.number().int().nonnegative().nullable(),durationMs:z.number().int().nonnegative()}).strict();
export type ImageGenerationReply=z.infer<typeof imageReplySchema>;
export interface ImageGenerationResult {requestId:string;bookId:string;requestKey:string;inputHash:string;input:ImageGenerationInput;status:"running"|"succeeded"|"cancelled";title:string;model:string;replySaved:boolean;replySource:"database"|"local_receipt"|null;canCompleteSaved:boolean;canEndExpired:boolean;asset:VisualReceipt|null;retainedResult:string;recovery:AiRuntimeRecovery|null}
export interface ImageGenerationCatalog extends ImageConnectionCatalog {requests:ImageGenerationResult[]}
export interface ImageGenerationApi {catalog(bookId:string):Promise<ImageGenerationCatalog>;generate(input:ImageGenerationInput):Promise<ImageGenerationResult>;byKey(bookId:string,key:string):Promise<ImageGenerationResult|null>;result(id:string):Promise<ImageGenerationResult>;completeSaved(id:string):Promise<ImageGenerationResult>;endExpired(id:string):Promise<ImageGenerationResult>;connectionCatalog():Promise<ImageConnectionCatalog>;saveConnection(input:SaveImageConnectionInput):Promise<ImageConnectionSaveResult>;connectionReceipt(key:string):Promise<ImageConnectionSaveResult|null>}
export const imageSourceRoute=(bookId:string)=>`/new-design/books/${bookId}/visual-assets`;
