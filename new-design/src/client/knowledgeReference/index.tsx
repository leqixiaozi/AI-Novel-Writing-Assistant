import {useEffect,useRef,useState} from "react";
import type {BookSummary} from "../../common/contracts";
import {KNOWLEDGE_MAX_BYTES,type KnowledgeReferenceItem,type KnowledgeWorkspace,type KnowledgeSearchResult,type KnowledgeArchivePreview,type KnowledgeWriteReceipt} from "../../common/knowledgeReference";
import {ApiError,newDesignApi} from "../api";
import BookShell from "../BookShell";
import {validKnowledgeBook,saveKnowledgePointer,readKnowledgePointer,clearKnowledgePointer,matchesKnowledgeReceipt,knowledgePointerStorageBlocked,type KnowledgePending,type KnowledgePendingPointer} from "./pending";
import {KnowledgeContentViewer,KnowledgeReferenceAdoption} from "./referenceEditor";
import KnowledgeFailure from "./KnowledgeFailure";
import KnowledgeIndexPanel from "../knowledgeIndex";
import "./knowledge.css";
const labels:Record<KnowledgeReferenceItem['status'],string>={pending:"等待解析",ready:"正文可检索",failed:"解析失败",stale:"需要重新核对",archived:"已归档"};
const operationLabels={upload:"上传文件",parse:"解析正文",bind:"绑定参考",archive:"归档参考",reference:"采用 AI 引用"};
async function fileBase64(file:File):Promise<string>{
  if(file.size===0||file.size>KNOWLEDGE_MAX_BYTES||!/(?:\.txt|\.md)$/i.test(file.name))throw new Error("请选择不超过 2 MiB 的 UTF-8 文本或 Markdown 文件。");
  const bytes=new Uint8Array(await file.arrayBuffer());new TextDecoder("utf-8",{fatal:true}).decode(bytes);
  let binary="";for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(binary);
}
export default function KnowledgeReferencePage({bookId:initialBookId}:{bookId?:string}){
  const query=new URLSearchParams(window.location.search),requested=initialBookId??query.get('bookId')??'';
  const [books,setBooks]=useState<BookSummary[]>([]),[bookId,setBookId]=useState(validKnowledgeBook(requested)?requested:''),[workspace,setWorkspace]=useState<KnowledgeWorkspace|null>(null);
  const [selected,setSelected]=useState<string|null>(null),[title,setTitle]=useState(''),[file,setFile]=useState<File|null>(null),[ownerIndex,setOwnerIndex]=useState('');
  const [search,setSearch]=useState(''),[results,setResults]=useState<KnowledgeSearchResult|null>(null),[preview,setPreview]=useState<KnowledgeArchivePreview|null>(null),[reason,setReason]=useState('');
  const [pointer,setPointer]=useState<KnowledgePendingPointer|null>(()=>validKnowledgeBook(requested)?readKnowledgePointer(requested):null),[pending,setPending]=useState<KnowledgePending|null>(null);
  const [receipt,setReceipt]=useState<KnowledgeWriteReceipt|null>(null),[error,setError]=useState<Error|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[safeRetry,setSafeRetry]=useState(false),[storageBlocked,setStorageBlocked]=useState(()=>validKnowledgeBook(requested)&&knowledgePointerStorageBlocked(requested));
  const sequence=useRef(0),inFlight=useRef(false);const item=workspace?.items.find(row=>row.id===selected)??null;
  const [tab,setTab]=useState<"materials"|"index"|"settings">("materials");
  const [indexLocked,setIndexLocked]=useState(false),[indexDirty,setIndexDirty]=useState(false);
  const baseLocked=busy||Boolean(pointer)||storageBlocked,locked=baseLocked||indexLocked,dirty=Boolean(file||title||reason||pointer||storageBlocked||indexDirty||indexLocked);
  const capture=(value:unknown)=>setError(value instanceof Error?value:new Error("未确认操作结果，请保留输入并核对原请求。"));
  useEffect(()=>{void newDesignApi.listBooks().then(setBooks).catch(capture);},[]);
  useEffect(()=>{const token=++sequence.current;setWorkspace(null);setResults(null);setPreview(null);setSelected(null);setReceipt(null);setPointer(bookId?readKnowledgePointer(bookId):null);setStorageBlocked(Boolean(bookId)&&knowledgePointerStorageBlocked(bookId));
    if(bookId)void newDesignApi.getKnowledgeWorkspace(bookId).then(value=>{if(sequence.current===token)setWorkspace(value);}).catch(value=>{if(sequence.current===token)capture(value);});
  },[bookId]);
  useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(dirty||busy){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[dirty,busy]);
  async function refresh(){if(!bookId)return;const token=sequence.current;try{const value=await newDesignApi.getKnowledgeWorkspace(bookId);if(sequence.current===token){setWorkspace(value);setNotice("参考状态已读取。此前的保存回执仍保留。");}}catch(value){capture(value);}}
  async function findText(){if(busy||!bookId||!search.trim())return;const token=sequence.current;try{const result=await newDesignApi.searchKnowledgeReferences(bookId,search.trim());if(sequence.current===token)setResults(result);}catch(value){if(sequence.current===token)capture(value);}}
  async function acceptReceipt(value:KnowledgeWriteReceipt,current:KnowledgePendingPointer){
    if(!matchesKnowledgeReceipt(current,value))throw new Error("回执不属于本书的原请求。请保留输入，勿重复提交。");
    setReceipt(value);setSelected(value.assetId);setPending(null);setPointer(null);setSafeRetry(false);setError(null);setNotice(`${operationLabels[value.operation]}已保存。`);
    if(value.operation==='upload'){setFile(null);setTitle('');}if(value.operation==='archive'){setPreview(null);setReason('');}
    try{clearKnowledgePointer(bookId);}catch{setNotice("保存回执已确认；本机未能清除恢复标记，重新打开后请核对同一回执。");}
    await refresh();
  }
  async function send(value:KnowledgePending,retry=false){
    if(inFlight.current||storageBlocked||(!retry&&pointer))return;inFlight.current=true;setBusy(true);setSafeRetry(false);setError(null);
    const current:KnowledgePendingPointer={bookId:value.bookId,operation:value.operation,assetId:value.assetId,requestKey:value.input.requestKey};
    try{saveKnowledgePointer(value);}catch{inFlight.current=false;setBusy(false);setError(new Error("本机无法保存恢复标记，操作未发送。请保留文件并检查浏览器存储权限。"));return;}
    setPointer(current);setPending(value);
    try{let result:KnowledgeWriteReceipt;switch(value.operation){
      case 'upload':result=await newDesignApi.uploadKnowledgeReference(value.bookId,value.input);break;
      case 'parse':result=await newDesignApi.parseKnowledgeReference(value.bookId,value.assetId,value.input);break;
      case 'bind':result=await newDesignApi.bindKnowledgeReference(value.bookId,value.assetId,value.input);break;
      case 'archive':result=await newDesignApi.archiveKnowledgeReference(value.bookId,value.assetId,value.input);break;
      case 'reference':result=await newDesignApi.adoptKnowledgeReferences(value.bookId,value.input);break;
    }await acceptReceipt(result,current);
    }catch(value){capture(value);setSafeRetry(value instanceof ApiError&&value.recovery?.mutationOutcome==='not_written');}
    finally{inFlight.current=false;setBusy(false);}
  }
  async function checkOriginal(){if(!pointer||inFlight.current)return;inFlight.current=true;setBusy(true);try{const result=await newDesignApi.getKnowledgeWriteReceipt(pointer.bookId,pointer.requestKey);if(result)await acceptReceipt(result,pointer);else setNotice("未查到原请求回执，不能据此判断未保存。输入保留；请继续核对，不要重新上传或归档。");}catch(value){capture(value);}finally{inFlight.current=false;setBusy(false);}}
  async function upload(){if(!file||!title.trim()||locked||inFlight.current)return;inFlight.current=true;setBusy(true);try{const contentBase64=await fileBase64(file);inFlight.current=false;await send({operation:'upload',bookId,assetId:null,input:{requestKey:crypto.randomUUID(),filename:file.name,title:title.trim(),contentBase64}});}catch(value){capture(value instanceof TypeError?new Error('文件不是有效 UTF-8。请在编辑器另存为 UTF-8 后重新选择，上传未发送。'):value);}finally{inFlight.current=false;setBusy(false);}}
  function selectBook(value:string){if(locked)return;if((file||title||reason||indexDirty)&&!window.confirm("切换书籍将离开未保存的参考或语义索引输入。是否放弃这些输入？"))return;setFile(null);setTitle('');setReason('');setError(null);setOwnerIndex('');setPending(null);setSafeRetry(false);setBookId(value);}
  const content=<main className="nd-knowledge-page">
    <header className="nd-page-header"><div><p className="nd-eyebrow">创作参考</p><h1>知识与参考</h1><p>上传参考正文，查看解析结果，再选择用于哪本书、哪一章或哪份资料。</p></div>{bookId&&<a className="nd-button" href={`/new-design/books/${bookId}/story-setting`}>返回故事设定</a>}</header>
    <label className="nd-control">选择书籍<select value={bookId} disabled={locked} onChange={event=>selectBook(event.target.value)}><option value="">请选择书籍</option>{books.map(book=><option key={book.id} value={book.id}>{book.name}</option>)}</select></label>
    {storageBlocked&&<section className="nd-message is-error" role="alert"><p>本机恢复标记无法读取，不能确认此前的写入。文件和服务器资料未清空，写入保持锁定。</p><a className="nd-button" href="/new-design/structure/maintenance">打开运行维护核对已保存记录</a><p>核对期间不要清除浏览器存储或重新上传同一文件。</p></section>}
    {error&&<KnowledgeFailure error={error} onRead={()=>void refresh()} locked={locked}/>}
    {notice&&<p role="status" className="nd-message">{notice}</p>}
    {pointer&&<section className="nd-knowledge-recovery" aria-label="原请求恢复"><h2>{operationLabels[pointer.operation]}：结果待核对</h2><p>原请求 {pointer.requestKey}。核对仅查询保存回执，不重新上传、不调用模型。</p><button className="nd-button" disabled={busy} onClick={()=>void checkOriginal()}>核对原请求</button>{safeRetry&&pending&&<button className="nd-button" disabled={busy} onClick={()=>void send(pending,true)}>按原输入重试</button>}<p>{safeRetry?'服务器确认本次未写入；重试使用同一请求和输入。':'未确认是否保存前，其他写入保持锁定，避免重复资料和重复归档。'}</p></section>}
    {receipt&&<p className="nd-message">{operationLabels[receipt.operation]}已确认保存：{receipt.item.title}。刷新失败不会撤销此回执。</p>}
    {bookId&&<button className="nd-button" disabled={busy} onClick={()=>void refresh()}>读取参考状态</button>}
    {workspace&&<>
      <nav className="nd-view-tabs" aria-label="参考资料工作区">{([["materials","参考资料"],["index","索引与检索"],["settings","设置"]] as const).map(([key,label])=><button className="nd-button" type="button" aria-pressed={tab===key} key={key} onClick={()=>setTab(key)}>{label}</button>)}</nav>{indexLocked&&tab==="materials"&&<p role="status">索引原请求需要核对，请打开“索引与检索”查看原回执。</p>}<div hidden={tab==="materials"}><KnowledgeIndexPanel view={tab==="settings"?"settings":"index"} bookId={bookId} disabled={baseLocked} onLockChange={setIndexLocked} onDirtyChange={setIndexDirty} onInspect={(id,version)=>{const exact=workspace.items.find(row=>row.id===id&&row.parsedVersionId===version);if(!exact){setError(new Error('该原文版本不在当前参考目录内或已变化；请读取参考状态后核对，不会选择其他原文代替。'));return;}if(reason||ownerIndex){setError(new Error('当前绑定或归档输入保留；请先处理这份草稿，再查看另一参考。'));return;}setSelected(exact.id);setPreview(null);setTab("materials");requestAnimationFrame(()=>document.getElementById("knowledge-selected-reference")?.scrollIntoView({block:"start"}));}}/></div><div hidden={tab!=="materials"}>
      <section id="knowledge-upload" className="nd-knowledge-upload"><h2>添加参考文件</h2><label className="nd-control">参考标题<input value={title} disabled={locked} onChange={event=>setTitle(event.target.value)}/></label><label className="nd-control">UTF-8 文本或 Markdown（最多 2 MiB）<input type="file" accept=".txt,.md,text/plain,text/markdown" disabled={locked} onChange={event=>setFile(event.target.files?.[0]??null)}/></label><button className="nd-button nd-button-primary" disabled={locked||!file||!title.trim()} onClick={()=>void upload()}>上传并保存</button><p>上传保留原文件；解析正文需在下方显式选择，失败后可在同一参考上重试。</p></section>
      <section><h2>正文检索</h2><label className="nd-control">查找原文<input value={search} maxLength={120} onChange={event=>setSearch(event.target.value)}/></label><button className="nd-button" disabled={busy||!search.trim()} onClick={()=>void findText()}>查找正文</button><p>此处检索已解析的正文，不是语义检索。</p>{results&&<div>{results.items.map(result=><button className="nd-knowledge-search-result" disabled={locked} key={`${result.assetId}:${result.parsedVersionId}`} onClick={()=>{setSelected(result.assetId);setPreview(null);}}>{result.title}<span>{result.excerpt}</span></button>)}{!results.items.length&&<p>没有匹配正文。</p>}{results.truncated&&<p>结果有截断，请缩小查找范围。</p>}</div>}</section>
      <p>{workspace.capabilities.vectorReason} <a href={workspace.capabilities.settingsRoute}>打开模型设置</a></p>
      <div className="nd-knowledge-workspace"><aside aria-label="参考目录">{workspace.items.map(row=><button className={row.id===selected?'is-selected':''} key={row.id} disabled={locked} onClick={()=>{setSelected(row.id);setPreview(null);setOwnerIndex('');setReason('');}}><span>{row.title}</span><small>{labels[row.status]} · {row.filename}</small></button>)}{!workspace.items.length&&<p>上传第一份参考文件后，在这里选择并查看。</p>}{workspace.truncated&&<p>目录有截断，未显示的参考不会被修改。</p>}</aside>
        <section id="knowledge-selected-reference">{item?<><h2>{item.title}</h2><p>{labels[item.status]} · 修订 {item.revision} · {item.byteSize} 字节</p>{item.status==='failed'&&item.failure&&<p className="nd-message is-error">解析正文失败：{item.failure}。原文件保留，点击“重新解析”仅重做本参考解析。</p>}{item.recoveryReason&&<p className="nd-message">{item.recoveryReason} <a href="#knowledge-upload">选择原文件重新上传</a></p>}<button className="nd-button" disabled={locked||item.parseAvailable!==true} onClick={()=>void send({operation:'parse',bookId,assetId:item.id,input:{requestKey:crypto.randomUUID(),expectedRevision:item.revision}})}>{item.status==='failed'?'重新解析':'解析正文'}</button>
          <KnowledgeContentViewer bookId={bookId} item={item}/>
          <h3>使用位置</h3><label className="nd-control">绑定到<select value={ownerIndex} disabled={locked||item.status==='archived'} onChange={event=>setOwnerIndex(event.target.value)}><option value="">请选择准确的使用位置</option>{workspace.owners.map((owner,index)=><option key={`${owner.kind}:${owner.stableId}:${owner.versionId}`} value={String(index)}>{owner.label}</option>)}</select></label><button className="nd-button" disabled={locked||ownerIndex===''||!workspace.owners[Number(ownerIndex)]||item.status==='archived'} onClick={()=>{const owner=workspace.owners[Number(ownerIndex)];if(owner)void send({operation:'bind',bookId,assetId:item.id,input:{requestKey:crypto.randomUUID(),expectedRevision:item.revision,owner}});}}>保存使用位置</button><p>绑定保存准确版本；是否供 AI 使用，需要在下方明确选择引用，不会默默修改提示词配置。</p>{item.bindings.map(binding=><p key={binding.id}>{binding.owner.label} · {binding.status==='active'?'使用中':'已结束'}</p>)}
          <KnowledgeReferenceAdoption key={`${bookId}:${item.id}:${item.revision}`} bookId={bookId} item={item} locked={locked} onAdopt={input=>send({operation:'reference',bookId,assetId:item.id,input})}/>
          <h3>归档参考</h3><button className="nd-button" disabled={locked||item.status==='archived'} onClick={()=>void newDesignApi.getKnowledgeArchivePreview(bookId,item.id).then(setPreview).catch(capture)}>查看归档影响</button>{preview&&preview.assetId===item.id&&<section className="nd-knowledge-recovery"><p>归档保留原文件和历史记录，但可能使以下引用或上下文需要重算：</p>{preview.impacts.map(impact=><p key={impact.id}>{impact.label} · {impact.state}</p>)}{!preview.impacts.length&&<p>未发现当前引用影响。</p>}{preview.truncated&&<p>影响列表未完整显示，禁止确认归档，请缩小范围核对。</p>}<label className="nd-control">归档原因<textarea value={reason} disabled={locked} onChange={event=>setReason(event.target.value)}/></label><button className="nd-button" disabled={locked||preview.truncated||!reason.trim()} onClick={()=>{if(window.confirm('确认归档此参考，并使预览列出的引用接受失效处理？'))void send({operation:'archive',bookId,assetId:item.id,input:{requestKey:crypto.randomUUID(),expectedRevision:item.revision,previewHash:preview.previewHash,reason:reason.trim()}});}}>确认归档</button></section>}
        </>:<p>从左侧选择参考，右侧查看正文、使用位置和恢复入口。</p>}</section>
      </div></div>
    </>}
  </main>;
  const book=books.find(row=>row.id===bookId);return book?<BookShell book={book} active="knowledge">{content}</BookShell>:<div className="nd-shell">{content}</div>;
}
