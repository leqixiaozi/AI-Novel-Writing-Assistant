import {z} from 'zod';

export const comicDialogueSchema=z.object({speaker:z.string().trim().max(120),text:z.string().trim().min(1).max(1000),bubbleType:z.enum(['round','spike','cloud','caption']),anchorHint:z.string().trim().max(120).nullable()}).strict();
export const comicPanelSchema=z.object({order:z.number().int().min(1).max(80),panelType:z.string().trim().min(1).max(80),action:z.string().trim().min(1).max(2000),dialogues:z.array(comicDialogueSchema).max(12),characterRefs:z.array(z.string().trim().min(1).max(120)).max(20),sceneRef:z.string().trim().max(120).nullable(),visualPrompt:z.string().trim().min(1).max(4000),densityLevel:z.enum(['low','medium','high']).nullable(),focus:z.string().trim().max(300).nullable(),layoutData:z.record(z.string(),z.unknown()).nullable()}).strict();
export const comicPanelProposalSchema=z.object({requestKey:z.string().uuid(),expectedScriptRevision:z.number().int().min(0),episodeVersionId:z.string().uuid(),densityMode:z.enum(['relaxed','balanced','compact']),panels:z.array(comicPanelSchema).min(1).max(80)}).strict().superRefine((value,context)=>{value.panels.forEach((panel,index)=>{if(panel.order!==index+1)context.addIssue({code:'custom',path:['panels',index,'order'],message:'分格顺序必须从 1 连续排列。'});});});
export const comicPanelScriptSchema=z.object({requestKey:z.string().uuid(),expectedScriptRevision:z.number().int().min(0),episodeVersionId:z.string().uuid(),densityMode:z.enum(['relaxed','balanced','compact']),instruction:z.string().trim().max(4000).default('')}).strict();
export const comicPanelScriptPromptSchema=z.object({operation:z.literal('panel_script'),projectId:z.string().uuid(),episodeId:z.string().uuid(),episodeVersionId:z.string().uuid(),episode:z.object({title:z.string(),outline:z.string(),hookType:z.string().nullable(),cliffhanger:z.string().nullable(),isPaywalled:z.boolean(),sourceText:z.string().nullable()}),densityMode:z.enum(['relaxed','balanced','compact']),continuity:z.object({characters:z.array(z.object({name:z.string(),role:z.string(),visualAnchor:z.string()})),synopsis:z.string().nullable()}),instruction:z.string().trim().max(4000)}).strict();
export const comicPanelAdoptionSchema=z.object({requestKey:z.string().uuid(),setId:z.string().uuid(),expectedScriptRevision:z.number().int().min(0)}).strict();
export type ComicPanel=z.infer<typeof comicPanelSchema>&{id:string};
export type ComicPanelProposalInput=z.infer<typeof comicPanelProposalSchema>;
export type ComicPanelScriptInput=z.infer<typeof comicPanelScriptSchema>;
export type ComicPanelScriptPrompt=z.infer<typeof comicPanelScriptPromptSchema>;
export type ComicPanelAdoptionInput=z.infer<typeof comicPanelAdoptionSchema>;
export interface ComicPanelSet {id:string;episodeId:string;version:number;episodeVersionId:string;densityMode:'relaxed'|'balanced'|'compact';sourceKind:'manual'|'ai_candidate';panels:ComicPanel[];createdAt:string;}
export interface ComicPanelWorkspace {projectId:string;episodeId:string;episodeOrder:number;episodeTitle:string;episodeVersionId:string;adoptedSetId:string|null;adoptedReady:boolean;scriptRevision:number;sets:ComicPanelSet[];}
export interface ComicPanelProposalReceipt {set:ComicPanelSet;requestKey:string;repeated:boolean;}
export interface ComicPanelAdoptionReceipt {workspace:ComicPanelWorkspace;adoptedSetId:string;adoptionRevision:number;requestKey:string;repeated:boolean;}

export type ComicGenerationOperation='source_extract'|'episode_outline'|'panel_script';
export interface ComicGenerationReceipt {requestKey:string;operation:ComicGenerationOperation;sourceVersionIds:readonly string[];candidateVersionId:string|null;status:'queued'|'running'|'succeeded'|'failed'|'unknown';repeated:boolean;readiness:'current'|'stale_source';adopted:boolean;}
