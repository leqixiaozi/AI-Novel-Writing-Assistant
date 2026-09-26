import {z} from 'zod';

export const COMIC_FORMATS=[
 {key:'webtoon',label:'条漫'}, {key:'4koma',label:'四格漫'},
 {key:'single_page',label:'单页漫'}, {key:'cinematic',label:'电影分镜'},
 {key:'chat_comic',label:'聊天漫'}, {key:'chibi_comic',label:'Q版萌漫'},
 {key:'ink_comic',label:'水墨国风'}, {key:'drama_screenshot',label:'短剧截图漫'},
] as const;
export const COMIC_STYLES=[
 {key:'webtoon_color',label:'彩色韩漫'}, {key:'bl_manga',label:'彩色少女漫'},
 {key:'shounen_bw',label:'黑白少年漫'}, {key:'ink_traditional',label:'水墨国风'},
 {key:'chibi',label:'Q版萌漫'}, {key:'realistic',label:'写实风格'},
] as const;
export const comicSourceSchema=z.enum(['novel_import','original','text_import']);
export const comicCreateSchema=z.object({
 requestKey:z.string().uuid(), title:z.string().trim().min(1).max(120),
 sourceType:comicSourceSchema, sourceBookId:z.string().uuid().optional(),
 sourceText:z.string().trim().min(1).max(2_000_000).optional(),
 comicFormat:z.enum(['webtoon','4koma','single_page','cinematic','chat_comic','chibi_comic','ink_comic','drama_screenshot']),
 stylePreset:z.enum(['webtoon_color','bl_manga','shounen_bw','ink_traditional','chibi','realistic']),
}).strict().superRefine((value,context)=>{
 const novel=value.sourceType==='novel_import';
 if(novel&&!value.sourceBookId||!novel&&value.sourceBookId)context.addIssue({code:'custom',path:['sourceBookId'],message:'小说来源必须且只能指定本书。'});
 if(novel&&value.sourceText||!novel&&!value.sourceText)context.addIssue({code:'custom',path:['sourceText'],message:'原创或文本导入必须且只能提供来源内容。'});
});
export type ComicCreateInput=z.infer<typeof comicCreateSchema>;
export interface ComicProjectSummary {id:string;title:string;sourceType:z.infer<typeof comicSourceSchema>;comicFormat:typeof COMIC_FORMATS[number]['key'];stylePreset:typeof COMIC_STYLES[number]['key'];status:'draft';revision:number;sourceVersionId:string;createdAt:string;updatedAt:string;}
export interface ComicSourceSnapshot {id:string;type:z.infer<typeof comicSourceSchema>;sourceBookId:string|null;sourceBookName:string|null;content:string;contentHash:string;manifest:{chapters:Array<{documentId:string;bodyVersionId:string;title:string}>};createdAt:string;}
export interface ComicProjectDetail {project:ComicProjectSummary;source:ComicSourceSnapshot;}
export interface ComicCreateReceipt extends ComicProjectDetail {requestKey:string;repeated:boolean;}
export interface ComicCapability {installed:boolean;operational:boolean;reason:string;}
