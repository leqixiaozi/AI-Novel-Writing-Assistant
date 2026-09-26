import {z} from 'zod';
import {worldInstallInputSchema,worldLibraryInputSchema,worldValueSchema,WORLD_SECTIONS} from '../../common/worldPackages';

const uuid=z.string().uuid(),key=z.string().max(100),targetId=z.union([uuid,z.literal('')]);
export const fieldSelectionSchema=z.object({sourceCardId:uuid,sourceKey:key.min(1),targetKey:key,decision:z.enum(['keep','take']),value:worldValueSchema.optional()}).strict();
export type FieldSelection=z.infer<typeof fieldSelectionSchema>;
const card=worldInstallInputSchema.shape.cards.element.extend({targetTypeId:targetId,mapping:z.array(z.object({sourceKey:key.min(1),targetKey:key,value:z.unknown()}).strict().refine(item=>Object.hasOwn(item,'value'))).max(500)});
const relation=z.object({sourceRelationId:uuid,targetTypeId:targetId,decision:z.enum(['keep','take','detach']),sourceCardId:uuid,targetCardId:uuid,properties:z.record(key.min(1),z.unknown()),propertiesEdited:z.boolean().optional()}).strict();
export const worldSyncDraftSchema=z.object({bookId:uuid,rootCardId:uuid,packageId:uuid.optional(),choices:z.record(z.string().max(210),fieldSelectionSchema),newCards:z.array(card).max(300).default([]),relationChoices:z.array(relation).max(500).default([])}).strict();
export const worldImportDraftSchema=worldInstallInputSchema.safeExtend({cards:z.array(card).min(1).max(300),relations:z.array(worldInstallInputSchema.shape.relations.element.extend({targetTypeId:targetId})).max(500)});
export const worldLibraryDraftSchema=worldLibraryInputSchema.safeExtend({cards:z.array(card.extend({sourceVersionId:uuid,section:z.enum(WORLD_SECTIONS),privateKeys:z.array(key.min(1)).max(500)})).min(1).max(300),relations:z.array(worldLibraryInputSchema.shape.relations.element.extend({targetTypeId:targetId})).max(500)});

