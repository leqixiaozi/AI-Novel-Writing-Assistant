import {useEffect,useRef,useState} from 'react';
import type {ShelfBook,ReadingScope} from '../../common/bookshelf';
import type {VisualAssetsApi} from '../../common/visualAssets';
import {newDesignApi} from '../api';
import ProductionDirectorPage from '../productionDirector';
import VisualAssetsPage from '../visualAssets';
import BookDetails from './BookDetails';
import {downloadBookText} from './download';
const visualApi:VisualAssetsApi={workspace:newDesignApi.getVisualWorkspace,upload:newDesignApi.uploadVisualAsset,command:newDesignApi.executeVisualCommand,preview:newDesignApi.previewVisualChange,receipt:newDesignApi.getVisualReceipt,previewByKey:newDesignApi.getVisualPreviewByKey,imageUrl:newDesignApi.visualImageUrl};
export type BookDialogKind='cover'|'director'|'export'|'details';
export default function BookDialog({book,kind,onClose}:{book:ShelfBook;kind:BookDialogKind;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),[guard,setGuard]=useState({blocked:false,dirty:false}),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),flight=useRef(false);
 useEffect(()=>{const focus=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>{dialog.current?.close();focus?.focus();};},[]);
 function close(){if(guard.blocked||busy){setMessage('原请求仍在处理或待核对，请先在此页核对原结果，再关闭。');return;}if(guard.dirty&&!window.confirm('当前有未提交填写。确认关闭此窗口？已保存内容和原请求记录会保留。'))return;onClose();}
 async function download(scope:ReadingScope){if(flight.current)return;flight.current=true;setBusy(true);setMessage('');try{await downloadBookText(book.id,scope);setMessage('已开始下载 TXT，稿件性质和本次版本清单随正文保存。');}catch(reason){setMessage(reason instanceof Error?reason.message:'正文未下载，请核对原稿件。');}finally{flight.current=false;setBusy(false);}}
 const title=kind==='cover'?'管理封面':kind==='director'?'AI 驾驶舱':kind==='details'?'本书执行详情':'导出作品';
 return <dialog className="nd-shelf-feature-dialog nd-shell" ref={dialog} aria-labelledby="nd-shelf-feature-title" onCancel={event=>{event.preventDefault();close();}}><header><h2 id="nd-shelf-feature-title">{title} · {book.name}</h2><button className="nd-button" onClick={close} disabled={busy||guard.blocked}>关闭</button></header>{message&&<p role="status">{message}</p>}
 {kind==='cover'&&<VisualAssetsPage coverWorkbench bookContext={{name:book.name,description:book.description}} bookId={book.id} api={visualApi} imageApi={newDesignApi.imageGeneration} selectionSearch={book.cover?`?asset=${book.cover.assetId}&version=${book.cover.versionId}`:''} onCloseGuardChange={setGuard}/>}
 {kind==='director'&&<><BookDetails book={book}/><ProductionDirectorPage bookId={book.id} initialRunId={book.latestDirector?.id} embedded onCloseGuardChange={setGuard}/></>}
 {kind==='details'&&<BookDetails book={book}/>}
 {kind==='export'&&<section className="nd-shelf-export-choice"><p>直接下载本书当前读取到的正文版本。已保存稿可含未采用候选；采用正文也不表示全书完稿。两种 TXT 都附带本次版本清单，下载不会修改资料。</p><button className="nd-button nd-button-primary" disabled={busy} onClick={()=>void download('saved')}>{busy?'正在读取正文…':'下载已保存稿 TXT'}</button><button className="nd-button" disabled={busy} onClick={()=>void download('adopted')}>下载正式采用正文 TXT</button><a className="nd-button" href={'/new-design/books/'+book.id+'/completion'}>出版导出：稳定稿、Word 与版本预览</a></section>}
 </dialog>;
}
