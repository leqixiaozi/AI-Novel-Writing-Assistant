import {z} from "zod";
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const formPreviewSchema=z.object({sourceTemplateVersionId:uuid,sourceFormVersionId:uuid,targetFormId:uuid.nullable().optional(),setActive:z.boolean()}).strict();
export const formInstallSchema=formPreviewSchema.extend({previewHash:hash,requestKey:uuid});
export const formSelectSchema=z.object({formVersionId:uuid,expectedBookRevision:z.number().int().positive(),requestKey:uuid}).strict();
export const instanceUpgradeSchema=z.object({instanceId:uuid,targetFormVersionId:uuid,expectedInstanceRevision:z.number().int().positive(),previewHash:hash,requestKey:uuid}).strict();
export const associationPublicationPreviewSchema=z.object({sourceTemplateVersionId:uuid,primaryTypeKeys:z.array(z.enum(['character','world_setting','world_rule'])).max(3)}).strict();
export const associationPublicationSchema=associationPublicationPreviewSchema.extend({templateRevision:z.number().int().positive(),previewHash:hash,requestKey:uuid});
export const installationSchema=z.object({
  sourceTemplateVersionId:uuid,sourceFormId:uuid,sourceFormVersionId:uuid,sourceDefinitionHash:hash,previousFormVersionId:uuid.nullable(),
  typeMappings:z.array(z.object({key:z.string(),sourceId:uuid,sourceVersionId:uuid,targetId:uuid,targetVersionId:uuid}).strict()),
  relationMappings:z.array(z.object({key:z.string(),targetKey:z.string(),sourceId:uuid,sourceVersion:z.object({kind:z.literal('template_snapshot'),versionId:uuid,definitionHash:hash}).strict(),targetId:uuid,targetDefinitionHash:hash}).strict()),
  dictionaryMappings:z.array(z.object({sourceId:uuid,sourceVersion:z.object({kind:z.literal('template_snapshot'),versionId:uuid,definitionHash:hash}).strict(),targetId:uuid,nodes:z.array(z.object({sourceId:uuid,targetId:uuid,targetVersionId:uuid}).strict())}).strict()),
}).strict();
