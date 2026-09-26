import {z} from 'zod';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const PUBLIC_TITLE_ROUTE='/new-design/resources/titles';
export const publicTitleInputSchema=z.object({requestKey:uuid,mode:z.enum(['brief','adapt']),brief:z.string().trim().max(8000),reference:z.string().trim().max(30000),instruction:z.string().trim().min(1).max(4000),groupCount:z.number().int().min(1).max(5),candidatesPerGroup:z.number().int().min(1).max(5)}).strict().refine(input=>input.mode==='brief'?Boolean(input.brief):Boolean(input.reference),'请填写本次故事简述或参考原文。');
export type PublicTitleInput=z.infer<typeof publicTitleInputSchema>;
export const publicTitleSourceSchema=z.object({id:uuid,versionId:uuid,hash,values:z.object({content_kind:z.literal('public_title_brief'),mode:z.enum(['brief','adapt']),brief:z.string().optional(),reference:z.string().optional(),instruction:z.string(),group_count:z.number(),candidates_per_group:z.number()}).strict()}).strict();
export type PublicTitleSource=z.infer<typeof publicTitleSourceSchema>;
export const publicTitleOutputSchema=z.object({sourceId:uuid,sourceVersionId:uuid,sourceHash:hash,groups:z.array(z.object({name:z.string().trim().min(1).max(120),titles:z.array(z.object({title:z.string().trim().min(1).max(240),reason:z.string().trim().min(1).max(2000),risks:z.array(z.string().max(1000)).max(10)}).strict()).min(1).max(5)}).strict()).min(1).max(5),notes:z.array(z.string().max(1000)).max(20)}).strict();
export type PublicTitleOutput=z.infer<typeof publicTitleOutputSchema>;
export const publicTitleResultSchema=z.object({id:uuid,input:publicTitleInputSchema,source:publicTitleSourceSchema,status:z.enum(['running','succeeded','failed','ended_unknown']),output:publicTitleOutputSchema.nullable(),summary:z.string(),canCompleteSaved:z.boolean(),canEndExpired:z.boolean()}).strict();
export type PublicTitleResult=z.infer<typeof publicTitleResultSchema>;
export const publicTitleChoiceSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('save_library'),requestKey:uuid,trialId:uuid,sourceVersionId:uuid,sourceHash:hash,groupIndex:z.number().int().min(0).max(4),titleIndex:z.number().int().min(0).max(4)}).strict(),
 z.object({action:z.literal('archive_library'),requestKey:uuid,trialId:uuid,sourceVersionId:uuid,sourceHash:hash,groupIndex:z.number().int().min(0).max(4),titleIndex:z.number().int().min(0).max(4),resourceId:uuid,expectedRevision:z.number().int().positive(),confirm:z.literal(true)}).strict(),
 z.object({action:z.literal('adopt_book_title'),requestKey:uuid,trialId:uuid,sourceVersionId:uuid,sourceHash:hash,groupIndex:z.number().int().min(0).max(4),titleIndex:z.number().int().min(0).max(4),bookId:uuid,expectedBookRevision:z.number().int().positive(),confirm:z.literal(true)}).strict(),
]);
export type PublicTitleChoice=z.infer<typeof publicTitleChoiceSchema>;
export const publicTitleChoiceReceiptSchema=z.object({requestKey:uuid,inputHash:hash,command:publicTitleChoiceSchema,title:z.string(),resourceId:uuid.nullable(),versionId:uuid.nullable(),bookRevision:z.number().int().positive().nullable()}).strict();
export const publicTitleWorkspaceSchema=z.object({capability:z.object({installed:z.boolean(),operational:z.boolean()}).strict(),results:z.array(publicTitleResultSchema).max(200),truncated:z.boolean(),nextCursor:uuid.nullable()}).strict();
export const publicTitleLibrarySchema=z.object({items:z.array(z.object({id:uuid,versionId:uuid,revision:z.number().int().positive(),title:z.string(),status:z.enum(['active','archived']),originalChoice:publicTitleChoiceSchema,usedBy:z.array(z.object({bookId:uuid,bookName:z.string(),requestKey:uuid}).strict()).max(100),usageTruncated:z.boolean()}).strict()).max(200),truncated:z.boolean(),nextCursor:uuid.nullable()}).strict();
