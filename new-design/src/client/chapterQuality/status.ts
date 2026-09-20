import type {BookInsightChapter,BookInsightQualityItem} from '../../common/contracts';
import type {ChapterQualityReceipt} from '../../common/chapterQuality';

export interface ChapterQualityStatus {label:string;detail:string;action:'diagnose'|'repair'|'recheck'|'none';issueId?:string;}
const actionable=new Set(['open','acknowledged','deferred','fix_proposed']);
export function chapterQualityStatus(chapter:BookInsightChapter|null,receipts:ChapterQualityReceipt[]|null,items:BookInsightQualityItem[]):ChapterQualityStatus {
 if(!chapter)return {label:'尚无正文档案',detail:'先在章节工作台建立并采用正文。',action:'none'};
 if(!chapter.adoptedBodyVersionId)return {label:'尚无采用正文',detail:'诊断只检查本章已采用的正文。',action:'none'};
 if(!receipts)return {label:'正在读取检查记录',detail:'检查状态尚未确认，不能判为通过。',action:'none'};
 const issues=items.filter(item=>item.chapterDocumentId===chapter.chapterDocumentId&&item.bodyVersionId===chapter.adoptedBodyVersionId&&!item.reportStale&&actionable.has(item.status));
 if(issues.length)return {label:`${issues.length} 项待处理`,detail:'已找到当前采用正文的质量问题，前往现有修复流程。',action:'repair',issueId:issues[0].issueId};
 const fixed=items.filter(item=>item.chapterDocumentId===chapter.chapterDocumentId&&item.status==='fixed');
 if(fixed.length)return {label:`${fixed.length} 项待复检`,detail:'修复已登记，但尚未对当前采用正文完成复检；不能判为通过。',action:'recheck',issueId:fixed[0].issueId};
 const current=receipts.filter(item=>item.input.bodyVersionId===chapter.adoptedBodyVersionId);
 const succeeded=current[0]?.status==='succeeded'&&current[0].reportId;
 if(!succeeded)return {label:current.some(item=>item.status==='running')?'检查进行中':receipts.length?'当前正文待重新检查':'未检查不代表通过',detail:'没有当前采用正文的成功检查报告；不能判为通过。',action:current.some(item=>item.status==='running')?'none':'diagnose'};
 return {label:'已检查，当前无待处理问题',detail:'仅表示已读取报告中无待处理项；后续改稿仍需复检。',action:'none'};
}
