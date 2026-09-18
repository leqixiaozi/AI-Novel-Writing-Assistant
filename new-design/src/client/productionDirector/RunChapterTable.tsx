import {useState} from 'react';
import type {DirectorRun} from '../../common/productionDirector';
import type {ChapterWritingWorkspace} from '../../common/contracts';
import Help from '../storyWorkspace/Help';
const statuses={pending:'待生成',running:'原生成待核对',candidate_saved:'候选已保存',failed:'本章待处理',unknown:'原调用及用量未知'};
const decisions={continue:'继续',continue_with_warning:'继续，保留局部提醒',pause_for_manual:'按策略请求人工审阅',stop_for_replan:'明确需重规划'};
export default function RunChapterTable({run,writing}:{run:DirectorRun;writing:ChapterWritingWorkspace}) {
 const [filter,setFilter]=useState('all'),[query,setQuery]=useState('');
 const saved=run.chapters.filter(chapter=>chapter.status==='candidate_saved').length,visible=run.chapters.filter(chapter=>(filter==='all'||chapter.status===filter)&&(!query||chapter.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
 return <section className="nd-director-progress"><h3>章节运行进度 <Help label="章节运行进度">进度仅表示此范围的候选准备情况；采用与结算读取当前原正文状态。未知调用保留原请求，刷新只读，不重发模型。局部提醒不自动中断全书，停止由原结构化决定及问题策略控制。</Help></h3><label>候选已保存 {saved} / {run.chapters.length} 章<progress value={saved} max={Math.max(1,run.chapters.length)}/></label>
  <div className="nd-row-actions"><label>运行状态<select value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">全部</option>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>查找本次章节<input value={query} onChange={event=>setQuery(event.target.value)}/></label></div>
  <div className="nd-table-scroll"><table><caption>本次原范围的 {visible.length} / {run.chapters.length} 章</caption><thead><tr><th scope="col">章节</th><th scope="col">本次状态</th><th scope="col">原回复／边界</th><th scope="col">处理决定与提醒</th><th scope="col">当前正式状态</th><th scope="col">核对入口</th></tr></thead><tbody>{visible.map(item=>{const chapter=writing.chapters.find(chapter=>chapter.chapterCardId===item.chapterCardId);return <tr key={item.chapterCardId}><th scope="row">{item.title}</th><td>{statuses[item.status]}</td><td>{item.modelResultSaved?'原回复已保留':'尚无已保存回复'}{item.ledgerPending&&<p>用量登记待核对</p>}{item.boundaryPending&&<p>章边界待核对</p>}{item.leaseExpired&&<p>原领取已过期</p>}</td><td>{item.decision?decisions[item.decision]:'尚无决定'}{item.warnings.map((warning,index)=><p key={index}>{warning}</p>)}{item.failure&&<p role="alert">{item.failure.failedStep}：{item.failure.summary}</p>}</td><td>{!chapter?'未读取到原章节':chapter.state==='stable'?'当前正文已稳定结算':chapter.adoptedBodyVersionId?'已有采用正文，核对结算':'尚无采用正文'}</td><td><a href={`/new-design/books/${run.bookId}/writing?chapter=${item.chapterCardId}`}>原候选、采用与结算</a><a href={`/new-design/books/${run.bookId}/planning?plan=${item.planningObjectId}`}>原章节规划</a></td></tr>;})}</tbody></table></div>{!visible.length&&<p>此筛选没有匹配章节。</p>}
 </section>;
}
