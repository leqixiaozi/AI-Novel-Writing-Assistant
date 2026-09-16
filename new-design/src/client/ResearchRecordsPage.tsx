import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import type {ResearchDocument,ResearchRecordDetail,ResearchRecordSummary,ResearchRecordType} from "../common/contracts";
import {runtimeLabel} from "../common/presentation";
import {parseResearchSourceSelection,findResearchSourceRecord,findResearchSourceVersion,researchMetadataBaseline} from "../common/authorTasks";
import {newDesignApi} from "./api";
import ResearchShell from "./ResearchShell";

const TYPE_LABELS:Record<ResearchRecordType,string>={market_scan:"榜单扫描",market_analysis:"市场拆解",book_analysis:"作品拆书",diagnosis:"稿件诊断"};
export default function ResearchRecordsPage(){
 const source=useRef(parseResearchSourceSelection(window.location.search)).current;
 const [documents,setDocuments]=useState<ResearchDocument[]>([]),[records,setRecords]=useState<ResearchRecordSummary[]>([]),[selectedId,setSelectedId]=useState<string|null>(null),[detail,setDetail]=useState<ResearchRecordDetail|null>(null),[versionId,setVersionId]=useState<string|null>(null);
 const [search,setSearch]=useState(""),[appliedSearch,setAppliedSearch]=useState(""),[type,setType]=useState<ResearchRecordType|"">(""),[favoriteOnly,setFavoriteOnly]=useState(false),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[message,setMessage]=useState("");
 const [sourceFailure,setSourceFailure]=useState(source.valid?"":source.message),[failure,setFailure]=useState("");
 const [readRevision,setReadRevision]=useState(0);
 const [title,setTitle]=useState(""),[sourceUrl,setSourceUrl]=useState(""),[content,setContent]=useState(""),[baseline,setBaseline]=useState(""),[pendingSelection,setPendingSelection]=useState<string|null>(null);
 const generation=useRef(0),detailGeneration=useRef(0),activeId=useRef<string|null>(null),sourceActive=useRef(true),mounted=useRef(true);
 const viewedVersionRef=useRef(source.valid?source.versionId:null);
 const dirty=!!detail&&researchMetadataBaseline(detail)!==baseline,sourceTextDirty=!!(title||sourceUrl||content);
 const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
 const editDetail=(next:ResearchRecordDetail)=>{dirtyRef.current=true;setDetail(next);};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;detailGeneration.current++;};},[]);
 useEffect(()=>{const handler=(event:BeforeUnloadEvent)=>{if(dirty||sourceTextDirty){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",handler);return()=>window.removeEventListener("beforeunload",handler);},[dirty,sourceTextDirty]);
 const load=useCallback(async()=>{
  const request=++generation.current;setReading(true);setFailure("");
  try{const [nextDocuments,nextRecords]=await Promise.all([newDesignApi.listResearchDocuments(),newDesignApi.listResearchRecords({type:type||undefined,favorite:favoriteOnly,search:appliedSearch||undefined})]);
   if(!mounted.current||request!==generation.current)return;setDocuments(nextDocuments);setRecords(nextRecords);
   if(sourceActive.current){
    if(!source.valid){setSourceFailure(source.message);return;}
    if(source.recordId){const target=findResearchSourceRecord(nextRecords,source);if(!target){setSourceFailure("指定研究记录不存在于本次加载列表，或不符合筛选条件；未选择其他记录代替。请清除筛选后重新核对原来源。");return;}
     setSourceFailure("");activeId.current=target.id;setSelectedId(target.id);return;}
   }
   if(!activeId.current&&nextRecords[0]){activeId.current=nextRecords[0].id;setSelectedId(nextRecords[0].id);}
   // Refresh never replaces a selected author's metadata draft or selects a substitute.
  }catch{if(mounted.current&&request===generation.current)setFailure("研究资料未读取。参考文本、说明草稿和来源版本保留，可只读刷新核对。");}
  finally{if(mounted.current&&request===generation.current)setReading(false);}
 },[source,type,favoriteOnly,appliedSearch]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{
  const request=++detailGeneration.current;if(!selectedId){setDetail(null);setVersionId(null);return;}setFailure("");
  let active=true;void newDesignApi.getResearchRecord(selectedId).then(next=>{
   if(!active||!mounted.current||request!==detailGeneration.current)return;
   if(next.id!==selectedId){setSourceFailure("研究详情不属于所选记录；原说明草稿保留，未切换到其他记录。");return;}
   if(dirtyRef.current){setMessage("只读详情已返回；本页说明草稿保留，保存前不替换详情。");return;}
   setDetail(next);setBaseline(researchMetadataBaseline(next));
   const selection=sourceActive.current&&source.valid&&source.recordId?source:{valid:true as const,recordId:selectedId,versionId:viewedVersionRef.current};
   const version=findResearchSourceVersion(next,selection);
   if(!version){setVersionId(null);setSourceFailure("指定运行版本不存在于这条研究记录，未用当前版本代替。请核对原记录与版本凭证。");return;}
   viewedVersionRef.current=version.id;setVersionId(version.id);setSourceFailure("");
  }).catch(()=>{if(active&&mounted.current&&request===detailGeneration.current)setFailure("所选研究详情未读取。原说明草稿和版本保留，可只读核对；不重跑研究。 ");});
  return()=>{active=false;};
 },[selectedId,source,readRevision]);
 const refreshSource=()=>{void load();if(!dirty)setReadRevision(value=>value+1);else setMessage("列表只读刷新；未保存说明保持在本页，保存前不替换详情。");};
 const viewedVersion=detail&&versionId?detail.versions.find(version=>version.id===versionId&&version.recordId===detail.id)??null:null;
 const choose=(id:string)=>{
  if(busy||id===selectedId)return;if(dirty){setPendingSelection(id);return;}dirtyRef.current=false;viewedVersionRef.current=null;sourceActive.current=false;activeId.current=id;setDetail(null);setVersionId(null);setSourceFailure("");setSelectedId(id);
 };
 const discardAndChoose=()=>{if(!pendingSelection||busy)return;const id=pendingSelection;setPendingSelection(null);dirtyRef.current=false;viewedVersionRef.current=null;sourceActive.current=false;activeId.current=id;setDetail(null);setVersionId(null);setSourceFailure("");setSelectedId(id);};
 async function createDocument(){setBusy(true);setMessage("");setFailure("");try{await newDesignApi.createResearchDocument({title,content,sourceKind:"paste",sourceUrl});setTitle("");setSourceUrl("");setContent("");await load();setMessage("参考文本 v1 已保存，可用于拆书；后续版本不会覆盖这份原文。");}catch{setFailure("参考文本保存结果未确认。输入内容保留，请先核对原资料列表，不重复提交。 ");}finally{setBusy(false);}}
 async function saveRecord(next:ResearchRecordDetail){
  setBusy(true);setMessage("");setFailure("");const savingId=next.id;
  try{const saved=await newDesignApi.updateResearchRecord(next);if(saved.id!==savingId)throw Error("record mismatch");
   if(activeId.current===savingId){const merged={...next,...saved,versions:next.versions,evidence:next.evidence,candidates:next.candidates};dirtyRef.current=false;setDetail(merged);setBaseline(researchMetadataBaseline(merged));}
   await load();setMessage("研究记录说明已保存；运行报告和版本保持独立。");
  }catch{setFailure("研究说明保存结果未确认。当前说明草稿与运行报告保留；请先核对来源回执，不重跑研究。");}finally{setBusy(false);}
 }
 const statusCounts=useMemo(()=>Object.fromEntries(Object.keys(TYPE_LABELS).map(key=>[key,records.filter(item=>item.type===key).length])),[records]);
 return <ResearchShell active="records"><main className="nd-research-home">
  {(sourceFailure||failure)&&<div className="nd-message is-error" role="alert"><p>未完成步骤：{sourceFailure?"定位研究来源":"读取或保存研究资料"}</p><p>{sourceFailure||failure}</p><p>保留内容：参考文本、已有研究报告与人工说明草稿。</p><button type="button" className="nd-button" disabled={busy||reading} onClick={refreshSource}>只读核对原来源</button><a href="/new-design/operations/records">查看原运行记录</a></div>}
  <section className="nd-research-source"><div className="nd-section-heading"><div><p className="nd-kicker">真实文本来源</p><h2>保存一份可追溯的参考文本</h2><p>粘贴公开文本或你有权分析的稿件；每次修改都会新增版本，不覆盖旧原文。</p></div><span>{documents.length} 份资料</span></div>
   <fieldset disabled={busy} style={{border:0,padding:0,margin:0}}><div className="nd-form-grid"><label className="nd-control"><span>资料名称 *</span><input value={title} placeholder="例如：仙侠开篇样章" onChange={event=>setTitle(event.target.value)}/></label><label className="nd-control"><span>来源链接或说明</span><input value={sourceUrl} placeholder="可留空" onChange={event=>setSourceUrl(event.target.value)}/></label></div><label className="nd-control"><span>可分析文本 *</span><textarea rows={8} value={content} placeholder="粘贴正文或研究材料，至少 20 个字符" onChange={event=>setContent(event.target.value)}/></label></fieldset>
   <button className="nd-button nd-button-primary" type="button" disabled={busy||!title.trim()||content.trim().length<20} onClick={()=>void createDocument()}>{busy?"保存中…":"保存为不可变 v1"}</button>
   {!!documents.length&&<div className="nd-source-version-list">{documents.map(document=><article key={document.id}><div><strong>{document.title}</strong><small>v{document.currentVersion.version} · {document.currentVersion.characterCount.toLocaleString()} 字</small></div><span>{document.versionCount} 个版本</span></article>)}</div>}
  </section>
  <section className="nd-research-records"><div className="nd-section-heading"><div><p className="nd-kicker">研究成果</p><h2>研究记录</h2><p>查看榜单扫描、市场拆解和作品拆书的真实运行版本。</p></div><div className="nd-record-facts">{Object.entries(statusCounts).map(([key,count])=><span key={key}>{TYPE_LABELS[key as ResearchRecordType]} {count}</span>)}</div></div>
   <form className="nd-research-filters" onSubmit={event=>{event.preventDefault();setAppliedSearch(search.trim());}}><label>搜索名称或备注<input value={search} onChange={event=>setSearch(event.target.value)} maxLength={120}/></label><label>研究类型<select value={type} onChange={event=>setType(event.target.value as ResearchRecordType|"")}><option value="">全部类型</option>{Object.entries(TYPE_LABELS).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label><label><input type="checkbox" checked={favoriteOnly} onChange={event=>setFavoriteOnly(event.target.checked)}/>只看收藏</label><button className="nd-button" type="submit">查找</button></form>
   {pendingSelection&&<div className="nd-message" role="alert"><p>本条说明尚未保存。切换会放弃本条未保存说明；参考文本和运行报告不受影响。</p><button type="button" disabled={busy} onClick={()=>setPendingSelection(null)}>保留说明，暂不切换</button><button type="button" disabled={busy} onClick={discardAndChoose}>放弃本条说明并切换</button></div>}
   <div className="nd-research-record-layout"><aside aria-label="研究记录列表" aria-busy={reading}>{records.length?records.map(record=><button className={selectedId===record.id?"is-selected":""} type="button" aria-pressed={selectedId===record.id} disabled={busy} key={record.id} onClick={()=>choose(record.id)}><span>{TYPE_LABELS[record.type]} · 当前 v{record.currentVersion.version}</span><strong>{record.favorite?"收藏 · ":""}{record.title}</strong><small>{runtimeLabel(record.currentVersion.runStatus)} · 使用 {record.usageCount} 次</small></button>):<div className="nd-empty nd-empty-compact">没有符合筛选的研究记录。</div>}</aside>
   {detail&&detail.id===selectedId?<section className="nd-record-inspector"><div className="nd-section-heading"><div><p className="nd-kicker">{TYPE_LABELS[detail.type]} · 记录当前 v{detail.currentVersion.version}</p><h3>{detail.title}</h3></div><button className="nd-text-button" disabled={busy} type="button" onClick={()=>editDetail({...detail,favorite:!detail.favorite})}>{detail.favorite?"取消收藏":"收藏"}</button></div>
    <label className="nd-control"><span>查看运行版本（只读）</span><select value={versionId??""} disabled={busy} onChange={event=>{const chosen=detail.versions.find(version=>version.id===event.target.value&&version.recordId===detail.id);if(!chosen){setSourceFailure("运行版本不属于这条记录，未切换。");return;}sourceActive.current=false;viewedVersionRef.current=chosen.id;setVersionId(chosen.id);setSourceFailure("");}}><option value="" disabled>请选择真实运行版本</option>{detail.versions.filter(version=>version.recordId===detail.id).map(version=><option value={version.id} key={version.id}>v{version.version} · {runtimeLabel(version.runStatus)}</option>)}</select></label>
    {viewedVersion&&<section className="nd-record-run" aria-label="所选运行版本"><p>所选 v{viewedVersion.version} · {runtimeLabel(viewedVersion.runStatus)} · 进度 {viewedVersion.progress}%</p><p>预算 {viewedVersion.budgetTokens??"不限"} · 已用 {viewedVersion.usedTokens}</p><small>版本凭证：{viewedVersion.id}</small><p>{viewedVersion.id===detail.currentVersion.id?"所选为记录当前版本。":"所选为历史运行版本；不会替换记录当前版本。"}</p><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{viewedVersion.report||"此运行版本没有保存报告，请核对进度与原来源。"}</pre>{viewedVersion.runStatus==="failed"&&<p role="alert">未完成步骤：研究运行。所选版本和已保存报告保留；查看原扫描或拆书来源后处理，不重跑其他版本代替。</p>}</section>}
    <fieldset disabled={busy} style={{border:0,padding:0,margin:0}}><label className="nd-control"><span>记录名称</span><input value={detail.title} onChange={event=>editDetail({...detail,title:event.target.value})}/></label><label className="nd-control"><span>标签（逗号分隔）</span><input value={detail.tags.join("，")} onChange={event=>editDetail({...detail,tags:event.target.value.split(/[，,]/).map(item=>item.trim()).filter(Boolean)})}/></label><label className="nd-control"><span>备注</span><textarea rows={5} value={detail.notes} onChange={event=>editDetail({...detail,notes:event.target.value})}/></label></fieldset>
    <p>{dirty?"说明草稿待保存":"说明与已读取版本一致"}；保存说明不会改写所选历史报告。</p><div className="nd-row-actions"><button className="nd-button" disabled={busy} type="button" onClick={()=>void saveRecord({...detail,status:"archived"})}>归档记录</button><button className="nd-button nd-button-primary" disabled={busy||!detail.title.trim()} type="button" onClick={()=>void saveRecord(detail)}>保存说明</button></div>
   </section>:<div className="nd-empty nd-empty-compact">选择研究记录查看对应运行版本和报告；来源未匹配时不会替换为其他记录。</div>}
   </div>
  </section>{message&&<p className="nd-message" role="status">{message}</p>}
 </main></ResearchShell>;
}
