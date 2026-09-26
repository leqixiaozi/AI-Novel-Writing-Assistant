import {z} from 'zod';
export const storyFormatSchema=z.object({form:z.enum(['long_novel','short_story']),targetWordCount:z.number().int().min(3000).max(3000000)}).strict().superRefine((value,ctx)=>{if(value.form==='short_story'&&value.targetWordCount>30000||value.form==='long_novel'&&value.targetWordCount<=30000)ctx.addIssue({code:'custom',path:['targetWordCount'],message:value.form==='short_story'?'短篇目标为 3,000—30,000 字。':'长篇目标需超过 30,000 字。'});});
export type StoryFormat=z.infer<typeof storyFormatSchema>;
export const derivedStorySourceSchema=z.object({bookId:z.string().uuid(),documentId:z.string().uuid(),bodyVersionId:z.string().uuid(),contentHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type DerivedStorySource=z.infer<typeof derivedStorySourceSchema>;
export function readStoryFormat(value:unknown):StoryFormat|null {const parsed=storyFormatSchema.safeParse(value);return parsed.success?parsed.data:null;}
export function storyFormatDescription(value:StoryFormat):string {return `${value.form==='short_story'?'连续完整短篇':'长篇小说'}，目标约 ${value.targetWordCount.toLocaleString('zh-CN')} 字${value.form==='short_story'?'；单一正文档案承载整篇，场景只作内部节拍，不拆成长篇连载章节':'；按卷章逐步推进'}`;}
export function shortStoryShapeIssues(plans:ReadonlyArray<{level:string;decision:string;content:{storyFormat?:StoryFormat}}>,format:StoryFormat|null,complete=false):string[] {
 if(!format)return [];
 const included=plans.filter(plan=>plan.decision!=='exclude'),issues:string[]=[];
 for(const plan of included)if(plan.level!=='story'&&plan.content.storyFormat)issues.push('作品形式只保存于故事总纲，不在卷章中另存一份。');
 for(const plan of included)if(plan.level==='story'&&(plan.content.storyFormat?.form!==format.form||plan.content.storyFormat?.targetWordCount!==format.targetWordCount))issues.push('故事总纲须保留本次明确选择的作品形式与目标字数。');
 if(format.form==='short_story') {
  for(const level of ['story','volume','chapter']){const current=included.filter(plan=>plan.level===level);if(current.length>1||complete&&(current.length!==1||current[0]?.decision!=='adopt'))issues.push(`短篇须明确采用唯一${level==='story'?'故事总纲':level==='volume'?'内部结构卷':'整篇正文计划'}；场景可作为内部节拍。`);}
 }
 return issues;
}
