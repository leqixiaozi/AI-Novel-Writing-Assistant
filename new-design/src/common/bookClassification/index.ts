import {z} from 'zod';
export const PLATFORM_CHOICES=[['ai_recommend','AI 推荐'],['fanqie_free','番茄小说'],['qidian_male','起点中文网'],['jinjiang_female','晋江文学城'],['zhihu_story','知乎故事']] as const;
export const classificationSchema=z.object({publicationStatus:z.enum(['draft','published']).nullable(),writingMode:z.enum(['original','continuation']).nullable(),platform:z.enum(['ai_recommend','fanqie_free','qidian_male','jinjiang_female','zhihu_story']).nullable(),creationExperience:z.enum(['simple','professional']).nullable().default(null)}).strict();
export type BookClassification=z.infer<typeof classificationSchema>;
export const EMPTY_CLASSIFICATION:BookClassification={publicationStatus:null,writingMode:null,platform:null,creationExperience:null};
export const classificationWriteSchema=z.object({requestKey:z.string().uuid(),cardId:z.string().uuid(),expectedRevision:z.number().int().positive(),classification:classificationSchema}).strict();
export type ClassificationWrite=z.infer<typeof classificationWriteSchema>;
export interface ClassificationWorkspace {bookId:string;canInitialize?:boolean;cardId:string|null;revision:number|null;classification:BookClassification;issue:string|null;}
