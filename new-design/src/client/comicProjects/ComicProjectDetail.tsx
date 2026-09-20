import {useEffect,useState} from 'react';
import {COMIC_FORMATS,COMIC_STYLES,type ComicCapability,type ComicProjectDetail as Detail} from '../../common/comicProjects';
import {newDesignApi} from '../api';
import ComicEpisodePlanner from './ComicEpisodePlanner';
import ComicBibleEditor from './ComicBibleEditor';
import ComicPanelsWorkspace from './ComicPanelsWorkspace';
import ComicSourceBundleEditor from './ComicSourceBundleEditor';
import {COMIC_PROJECT_TABS,resolveComicProjectTab} from './navigation';
import './comicProjects.css';

const label=(items:readonly {key:string;label:string}[],key:string)=>items.find(item=>item.key===key)?.label??key;
export default function ComicProjectDetail({projectId}:{projectId:string}){
 const [capability,setCapability]=useState<ComicCapability|null>(null),[detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;void newDesignApi.comicProjects.capability().then(value=>{if(!live)return;setCapability(value);if(value.installed)void newDesignApi.comicProjects.detail(projectId).then(item=>{if(live)setDetail(item);}).catch(reason=>{if(live)setError(String(reason));});}).catch(reason=>{if(live)setError(String(reason));});return()=>{live=false;};},[projectId]);
 const params=new URLSearchParams(location.search),tab=resolveComicProjectTab(params);
 return <section className="nd-shell nd-comic-workspace"><header className="nd-comic-header"><div><p className="nd-kicker">漫画工作台 · 独立项目</p><h1>{detail?.project.title??'漫画项目'}</h1><p>{detail?`${label(COMIC_FORMATS,detail.project.comicFormat)} · ${label(COMIC_STYLES,detail.project.stylePreset)} · 草稿`:'读取项目中…'}</p></div><a className="nd-button nd-button-secondary" href="/new-design/comic">返回项目列表</a></header>{error&&<p role="alert" className="nd-comic-error">{error}</p>}{capability&&!capability.operational&&<p role="status">{capability.reason} 当前只读，不会自动迁移作者数据。</p>}
 {detail&&<><nav className="nd-comic-project-tabs" aria-label="漫画项目工作区">{COMIC_PROJECT_TABS.map(item=><a key={item.key} href={`?tab=${item.key}`} aria-current={tab===item.key?'page':undefined}>{item.label}</a>)}</nav>{!tab?<p role="alert">漫画项目标签无效，请从上方选择有效工作区。</p>:tab==='outline'?<ComicEpisodePlanner projectId={projectId}/>:tab==='characters'?<ComicBibleEditor key="characters" projectId={projectId} initialKind="character" fixedKind/>:tab==='scenes'?<ComicBibleEditor key="scenes" projectId={projectId} initialKind="scene" fixedKind/>:tab==='panels'?<ComicPanelsWorkspace projectId={projectId}/>:<><ComicSourceBundleEditor projectId={projectId}/><article className="nd-comic-detail"><h2>已采用的来源快照</h2><p>冻结于 {new Date(detail.source.createdAt).toLocaleString()}；{detail.source.sourceBookName?`来自《${detail.source.sourceBookName}》`:'独立文本来源'}。后续原作修改不会覆盖此版本。</p>{detail.source.manifest.chapters.length>0&&<p>章节来源：{detail.source.manifest.chapters.map(item=>item.title).join('、')}</p>}<pre>{detail.source.content.slice(0,5000)}{detail.source.content.length>5000?'\n…来源较长；精确章节和正文版本保留在来源清单中。':''}</pre></article></>}</>}
 </section>;
}
