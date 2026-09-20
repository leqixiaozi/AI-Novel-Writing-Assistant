import {z} from 'zod';

const uuid=z.string().uuid();
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const worldUsageSourceSchema=z.object({
  cardId:uuid,versionId:uuid,typeKey:z.string(),title:z.string(),values:z.record(z.string(),z.unknown()),
  slotKey:z.enum(['factions','locations','rules']),mountId:uuid.nullable(),mountRevision:z.number().int().positive().nullable(),
}).strict();
export const worldUsageSelectionSchema=z.object({
  primaryLocationId:uuid.nullable(),factionIds:z.array(uuid).max(50),locationIds:z.array(uuid).max(50),ruleIds:z.array(uuid).max(50),
  boundary:z.string().trim().max(4000),
}).strict();
export const worldUsageSourcesSchema=z.object({
  bookId:uuid,rootCardId:uuid,rootVersionId:uuid,rootTitle:z.string(),rootValues:z.record(z.string(),z.unknown()),formVersionId:uuid.nullable(),instanceId:uuid.nullable(),instanceRevision:z.number().int().positive().nullable(),
  associationSources:z.array(z.object({instanceId:uuid,formVersionId:uuid,instanceRevision:z.number().int().positive(),mounts:z.array(z.object({mountId:uuid,revision:z.number().int().positive(),versionId:uuid,cardId:uuid,attachedVersionId:uuid,slotKey:z.string(),sortOrder:z.number().int(),localValues:z.record(z.string(),z.unknown())}).strict()).max(300)}).strict()).max(20),
  cards:z.array(worldUsageSourceSchema).max(150),sourceHash:hash,
}).strict();
export const worldUsagePrepareInputSchema=z.object({requestKey:uuid,mode:z.enum(['manual','ai']),expectedSourceHash:hash,
  selection:worldUsageSelectionSchema.optional(),instruction:z.string().trim().max(2000).default(''),
}).strict().superRefine((input,ctx)=>{if(input.mode==='manual'&&!input.selection)ctx.addIssue({code:'custom',path:['selection'],message:'人工候选必须提供完整选择。'});if(input.mode==='ai'&&input.selection)ctx.addIssue({code:'custom',path:['selection'],message:'AI 建议由精确来源生成，不能预填选择。'});});
export const worldUsageCandidateSchema=z.object({id:uuid,bookId:uuid,rootCardId:uuid,requestKey:uuid,inputHash:hash,mode:z.enum(['manual','ai']),status:z.enum(['running','review','failed','ended_unknown']),sources:worldUsageSourcesSchema,
  selection:worldUsageSelectionSchema.nullable(),usedTokens:z.number().int().nonnegative().nullable(),message:z.string(),createdAt:z.string(),
}).strict();
export const worldUsageAdoptInputSchema=z.object({requestKey:uuid,candidateId:uuid,expectedSourceHash:hash,expectedCurrentVersion:z.number().int().nonnegative()}).strict();
export const worldUsageAdoptionSchema=z.object({id:uuid,bookId:uuid,rootCardId:uuid,candidateId:uuid,requestKey:uuid,inputHash:hash,version:z.number().int().positive(),sources:worldUsageSourcesSchema,selection:worldUsageSelectionSchema,createdAt:z.string()}).strict();
const creativeCardSchema=z.object({cardId:uuid,versionId:uuid,title:z.string(),values:z.record(z.string(),z.unknown())}).strict();
export const worldUsageCreativeScopeSchema=z.object({rootCardId:uuid,rootVersionId:uuid,rootTitle:z.string(),rootValues:z.record(z.string(),z.unknown()),adoptionId:uuid,version:z.number().int().positive(),sourceHash:hash,primaryLocationId:uuid.nullable(),boundary:z.string().max(4000),factions:z.array(creativeCardSchema).max(50),locations:z.array(creativeCardSchema).max(50),rules:z.array(creativeCardSchema).max(50)}).strict();
export const worldUsageCreativeScopesSchema=z.array(worldUsageCreativeScopeSchema).max(20);
export const worldUsageWorkspaceSchema=z.object({bookId:uuid,rootCardId:uuid,capability:z.object({installed:z.boolean(),operational:z.boolean()}).strict(),sources:worldUsageSourcesSchema.nullable(),candidates:z.array(worldUsageCandidateSchema).max(50),adopted:worldUsageAdoptionSchema.nullable(),stale:z.boolean(),staleReason:z.string().nullable()}).strict();
export type WorldUsageSource=z.infer<typeof worldUsageSourceSchema>;
export type WorldUsageSources=z.infer<typeof worldUsageSourcesSchema>;
export type WorldUsageSelection=z.infer<typeof worldUsageSelectionSchema>;
export type WorldUsagePrepareInput=z.infer<typeof worldUsagePrepareInputSchema>;
export type WorldUsageCandidate=z.infer<typeof worldUsageCandidateSchema>;
export type WorldUsageAdoptInput=z.infer<typeof worldUsageAdoptInputSchema>;
export type WorldUsageAdoptionReceipt=z.infer<typeof worldUsageAdoptionSchema>;
export type WorldUsageCreativeScope=z.infer<typeof worldUsageCreativeScopeSchema>;
export type WorldUsageWorkspace=z.infer<typeof worldUsageWorkspaceSchema>;

export function validateWorldUsageSelection(sources:WorldUsageSources,selection:WorldUsageSelection):void{
  const groups={factions:selection.factionIds,locations:selection.locationIds,rules:selection.ruleIds} as const;
  for(const [slot,ids] of Object.entries(groups)){
    if(new Set(ids).size!==ids.length)throw Error('使用范围不能重复选择同一来源。');
    for(const id of ids)if(!sources.cards.some(card=>card.cardId===id&&card.slotKey===slot))throw Error('使用范围包含当前本书世界来源以外的资料。');
  }
  if(selection.primaryLocationId&&!selection.locationIds.includes(selection.primaryLocationId))throw Error('主舞台必须在本次保留的地点中。');
  if(!selection.factionIds.length&&!selection.locationIds.length&&!selection.ruleIds.length)throw Error('至少明确保留一项正式世界来源。');
}

export function worldUsageCreativeScopes(adoptions:WorldUsageAdoptionReceipt[]):WorldUsageCreativeScope[]{
 return worldUsageCreativeScopesSchema.parse(adoptions.map(adoption=>{
  const selected=(ids:string[])=>ids.map(id=>{const source=adoption.sources.cards.find(card=>card.cardId===id);if(!source)throw Error('已采用世界范围缺少原资料，不能以摘要代替正式来源。');return{cardId:source.cardId,versionId:source.versionId,title:source.title,values:source.values};});
  return{rootCardId:adoption.rootCardId,rootVersionId:adoption.sources.rootVersionId,rootTitle:adoption.sources.rootTitle,rootValues:adoption.sources.rootValues,adoptionId:adoption.id,version:adoption.version,sourceHash:adoption.sources.sourceHash,primaryLocationId:adoption.selection.primaryLocationId,boundary:adoption.selection.boundary,factions:selected(adoption.selection.factionIds),locations:selected(adoption.selection.locationIds),rules:selected(adoption.selection.ruleIds)};
 }));
}
