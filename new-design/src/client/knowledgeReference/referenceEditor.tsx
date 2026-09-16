import {useEffect,useRef,useState} from "react";
import type {KnowledgeContent,KnowledgeReferenceItem,KnowledgeReferenceCandidate,KnowledgeReferenceTarget,KnowledgeReferenceInput} from "../../common/knowledgeReference";
import {newDesignApi} from "../api";
import {COMPOSITION_ROUTE} from "../../common/promptComposition";
export function KnowledgeContentViewer({bookId,item}:{bookId:string;item:KnowledgeReferenceItem}){
  const [content,setContent]=useState<KnowledgeContent|null>(null),[busy,setBusy]=useState(false),[failure,setFailure]=useState('');const generation=useRef(0);
  useEffect(()=>{generation.current++;setContent(null);setFailure('');setBusy(false);return()=>{generation.current++;};},[bookId,item.id,item.parsedVersionId]);
  async function read(offset=0){if(!item.parsedVersionId||busy)return;const token=++generation.current;setBusy(true);setFailure('');try{
    const next=await newDesignApi.getKnowledgeContent(bookId,item.id,item.parsedVersionId,offset);if(token!==generation.current)return;
    if(next.assetId!==item.id||next.parsedVersionId!==item.parsedVersionId||next.offset!==offset)throw new Error('正文版本不匹配，请重新读取参考状态。');
    setContent(current=>offset===0?next:current&&current.parsedVersionId===next.parsedVersionId&&current.checksum===next.checksum&&current.nextOffset===next.offset?{...next,text:current.text+next.text,offset:0}:current);
  }catch(error){if(token===generation.current)setFailure(error instanceof Error?error.message:'正文读取失败，已显示内容保留，可重试读取。');}finally{if(token===generation.current)setBusy(false);}}
  return <section><h3>参考正文</h3><button className="nd-button" disabled={busy||!item.parsedVersionId} onClick={()=>void read()}>查看解析正文</button>{!item.parsedVersionId&&<p>请先解析本参考，原文件保留。</p>}{failure&&<p role="alert" className="nd-message is-error">{failure} 已读取正文保留；查看操作不会重做解析。</p>}{content&&<><pre>{content.text}</pre><p>已显示 {content.text.length} / {content.totalCharacters} 个字符。</p>{content.nextOffset!==null&&<button className="nd-button" disabled={busy} onClick={()=>void read(content.nextOffset!)}>读取后续正文</button>}</>}</section>;
}
export function KnowledgeReferenceAdoption({bookId,item,locked,onAdopt}:{bookId:string;item:KnowledgeReferenceItem;locked:boolean;onAdopt:(input:KnowledgeReferenceInput)=>Promise<void>}){
  const [candidate,setCandidate]=useState<KnowledgeReferenceCandidate|null>(null),[targets,setTargets]=useState<KnowledgeReferenceTarget[]>([]),[manifestId,setManifestId]=useState(''),[slotKey,setSlotKey]=useState(''),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[truncated,setTruncated]=useState(false);const generation=useRef(0);
  useEffect(()=>()=>{generation.current++;},[]);
  async function load(){if(busy)return;const token=++generation.current;setBusy(true);setFailure('');
    const [sources,target]=await Promise.allSettled([newDesignApi.getKnowledgeReferenceCandidates(bookId),newDesignApi.getKnowledgeReferenceTargets(bookId)]);if(token!==generation.current)return;
    if(sources.status==='fulfilled'){setCandidate(sources.value.items.find(row=>row.assetId===item.id&&row.sourceVersionId===item.versionId&&row.parsedVersionId===item.parsedVersionId)??null);setTruncated(sources.value.truncated);}else setFailure('读取引用候选失败，请重试读取；不会自动采用。');
    if(target.status==='fulfilled'){setTargets(target.value.items);setTruncated(current=>current||target.value.truncated);}else setFailure(current=>`${current} 读取可用上下文失败，已有候选保留。`);setBusy(false);
  }
  const target=targets.find(row=>row.manifestId===manifestId),slot=target?.slots.find(row=>row.slotKey===slotKey);
  return <section><h3>供 AI 使用的引用</h3><p>先查看真实解析版本，再明确加入允许参考资料的上下文位置。采用会建立新的上下文清单，保留旧清单；不会生成正文。</p><button className="nd-button" disabled={busy||locked||item.status!=='ready'} onClick={()=>void load()}>读取引用候选与使用位置</button>{failure&&<p className="nd-message is-error" role="alert">{failure}</p>}{truncated&&<p>候选或使用位置有截断，未显示的内容不会被自动采用。</p>}
    {candidate&&<><p>{candidate.title}</p><blockquote>{candidate.excerpt}</blockquote><label><input type="checkbox" checked={checked} disabled={locked} onChange={event=>setChecked(event.target.checked)}/>确认使用本参考的此解析版本</label><label className="nd-control">选择上下文清单<select disabled={locked} value={manifestId} onChange={event=>{setManifestId(event.target.value);setSlotKey('');}}><option value="">请选择</option>{targets.map(row=><option value={row.manifestId} key={row.manifestId}>{row.label}</option>)}</select></label><label className="nd-control">参考位置<select value={slotKey} disabled={locked||!target} onChange={event=>setSlotKey(event.target.value)}><option value="">请选择</option>{target?.slots.map(row=><option value={row.slotKey} key={row.slotKey} disabled={!row.allowsKnowledge}>{row.label}{row.allowsKnowledge?'':'（不允许此参考类型）'}</option>)}</select></label><button className="nd-button nd-button-primary" disabled={locked||busy||!checked||!slot?.allowsKnowledge} onClick={()=>void onAdopt({requestKey:crypto.randomUUID(),baseManifestId:manifestId,slotKey,sources:[{assetId:candidate.assetId,sourceVersionId:candidate.sourceVersionId,parsedVersionId:candidate.parsedVersionId,checksum:candidate.checksum}]})}>确认采用引用</button></>}
    {candidate&&<a className="nd-button" href={`/new-design/books/${bookId}/cards?${new URLSearchParams({knowledgeAsset:candidate.assetId,sourceVersion:candidate.sourceVersionId,parsedVersion:candidate.parsedVersionId,checksum:candidate.checksum})}`}>提炼为创作资料</a>}
    {candidate&&<a className="nd-button" href={`${COMPOSITION_ROUTE}?${new URLSearchParams({bookId,knowledgeAsset:candidate.assetId,sourceVersion:candidate.sourceVersionId,parsedVersion:candidate.parsedVersionId,checksum:candidate.checksum})}`}>在提示词组合中使用本参考</a>}
    {candidate&&<p>在资料表单中选择内容类型、核对所选参考，再用 AI 准备建议。勾选后进入普通草稿，正常保存才写入本书资料，不直接覆盖原文。</p>}
    {!busy&&!candidate&&<p>没有已就绪的匹配解析版本；请先解析本参考或重读状态。</p>}{!busy&&targets.length===0&&<p>没有可采用的上下文清单。从提示词组合建立完整预览后，再回到这里选择引用。</p>}<a className="nd-button" href="/new-design/resources/ai/prompt-composition">打开提示词组合</a>
  </section>;
}
