import {z} from 'zod';

const uuid=z.string().uuid();
export const creativeHubBindingSchema=z.object({
  bookId:uuid.optional(),
  chapterDocumentId:uuid.optional(),
  taskKind:z.string().trim().min(1).max(80).optional(),
  taskId:uuid.optional(),
}).strict().refine(value=>!value.chapterDocumentId||Boolean(value.bookId),{message:'章节绑定必须同时指定作品。',path:['chapterDocumentId']}).refine(value=>Boolean(value.taskKind)===Boolean(value.taskId),{message:'任务类型与任务标识必须同时提供。',path:['taskId']});

export const creativeHubThreadCreateSchema=z.object({title:z.string().trim().min(1).max(120),binding:creativeHubBindingSchema.default({})}).strict();
export const creativeHubThreadUpdateSchema=z.object({title:z.string().trim().min(1).max(120).optional(),binding:creativeHubBindingSchema.optional(),expectedRevision:z.number().int().positive()}).strict().refine(value=>value.title!==undefined||value.binding!==undefined,{message:'没有需要更新的会话信息。'});
export const creativeHubArchiveSchema=z.object({expectedRevision:z.number().int().positive()}).strict();
export const creativeHubTurnRequestSchema=z.object({requestKey:uuid,question:z.string().trim().min(1).max(4000),expectedThreadRevision:z.number().int().positive()}).strict();

export const creativeHubSourceLinkSchema=z.object({label:z.string().trim().min(1).max(120),href:z.string().regex(/^\/new-design(?:\/|$)/),kind:z.enum(['book','chapter','task','workspace'])}).strict();
export const creativeHubStateSchema=z.object({
  book:z.object({id:uuid,name:z.string(),revision:z.number().int().nonnegative().optional()}).strict().nullable(),
  tasks:z.array(z.record(z.string(),z.unknown())),
  blockers:z.array(z.string()),
  sourceLinks:z.array(creativeHubSourceLinkSchema),
}).strict();

export const CREATIVE_HUB_ACTION_KINDS=['query_status','explain_failure','impact_analysis','find_entry'] as const;
export const creativeHubDiagnosticSchema=z.object({
  summary:z.string().trim().min(1).max(4000),
  findings:z.array(z.object({
    kind:z.string().trim().min(1).max(80),
    label:z.string().trim().min(1).max(160),
    detail:z.string().trim().min(1).max(4000),
    severity:z.enum(['info','warning','blocking']),
    source:z.object({kind:z.enum(['book','chapter','task','workspace']),id:uuid.optional(),label:z.string().trim().min(1).max(160)}).strict().optional(),
  }).strict()).max(24),
  actions:z.array(z.object({kind:z.enum(CREATIVE_HUB_ACTION_KINDS),label:z.string().trim().min(1).max(120),href:z.string().regex(/^\/new-design(?:\/|$)/)}).strict()).max(8),
}).strict();

export const creativeHubPromptInputSchema=z.object({question:z.string().trim().min(1).max(4000),binding:creativeHubBindingSchema,state:creativeHubStateSchema}).strict();

export type CreativeHubBinding=z.infer<typeof creativeHubBindingSchema>;
export type CreativeHubState=z.infer<typeof creativeHubStateSchema>;
export type CreativeHubSourceLink=z.infer<typeof creativeHubSourceLinkSchema>;
export type CreativeHubDiagnostic=z.infer<typeof creativeHubDiagnosticSchema>;
export type CreativeHubTurnRequest=z.infer<typeof creativeHubTurnRequestSchema>;
export interface CreativeHubCapability {installed:boolean;operational:boolean;reason:string;}
export interface CreativeHubThread {id:string;title:string;binding:CreativeHubBinding;status:'active'|'archived';revision:number;createdAt:string;updatedAt:string;}
export interface CreativeHubTurn {id:string;threadId:string;requestKey:string;requestHash:string;question:string;frozenState:CreativeHubState;status:'running'|'succeeded'|'failed'|'result_unknown';result:CreativeHubDiagnostic|null;failure:string|null;promptSnapshot:Record<string,unknown>|null;modelSnapshot:Record<string,unknown>|null;usedTokens:number|null;createdAt:string;updatedAt:string;completedAt:string|null;}
