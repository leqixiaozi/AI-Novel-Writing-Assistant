import {useEffect,useState} from 'react';
import type {BookSummary} from '../../common/contracts';
import type {PublishedWorldPackage,WorldCatalogActionInput,WorldCatalogState} from '../../common/worldPackages';
import {WORLD_SECTIONS,WORLD_SECTION_LABELS} from '../../common/worldPackages';
import {fieldDisplay} from '../../common/formPresentation';
import {newDesignApi} from '../api';
import ResourceShell from '../ResourceShell';
import {bookWorldRoots,buildWorldCatalog,resolveWorldCatalogVersion,worldImportRoute,worldPublishRoute,type WorldCatalogEntry} from './model';
import './worldCatalog.css';

interface WorldRootOption {id:string;title:string;status:string;typeKey:string;}
export function WorldImportTargetView({packageId,books,selectedBookId,roots,loading,booksLoading=false,error,onSelect}:{packageId:string;books:Array<Pick<BookSummary,'id'|'name'|'status'>>;selectedBookId:string;roots:WorldRootOption[];loading:boolean;booksLoading?:boolean;error:string;onSelect:(id:string)=>void}){
 return <section className="nd-world-catalog-import" aria-label="导入到书籍"><h3>导入为本书独立世界</h3><p>先选择目标书，再选择确切的世界档案。进入书内后可预览字段映射，确认前不会导入或覆盖。</p><label>目标书籍 <select value={selectedBookId} onChange={event=>onSelect(event.target.value)}><option value="">选择一本书</option>{books.filter(book=>book.status==='active').map(book=><option key={book.id} value={book.id}>{book.name}</option>)}</select></label>{!selectedBookId&&error&&<p role="alert">{error}</p>}{!selectedBookId&&!error&&(booksLoading?<p role="status">正在读取书籍…</p>:!books.some(book=>book.status==='active')?<p>还没有可用书籍。<a href="/new-design/books/new">先创建一本书</a></p>:null)}{selectedBookId?(loading?<p role="status">正在核对本书世界档案…</p>:error?<p role="alert">{error}</p>:roots.length?<div className="nd-world-catalog-targets">{roots.map(root=><a key={root.id} className="nd-button" href={worldImportRoute(selectedBookId,packageId,root.id)}>导入到 {root.title}</a>)}</div>:<div><p>这本书还没有世界根档案。先建立本书世界档案，再核对导入映射；所选固定版本会随入口保留。</p><a className="nd-button" href={worldImportRoute(selectedBookId,packageId,null)}>先建立本书世界档案</a></div>):null}</section>;
}

export function WorldPublishTargetView({books,selectedBookId,roots,loading,booksLoading=false,error,onSelect}:{books:Array<Pick<BookSummary,'id'|'name'|'status'>>;selectedBookId:string;roots:WorldRootOption[];loading:boolean;booksLoading?:boolean;error:string;onSelect:(id:string)=>void}){
 return <section className="nd-world-catalog-import" aria-label="发布本书世界"><p>新版样本从本书正式世界整理和发布，原本书资料不会被公开操作覆盖。选择一本书与世界档案后，进入现有公开候选、预览及确认发布流程；已关联样本的书可核对同步更新。</p><label>来源书籍 <select value={selectedBookId} onChange={event=>onSelect(event.target.value)}><option value="">选择一本书</option>{books.filter(book=>book.status==='active').map(book=><option key={book.id} value={book.id}>{book.name}</option>)}</select></label>{!selectedBookId&&error&&<p role="alert">{error}</p>}{!selectedBookId&&!error&&(booksLoading?<p role="status">正在读取书籍…</p>:!books.some(book=>book.status==='active')?<p>还没有可用书籍。<a href="/new-design/books/new">先创建一本书</a></p>:null)}{selectedBookId?(loading?<p role="status">正在核对本书世界档案…</p>:error?<p role="alert">{error}</p>:roots.length?<div className="nd-world-catalog-targets">{roots.map(root=><a key={root.id} className="nd-button" href={worldPublishRoute(selectedBookId,root.id)}>打开本书发布与同步：{root.title}</a>)}</div>:<div><p>这本书还没有世界根档案。先建立本书世界档案，再整理为公共样本。</p><a className="nd-button" href={worldPublishRoute(selectedBookId,null)}>先建立本书世界档案</a></div>):null}</section>;
}

function useWorldBookTargets(){
 const [books,setBooks]=useState<BookSummary[]>([]),[booksLoading,setBooksLoading]=useState(true),[selectedBookId,setSelectedBookId]=useState(''),[roots,setRoots]=useState<WorldRootOption[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;void newDesignApi.listBooks().then(items=>{if(active)setBooks(items);}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'书籍目录读取失败。');}).finally(()=>{if(active)setBooksLoading(false);});return()=>{active=false;};},[]);
 useEffect(()=>{setRoots([]);setError('');if(!selectedBookId)return;let active=true;setLoading(true);void newDesignApi.getBookViewWorkspace(selectedBookId).then(workspace=>{if(!active)return;if(workspace.bookId!==selectedBookId)throw new Error('本书世界来源与目标书不一致。');setRoots(bookWorldRoots(workspace.cards));}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'本书世界档案读取失败。');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[selectedBookId]);
 return {books,booksLoading,selectedBookId,roots,loading,error,onSelect:setSelectedBookId};
}
function WorldImportTarget({packageId}:{packageId:string}){return <WorldImportTargetView packageId={packageId} {...useWorldBookTargets()}/>;}
function WorldPublishEntry(){return <details className="nd-world-catalog-publish"><summary>从本书发布或更新世界样本</summary><WorldPublishTargetView {...useWorldBookTargets()}/></details>;}

export function WorldCatalogContent({entries,requested,operational,archiveAvailable=false,states={},onAction,busyRoot=null}:{entries:WorldCatalogEntry[];requested:string|null;operational:boolean;archiveAvailable?:boolean;states?:Record<string,WorldCatalogState>;onAction?:(rootCardId:string,state:WorldCatalogState)=>void;busyRoot?:string|null}){
 if(!operational)return <section className="nd-message is-error" role="alert"><strong>世界样本库尚不可用</strong><p>本书世界与已保存内容不受影响，请到运行维护核对世界库能力。</p><a href="/new-design/structure/maintenance">打开运行维护</a></section>;
 if(!entries.length&&requested)return <section className="nd-message is-error" role="alert"><strong>指定的世界版本不在当前目录</strong><p>{archiveAvailable?'请核对链接，或勾选“查看归档样本”后查看固定版本。':'请核对链接或世界样本库状态。'}</p></section>;
 if(!entries.length)return <section className="nd-empty"><strong>还没有可导入的世界样本</strong><p>在一本书的世界手册中整理正式资料，然后从“来源与世界库”明确发布固定版本。</p><WorldPublishEntry/></section>;
 const selected=resolveWorldCatalogVersion(entries,requested);
 const selectedState=selected?(states[selected.rootCardId]??{status:'active' as const,revision:0}):null;
 const cards=selected?.frame.cards??[];
 const cardTitle=(id:string)=>cards.find(card=>card.cardId===id)?.title??'来源对象待核对';
 return <><WorldPublishEntry/><div className="nd-world-catalog-layout"><aside className="nd-world-catalog-index" aria-label="世界样本目录"><h2>世界样本</h2>{entries.map(entry=><article key={entry.rootCardId}><strong>{entry.title}</strong><small>最新第 {entry.latest.version} 版 · {entry.latest.frame.cards.length} 项资料{states[entry.rootCardId]?.status==='archived'?' · 已归档':''}</small><div>{entry.versions.map(version=><a key={version.id} aria-current={selected?.id===version.id?'page':undefined} href={`/new-design/resources/worlds?package=${encodeURIComponent(version.id)}`}>第 {version.version} 版</a>)}</div></article>)}</aside>
 {requested&&!selected?<section className="nd-message is-error" role="alert"><strong>指定的世界版本不存在</strong><p>目录中的其他版本未被自动选中，请从左侧明确选择。</p></section>:selected?<section className="nd-world-catalog-detail" aria-label="世界样本详情"><header><p className="nd-kicker">固定版本 · 第 {selected.version} 版{selectedState?.status==='archived'?' · 已归档':''}</p><h2>{cardTitle(selected.rootCardId)}</h2><p>发布于 {new Date(selected.createdAt).toLocaleString()}。{selectedState?.status==='archived'?'固定版本和已导入书籍仍可回看；恢复后可供新书导入。':'此处只读；导入后会成为本书独立副本。'}</p>{archiveAvailable&&selectedState&&onAction?<button type="button" className="nd-button nd-world-catalog-action" disabled={busyRoot!==null} onClick={()=>onAction(selected.rootCardId,selectedState)}>{busyRoot===selected.rootCardId?'处理中…':selectedState.status==='archived'?'恢复样本':'归档样本'}</button>:null}</header>{WORLD_SECTIONS.map(section=>{const items=cards.filter(card=>card.section===section);if(section==='relations')return <section key={section}><h3>{WORLD_SECTION_LABELS[section]} · {selected.frame.relations.length}</h3>{selected.frame.relations.length?<ul>{selected.frame.relations.map(relation=><li key={relation.relationId}>{cardTitle(relation.sourceCardId)} → {cardTitle(relation.targetCardId)}</li>)}</ul>:<p>此版本没有公开关系。</p>}</section>;return <section key={section}><h3>{WORLD_SECTION_LABELS[section]} · {items.length}</h3>{items.length?items.map(card=><details key={card.cardId} open={section==='profile'}><summary>{card.title}</summary><dl>{[...card.fields,...card.localFields.map(item=>item.field)].filter(field=>!field.hidden&&Object.hasOwn(card.values,field.key)).map(field=><div key={field.key}><dt>{field.name}</dt><dd>{fieldDisplay(field,card.values[field.key])}</dd></div>)}</dl></details>):<p>此版本没有公开此分区资料。</p>}</section>;})}{selectedState?.status==='archived'?null:<WorldImportTarget packageId={selected.id}/>}</section>:null}</div></>;
}

export default function WorldCatalogPage(){
 const [items,setItems]=useState<PublishedWorldPackage[]>([]),[operational,setOperational]=useState(false),[archiveAvailable,setArchiveAvailable]=useState(false),[states,setStates]=useState<Record<string,WorldCatalogState>>({}),[showArchived,setShowArchived]=useState(false),[loading,setLoading]=useState(true),[busyRoot,setBusyRoot]=useState<string|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('');
 const read=async(includeArchived=showArchived)=>{setLoading(true);setError('');try{const result=await newDesignApi.worldPackages.catalog(includeArchived);setItems(result.items);setOperational(result.capability.operational);setArchiveAvailable(result.archiveAvailable);setStates(result.states);}catch(reason){setError(reason instanceof Error?reason.message:'世界样本读取失败。');}finally{setLoading(false);}};
 useEffect(()=>{void read(showArchived);},[showArchived]);
 async function changeAvailability(rootCardId:string,state:WorldCatalogState){
  if(busyRoot)return;
  const action:WorldCatalogActionInput['action']=state.status==='archived'?'restore':'archive';
  if(action==='archive'&&!window.confirm('归档后，此样本不再提供给新书导入，也不能继续发布更新。已发布的固定版本和已导入书籍会保留。确认归档？'))return;
  const input:WorldCatalogActionInput={action,requestKey:crypto.randomUUID(),expectedRevision:state.revision};
  setBusyRoot(rootCardId);setError('');setMessage('');
  try{
   let receipt;
   try{receipt=await newDesignApi.worldPackages.availability(rootCardId,input);}
   catch(reason){receipt=await newDesignApi.worldPackages.availabilityOriginal(rootCardId,input);if(!receipt)throw reason;}
   if(receipt.rootCardId!==rootCardId||receipt.requestKey!==input.requestKey||receipt.status!==(action==='archive'?'archived':'active'))throw new Error('返回状态与本次世界样本请求不一致，请重新读取并核对。');
   setMessage(action==='archive'?'世界样本已归档；已导入书籍和固定版本保留。':'世界样本已恢复，可供新书导入。');
   if(action==='archive'&&!showArchived)setShowArchived(true);else await read(showArchived);
  }catch(reason){setError(`${reason instanceof Error?reason.message:'世界样本状态未确认。'} 请重新读取状态后核对，避免重复操作。`);}
  finally{setBusyRoot(null);}
 }
 const query=new URLSearchParams(window.location.search),requested=query.getAll('package').length>1?'__invalid_duplicate__':query.get('package');
 return <ResourceShell active="worlds"><main className="nd-world-catalog"><header className="nd-story-heading"><div><h2>世界样本库</h2><p>查看已发布的世界规则、势力、地点及固定版本；书内导入、拉取和推送由对应书籍完成。</p></div><div className="nd-world-actions"><a className="nd-button nd-button-primary" href="/new-design/resources/worlds/new">＋ 创建世界样本</a><button type="button" className="nd-button" disabled={loading} onClick={()=>void read()}>重新读取</button></div></header>{archiveAvailable?<label className="nd-world-catalog-filter"><input type="checkbox" checked={showArchived} onChange={event=>setShowArchived(event.target.checked)}/>查看归档样本</label>:null}{message?<p role="status" className="nd-world-catalog-feedback">{message}</p>:null}{error?<section role="alert" className="nd-message is-error"><strong>世界样本读取或操作失败</strong><p>{error}</p><button type="button" className="nd-button" onClick={()=>void read()}>重新读取状态</button></section>:loading?<p role="status">正在读取世界样本…</p>:<WorldCatalogContent entries={buildWorldCatalog(items)} requested={requested} operational={operational} archiveAvailable={archiveAvailable} states={states} onAction={(root,state)=>void changeAvailability(root,state)} busyRoot={busyRoot}/>}</main></ResourceShell>;
}
