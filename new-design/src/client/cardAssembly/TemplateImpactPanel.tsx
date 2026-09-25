import {useEffect,useState} from 'react';
import {newDesignApi} from '../api';

type Impact=Awaited<ReturnType<typeof newDesignApi.cardAssembly.bookTemplateImpact>>[number];

export default function TemplateImpactPanel({templateId,versionId}:{templateId:string;versionId:string|null}){
  const [impacts,setImpacts]=useState<Impact[]>([]);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!templateId||!versionId){setImpacts([]);return}
    let active=true;
    void newDesignApi.cardAssembly.bookTemplateImpact(templateId,versionId).then(items=>{if(active){setImpacts(items);setError('')}}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'无法读取模板影响。')});
    return()=>{active=false};
  },[templateId,versionId]);
  return <section className="nd-assembly-impact"><h3>已开书籍影响</h3>{error?<p role="alert">{error}</p>:impacts.length===0?<p>没有使用旧版本的已开书籍。</p>:<><p>以下书籍仍使用各自的结构快照。发布新版本不会直接改动它们。</p>{impacts.map(item=><div key={item.bookId} className="nd-assembly-field"><strong>{item.bookName}</strong><small> · {item.fromTemplateVersionId.slice(0,8)}</small><p>{[item.rootChanged&&'根卡',item.modulesChanged&&'组合模块',item.standaloneChanged&&'独立元卡片',item.relationsChanged&&'关系线'].filter(Boolean).join('、')||'仅版本来源变化'}</p></div>)}<p>涉及结构变化的书籍需逐本核对；当前页面只展示影响，不执行结构同步。</p></>}</section>;
}
