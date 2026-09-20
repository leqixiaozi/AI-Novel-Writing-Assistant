import {useEffect,useState} from 'react';
import type {ComicEpisode,ComicEpisodeWorkspace} from '../../common/comicEpisodes';
import {newDesignApi} from '../api';
import ComicPanelEditor from './ComicPanelEditor';
import {selectComicPanelEpisode} from './navigation';

export default function ComicPanelsWorkspace({projectId}:{projectId:string}){
 const [workspace,setWorkspace]=useState<ComicEpisodeWorkspace|null>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;void newDesignApi.comicEpisodes.workspace(projectId).then(value=>{if(live)setWorkspace(value);}).catch(reason=>{if(live)setError(String(reason));});return()=>{live=false;};},[projectId]);
 const eligible=(workspace?.episodes??[]).filter(item=>Boolean(item.adoptedVersionId)),params=new URLSearchParams(location.search),requested=params.getAll('episode').length>0,selected:ComicEpisode|null=selectComicPanelEpisode(workspace?.episodes??[],params);
 return <section className="nd-comic-episodes"><header><div><p className="nd-kicker">分镜脚本</p><h3>选择分集制作分格</h3><p>只基于已采用分集大纲；旧大纲的脚本会标为待更新。</p></div></header>{error&&<p role="alert" className="nd-comic-error">{error}</p>}{!workspace?<p>正在读取分集目录…</p>:eligible.length===0?<p>尚无已采用分集，请先到“大纲”保存并采用一话。</p>:<><nav className="nd-comic-panel-episodes" aria-label="选择分集">{eligible.map(item=>{const adopted=item.versions.find(value=>value.id===item.adoptedVersionId);return <a key={item.id} href={`?tab=panels&episode=${item.id}`} aria-current={selected?.id===item.id?'page':undefined}>第 {item.order} 话 · {adopted?.content.title??'已采用大纲'}</a>;})}</nav>{requested&&!selected?<p role="alert">指定分集不存在或尚未采用大纲，未自动改选其他分集。</p>:selected&&<ComicPanelEditor key={`${selected.id}:${selected.adoptedVersionId}`} projectId={projectId} episodeId={selected.id}/>}</>}</section>;
}
