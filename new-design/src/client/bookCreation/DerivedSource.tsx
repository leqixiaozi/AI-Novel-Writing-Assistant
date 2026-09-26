import {useEffect,useState} from 'react';
import {derivedStorySourceSchema,type DerivedStorySource} from '../../common/storyFormat';
import {newDesignApi} from '../api';

export default function DerivedSource({disabled,onUse}:{disabled:boolean;onUse:(source:DerivedStorySource,content:string)=>void}) {
 const query=new URLSearchParams(location.search),hasSource=['sourceBook','sourceDocument','sourceBody'].some(key=>query.has(key));
 const [source,setSource]=useState<{reference:DerivedStorySource;content:string;title:string}|null>(null),[error,setError]=useState(''),[reading,setReading]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{if(!hasSource)return;let active=true;setSource(null);setReading(true);const keys=['sourceBook','sourceDocument','sourceBody'],ids=keys.map(key=>query.get(key));
  if(keys.some(key=>query.getAll(key).length!==1)||!ids.every(id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))){setError('原作品引用凭证不完整，请返回原作品重新选择。');setReading(false);return;}
  void newDesignApi.getChapterDocument(ids[1]!).then(document=>{if(!active)return;const body=document.versions.find(body=>body.id===ids[2]&&!body.archivedAt);if(document.bookId!==ids[0]||document.id!==ids[1]||document.adoptedVersionId!==ids[2]||!body)throw new Error('所选原采用版本已变化或未找到，不使用另一版替代。');setSource({reference:derivedStorySourceSchema.parse({bookId:document.bookId,documentId:document.id,bodyVersionId:body.id,contentHash:body.contentHash}),content:body.content,title:document.title});setError('');}).catch(error=>{if(active)setError(error instanceof Error?error.message:'原采用作品未读取。');}).finally(()=>{if(active)setReading(false);});return()=>{active=false;};
 },[revision]);
 if(!hasSource)return null;
 return <section className="nd-message"><h2>从原采用作品发展长篇</h2><p>只读核对确切原版本，再明确带入本次开书材料。原作品保留，派生书籍另行审阅和确认创建。</p>{reading&&<p role="status">读取原采用作品…</p>}{error&&<p role="alert">{error}</p>}{source&&<><p>{source.title} · {source.content.replace(/\s/g,'').length.toLocaleString('zh-CN')} 字</p><details><summary>核对原材料</summary><pre style={{whiteSpace:'pre-wrap',maxHeight:240,overflow:'auto'}}>{source.content}</pre></details><button className="nd-button" type="button" disabled={disabled} onClick={()=>onUse(source.reference,source.content)}>带入此采用版本作为参考材料</button></>}<button className="nd-button" disabled={reading} type="button" onClick={()=>setRevision(value=>value+1)}>只读核对此原版本</button></section>;
}
