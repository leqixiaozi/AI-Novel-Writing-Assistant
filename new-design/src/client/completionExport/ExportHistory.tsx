import {useEffect,useMemo,useRef,useState} from "react";
import type {BookCompletionWorkspace,PublicationExportFormat} from "../../common/contracts";
import {parseExportSourceSelection,findExportSourceRecord} from "../../common/authorTasks";
import {newDesignApi} from "../api";
const FORMAT_LABELS:Record<PublicationExportFormat,string>={markdown:"Markdown",plain_text:"纯文本",docx:"Word DOCX"};
const STATUS_LABELS:Record<string,string>={queued:"等待生成",leased:"准备生成",running:"生成中",retry_scheduled:"等待重试",succeeded:"可下载",failed:"生成失败",dead_letter:"需要人工处理",cancelled:"已取消",archived:"运行记录已归档"};

/** Existing export receipts are read-only and never populate a new submit manifest. */
export default function ExportHistory({workspace,bookId,reading,onRefresh}:{workspace:BookCompletionWorkspace;bookId:string;reading:boolean;onRefresh:()=>void}){
 const source=useMemo(()=>parseExportSourceSelection(window.location.search),[bookId]);
 const [selectedId,setSelectedId]=useState<string|null>(source.valid?source.requestId:null),[manualSelection,setManualSelection]=useState(false);
 const inspector=useRef<HTMLDivElement>(null);
 useEffect(()=>{setManualSelection(false);setSelectedId(source.valid?source.requestId:null);},[source]);
 const currentSelection=manualSelection?{valid:true as const,requestId:selectedId}:source;
 const selected=findExportSourceRecord(workspace,bookId,currentSelection);
 const failure=!currentSelection.valid?currentSelection.message:currentSelection.requestId&&!selected?"指定导出回执不存在于本书已加载记录，未选其他导出代替。请只读刷新核对原凭证。":"";
 useEffect(()=>{if(selected&&inspector.current){inspector.current.focus({preventScroll:true});inspector.current.scrollIntoView({block:"nearest"});}},[selected?.requestId]);
 return <section aria-labelledby="export-history-title"><div className="nd-section-heading"><div><p className="nd-kicker">导出记录</p><h2 id="export-history-title">文件与任务状态</h2></div><button type="button" className="nd-button" disabled={reading} onClick={onRefresh}>只读刷新导出回执</button></div>
  {failure&&<div className="nd-export-source-failure" role="alert"><p>未完成步骤：定位原导出回执。</p><p>{failure}</p><p>冻结导出清单、原正文与本页导出设置／预览草稿保留；刷新不重新提交任务。</p><a href="/new-design/operations/records">查看原运行记录</a></div>}
  {workspace.bookId===bookId&&workspace.exports.length?<div className="nd-export-history">{workspace.exports.filter(item=>item.manifest.bookId===bookId).map(item=><article key={item.requestId} className={selected?.requestId===item.requestId?"is-selected":""}><button type="button" aria-pressed={selected?.requestId===item.requestId} className="nd-export-history-select" onClick={()=>{setManualSelection(true);setSelectedId(item.requestId);}}><span>{FORMAT_LABELS[item.manifest.format]} · {item.manifest.exportMode==="formal"?"正式稿":"审阅稿"}</span><small>{item.manifest.chapterCount} 章 · {new Date(item.createdAt).toLocaleString()}</small><small>原导出回执：{item.requestId}</small></button><span>{item.artifact?"可下载":STATUS_LABELS[item.jobStatus??""]??"回执待核对"}</span>{item.artifact&&item.artifact.requestId===item.requestId&&item.artifact.manifestId===item.manifest.id&&<a className="nd-button" href={newDesignApi.getPublicationExportDownloadUrl(item.artifact.id)}>下载 {item.artifact.displayFilename}</a>}</article>)}</div>:<div className="nd-empty-state"><p>没有本书可读取的导出记录。</p><p>冻结预览并明确提交后，可在这里核对任务和文件回执。</p></div>}
  {selected&&<div className="nd-export-source-inspector" ref={inspector} tabIndex={-1} aria-label="所选原导出回执"><header><h3>原导出清单与保存结果</h3><p>仅查看原请求，不把这份清单放入新的提交预览。</p></header><dl><dt>导出回执</dt><dd>{selected.requestId}</dd><dt>冻结清单</dt><dd>{selected.manifest.id}</dd><dt>正文范围</dt><dd>{selected.manifest.chapterCount} 章 · {selected.manifest.characterCount.toLocaleString()} 字符（含空白）</dd><dt>任务状态</dt><dd>{selected.artifact?"有文件完成回执":STATUS_LABELS[selected.jobStatus??""]??"任务回执待核对"}</dd></dl>
   <p>保留结果：冻结清单、精确正文版本{selected.artifact?"与文件完成回执":"；文件完成回执未读取到，不表示任务未执行"}。</p>
   {selected.jobStatus&&["failed","dead_letter"].includes(selected.jobStatus)&&<div className="nd-export-source-failure" role="alert"><p>未完成步骤：生成导出文件。</p><p>先只读刷新原回执，核对是否有完成文件；不要重新提交本请求代替原回执。正文与冻结清单保留。</p><a href="/new-design/structure/maintenance">查看运行维护状态（仅导航）</a></div>}
   <ol>{selected.manifest.chapters.map(chapter=><li key={`${chapter.position}:${chapter.chapterDocumentId}`}><span>第 {chapter.chapterOrder} 章 · {chapter.chapterTitle}</span><small>正文 v{chapter.bodyVersion} · 版本凭证 {chapter.bodyVersionId}</small></li>)}</ol>
  </div>}
 </section>;
}
