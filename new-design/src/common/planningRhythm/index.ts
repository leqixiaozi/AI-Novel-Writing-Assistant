import {z} from 'zod';
export const tensionCurveSchema=z.object({value:z.number().min(0).max(100).nullable(),source:z.enum(['user','ai']),locked:z.boolean(),beatKey:z.string().max(100).default('')}).strict();
export type PlannedTension=z.infer<typeof tensionCurveSchema>;
export const TENSION_SCALE='chapter-tension-v1';
export const REFERENCE_CURVES=[{key:'escalation',label:'升级流',values:[22,30,42,38,56,66,62,82,72]},{key:'suspense',label:'悬疑流',values:[35,46,40,58,52,68,64,78,88]}] as const;
export function referenceTension(values:readonly number[],count:number):number[]{if(count<1||!values.length)return[];return Array.from({length:count},(_,index)=>{const position=count===1?0:index/(count-1)*(values.length-1),left=Math.floor(position),right=Math.ceil(position);return Math.round(values[left]+(values[right]-values[left])*(position-left));});}
export function plannedTension(value:unknown):PlannedTension|null{const result=tensionCurveSchema.safeParse(value);return result.success?result.data:null;}
export interface ObservedChapterTension {chapterCardId:string;chapterDocumentId:string;bodyVersionId:string;reportId:string;requestId:string;value:number;reason:string;scaleVersion:typeof TENSION_SCALE;}
