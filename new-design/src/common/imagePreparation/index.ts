import {z} from 'zod';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const imageMaterialScopeSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('book'),bookId:uuid}).strict(),
 z.object({kind:z.literal('public_character'),resourceId:uuid,resourceVersionId:uuid}).strict(),
]);
export type ImageMaterialScope=z.infer<typeof imageMaterialScopeSchema>;
export const imagePreparationInputSchema=z.object({requestKey:uuid,scope:imageMaterialScopeSchema,sourceHash:hash,original:z.string().trim().min(1).max(1000000)}).strict();
export type ImagePreparationInput=z.infer<typeof imagePreparationInputSchema>;
export const imagePreparationOutputSchema=z.object({sourceHash:hash,chinese:z.string().trim().min(1).max(4000),english:z.string().trim().min(1).max(4000),missingInformation:z.array(z.string().trim().min(1).max(500)).max(20)}).strict();
export type ImagePreparationOutput=z.infer<typeof imagePreparationOutputSchema>;
export const imagePreparationSelectionSchema=z.object({id:uuid,choice:z.enum(['original','chinese','english']),sourceHash:hash}).strict();
export type ImagePreparationSelection=z.infer<typeof imagePreparationSelectionSchema>;
export interface ImageMaterialSource {scope:ImageMaterialScope;hash:string;data:Record<string,unknown>;}
export interface ImagePreparationPromptInput {contract:'image_prompt_preparation_v1';source:ImageMaterialSource;original:string;}
export interface ImagePreparationResult {id:string;input:ImagePreparationInput;source:ImageMaterialSource;status:'running'|'succeeded'|'failed'|'ended_unknown';output:ImagePreparationOutput|null;canCompleteSaved:boolean;canEndExpired:boolean;summary:string;}
export interface ImagePreparationApi {materials(scope:ImageMaterialScope):Promise<ImageMaterialSource>;run(input:ImagePreparationInput):Promise<ImagePreparationResult>;byKey(key:string):Promise<ImagePreparationResult|null>;complete(id:string):Promise<ImagePreparationResult>;endExpired(id:string):Promise<ImagePreparationResult>;}
export function selectedImagePrompt(result:ImagePreparationResult,choice:ImagePreparationSelection['choice']){if(result.status!=='succeeded'||!result.output)throw Error('优化结果尚未确认。');const value=choice==='original'?result.input.original:result.output[choice];if(!value.trim()||value.trim().length>4000)throw Error('所选画面要求超过4000字，请编辑要求或选择优化结果；资料不会截断。');return value.trim();}
