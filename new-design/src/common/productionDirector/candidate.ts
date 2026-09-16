import type {ChapterGenerationOutput} from './index';
export interface CandidateInput {body:{content:string}|null;selection:{start:number;end:number;text:string}|null;}
/** Deterministic handling of a frozen selection, never selection of business intent. */
export function originalChapterCandidateContent(input:CandidateInput,output:ChapterGenerationOutput):string{
  if(!output.content.trim())throw new Error('原回复没有可用正文，不能导入候选。');
  if(!input.selection)return output.content;
  const {start,end,text}=input.selection,body=input.body?.content;
  if(body===undefined||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>body.length||body.slice(start,end)!==text)throw new Error('原选区与冻结输入正文不一致，禁止覆盖或用其他选区代替。');
  return body.slice(0,start)+output.content+body.slice(end);
}
