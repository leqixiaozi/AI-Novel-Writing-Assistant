import {z} from 'zod';
export const recoveryKinds=['image_generation','image_prompt_preparation','public_character_trial','character_dialogue','world_consistency','chapter_quality','chapter_writing','creation_preparation','knowledge_embedding','knowledge_semantic'] as const;
export const recoveryTargetSchema=z.object({kind:z.enum(recoveryKinds),id:z.string().uuid(),bookId:z.string().uuid().nullable()}).strict();
export type RecoveryTarget=z.infer<typeof recoveryTargetSchema>;
export interface SavedRecoveryItem {target:RecoveryTarget;requestKey:string;title:string;sourceRoute:string;status:string;saved:boolean;canRecover:boolean;fingerprint:string;summary:string;}
export interface SavedRecoveryWorkspace {items:SavedRecoveryItem[];truncated:boolean;unavailable:string[];}
export const savedRecoveryInputSchema=z.object({requestKey:z.string().uuid(),items:z.array(z.object({target:recoveryTargetSchema,fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(30).refine(items=>new Set(items.map(item=>`${item.target.kind}:${item.target.id}`)).size===items.length,'不能重复选择原请求。')}).strict();
export type SavedRecoveryInput=z.infer<typeof savedRecoveryInputSchema>;
export interface SavedRecoveryOutcome {target:RecoveryTarget;item:SavedRecoveryItem|null;completed:boolean;summary:string;}
export interface SavedRecoveryApi {workspace(bookId?:string):Promise<SavedRecoveryWorkspace>;inspect(target:RecoveryTarget):Promise<SavedRecoveryItem>;recover(input:SavedRecoveryInput):Promise<{requestKey:string;outcomes:SavedRecoveryOutcome[]}>;}
