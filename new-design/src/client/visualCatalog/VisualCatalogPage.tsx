import {useEffect,useRef,useState} from 'react';
import type {VisualCatalogItem,VisualCatalogQuery} from '../../common/visualAssets';
import {visualCatalogAssetRoute} from '../../common/visualAssets';
import {newDesignApi} from '../api';
import ResourceShell from '../ResourceShell';
import './visualCatalog.css';

type VisualKind=VisualCatalogQuery['kind'];
type VisualSource=VisualCatalogQuery['source'];
interface ContentProps {items:VisualCatalogItem[];total:number;loading:boolean;error:string;query:string;kind:VisualKind;source:VisualSource;nextOffset:number|null;onQuery:(value:string)=>void;onKind:(value:VisualKind)=>void;onSource:(value:VisualSource)=>void;onSearch:()=>void;onMore:()=>void;onReload:()=>void;imageUrl:(bookId:string,assetId:string,versionId:string)=>string;}
const sourceLabel=(kind:string)=>kind==='upload'?'本地上传':kind==='ai_generated'?'AI 生成':kind==='import'?'导入':kind==='derived'?'衍生':kind==='migration'?'迁移':'其他来源';

export function VisualCatalogContent({items,total,loading,error,query,kind,source,nextOffset,onQuery,onKind,onSource,onSearch,onMore,onReload,imageUrl}:ContentProps){
 return <main className="nd-visual-catalog"><header className="nd-story-heading"><div><h2>视觉资源库</h2><p>跨书查看已保存的封面与插图。图片归属、候选和已采用状态来自新版独立资产；编辑及绑定回到原书。</p></div><button type="button" className="nd-button" disabled={loading} onClick={onReload}>重新读取</button></header>
 <form className="nd-visual-catalog-filters" onSubmit={event=>{event.preventDefault();onSearch();}}><label>搜索视觉素材<input value={query} maxLength={120} onChange={event=>onQuery(event.target.value)} placeholder="图片名称、说明或所属书籍"/></label><label>类型<select value={kind} onChange={event=>onKind(event.target.value as VisualKind)}><option value="all">全部</option><option value="cover">封面</option><option value="illustration">插图</option></select></label><label>来源<select value={source} onChange={event=>onSource(event.target.value as VisualSource)}><option value="all">全部来源</option><option value="upload">本地上传</option><option value="ai_generated">AI 生成</option><option value="other">其他来源</option></select></label><button type="submit" className="nd-button nd-button-primary" disabled={loading}>搜索</button></form>
 {error&&<section className="nd-message is-error" role="alert"><strong>视觉资源目录读取失败</strong><p>{error}</p><button type="button" className="nd-button" disabled={loading} onClick={onReload}>重试</button></section>}
 <p className="nd-visual-catalog-count">{loading&&!items.length?'正在读取视觉素材…':`找到 ${total} 项视觉素材`}</p>
 {!loading&&!error&&!items.length?<section className="nd-empty"><strong>暂无符合条件的素材</strong><p>可调整筛选，或从一本书的图片工作台上传与生成图片。</p><a className="nd-button" href="/new-design/books">打开我的书籍</a></section>:null}
 <div className="nd-visual-catalog-grid">{items.map(item=><article key={item.assetId} className="nd-visual-catalog-card">{item.version.readable?<img src={imageUrl(item.bookId,item.assetId,item.version.id)} alt={item.version.title||item.title} loading="lazy"/>:<div className="nd-visual-catalog-unreadable" role="status">原图片文件待核对，暂不显示预览</div>}<div className="nd-visual-catalog-card-body"><p className="nd-kicker">{item.kind==='cover'?'封面':'插图'} · {item.adopted?'已采用版本':'候选版本'} · {sourceLabel(item.sourceKind)}</p><h3>{item.title}</h3><p>{item.bookName} · 第 {item.version.version} 版／共 {item.versionCount} 版</p>{item.version.description&&<p>{item.version.description}</p>}<a className="nd-button" href={visualCatalogAssetRoute(item.bookId,item.assetId,item.version.id)}>打开原书图片工作台</a></div></article>)}</div>
 {nextOffset!==null&&<div className="nd-visual-catalog-more"><button type="button" className="nd-button" disabled={loading} onClick={onMore}>{loading?'正在读取…':'加载更多'}</button></div>}
 </main>;
}

export default function VisualCatalogPage(){
 const [items,setItems]=useState<VisualCatalogItem[]>([]),[total,setTotal]=useState(0),[nextOffset,setNextOffset]=useState<number|null>(null),[query,setQuery]=useState(''),[kind,setKind]=useState<VisualKind>('all'),[source,setSource]=useState<VisualSource>('all'),[applied,setApplied]=useState({query:'',kind:'all' as VisualKind,source:'all' as VisualSource}),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const generation=useRef(0);
 const read=async(filters:{query:string;kind:VisualKind;source:VisualSource},offset:number,append:boolean)=>{
  const token=++generation.current;setLoading(true);setError('');
  try{const result=await newDesignApi.getVisualCatalog({...filters,offset,limit:30});if(generation.current!==token)return;setItems(current=>append?[...current,...result.items]:result.items);setTotal(result.total);setNextOffset(result.nextOffset);setApplied(filters);}catch(reason){if(generation.current===token)setError(reason instanceof Error?reason.message:'视觉资源目录读取失败。');}finally{if(generation.current===token)setLoading(false);}
 };
 useEffect(()=>{void read({query:'',kind:'all',source:'all'},0,false);return()=>{generation.current++;};},[]);
 const search=()=>void read({query:query.trim(),kind,source},0,false);
 return <ResourceShell active="visual"><VisualCatalogContent items={items} total={total} loading={loading} error={error} query={query} kind={kind} source={source} nextOffset={nextOffset} onQuery={setQuery} onKind={setKind} onSource={setSource} onSearch={search} onMore={()=>{if(nextOffset!==null)void read(applied,nextOffset,true);}} onReload={()=>void read(applied,0,false)} imageUrl={newDesignApi.visualImageUrl}/></ResourceShell>;
}
