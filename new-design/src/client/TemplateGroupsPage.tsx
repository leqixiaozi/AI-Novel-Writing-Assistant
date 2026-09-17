import ReferenceSpecification from "./referenceParity/Specification";
import {useEffect,useRef,useState} from "react";
import type {BookSummary,TemplateGroupSummary,TemplateGroupVersion,TemplateSyncPreview} from "../common/contracts";
import {newDesignApi} from "./api";
import StructureShell from "./StructureShell";
import {newStructureKey,structureDraftHash,templateConflictLabel,normalizedStructureDraft} from "./structureDraftRecovery";
import {useStructureWriteRecovery,useTemplateSyncRecovery} from "./structureWrites";

function blankTemplate():TemplateGroupSummary {const now=new Date().toISOString();return{id:"",key:newStructureKey("template"),name:"",description:"",status:"draft",revision:1,currentVersion:null,currentVersionId:null,draftConfig:{},createdAt:now,updatedAt:now};}
export default function TemplateGroupsPage(){
  const [referenceLocked,setReferenceLocked]=useState(false);
  const [templates,setTemplates]=useState<TemplateGroupSummary[]>([]),[books,setBooks]=useState<BookSummary[]>([]);
  const [draft,setDraft]=useState<TemplateGroupSummary|null>(null),[versions,setVersions]=useState<TemplateGroupVersion[]>([]);
  const [previews,setPreviews]=useState<Record<string,TemplateSyncPreview>>({}),[message,setMessage]=useState("");
  const draftRef=useRef<TemplateGroupSummary|null>(null),baseline=useRef(""),selection=useRef(0),catalogGeneration=useRef(0),versionGeneration=useRef(0);
  draftRef.current=draft;
  async function readVersions(templateId:string,selected:number){
    const request=++versionGeneration.current;
    if(!templateId){setVersions([]);return;}
    try{const next=await newDesignApi.listTemplateVersions(templateId);if(selected===selection.current&&request===versionGeneration.current&&draftRef.current?.id===templateId)setVersions(next);}
    catch{if(selected===selection.current&&request===versionGeneration.current)setMessage("读取所选模板版本失败；当前草稿保留，请重新读取版本，不使用其他模板的旧响应。");}
  }
  const recovery=useStructureWriteRecovery("template",(value,saved)=>{
    if(!("draftConfig" in value))return;
    const selected=++selection.current;draftRef.current=structuredClone(value);if(saved)baseline.current=structureDraftHash(value);
    setDraft(draftRef.current);setVersions([]);setPreviews({});void readVersions(value.id,selected);
  });
  const syncRecovery=useTemplateSyncRecovery((template,sync)=>{const selected=++selection.current;draftRef.current=structuredClone(template);baseline.current=structureDraftHash(template);setDraft(draftRef.current);setVersions([]);setPreviews({[sync.bookId]:sync});void readVersions(template.id,selected);});
  const locked=referenceLocked||recovery.locked||syncRecovery.locked,dirty=!!draft&&structureDraftHash(draft)!==baseline.current;
  function choose(next:TemplateGroupSummary){
    if(locked||recovery.isLocked()||syncRecovery.isLocked())return;
    const current=draftRef.current;
    if(current&&structureDraftHash(current)!==baseline.current&&!window.confirm("当前模板有未保存修改。放弃这些修改并切换吗？"))return;
    const selected=++selection.current;baseline.current=structureDraftHash(next);draftRef.current=structuredClone(next);setDraft(draftRef.current);setVersions([]);setPreviews({});setMessage("");void readVersions(next.id,selected);
  }
  async function load(){const request=++catalogGeneration.current,selected=selection.current;
    const [nextTemplates,nextBooks]=await Promise.all([newDesignApi.listTemplates(),newDesignApi.listBooks()]);
    if(request!==catalogGeneration.current)return;setTemplates(nextTemplates);setBooks(nextBooks);
    if(!draftRef.current&&selected===selection.current&&nextTemplates[0])choose(nextTemplates[0]);
  }
  useEffect(()=>{void load().catch(()=>setMessage("开书模板目录读取失败；当前草稿保留，请重新读取目录。"));},[]);
  async function save(){if(!draft||locked||recovery.isLocked()||syncRecovery.isLocked())return;setMessage("");const input=normalizedStructureDraft(draft);await recovery.perform("save",input,requestKey=>input.id?newDesignApi.updateTemplate({...input,requestKey}):newDesignApi.createTemplate({...input,requestKey}));void load().catch(()=>setMessage("目录刷新失败；当前草稿与已核对结果保留，请重新读取目录。"));}
  async function publish(){if(!draft?.id||locked||recovery.isLocked()||syncRecovery.isLocked())return;if(dirty){setMessage("请先保存当前模板修改，再发布该草稿的新版本。当前修改保留。");return;}setMessage("");await recovery.perform("publish",draft,requestKey=>newDesignApi.publishTemplate(draft.id,draft.revision,requestKey));void load().catch(()=>setMessage("目录刷新失败；当前草稿与已核对结果保留，请重新读取目录。"));}
  async function preview(book:BookSummary,targetVersionId:string){
    if(locked||recovery.isLocked()||syncRecovery.isLocked()||dirty)return;const selected=selection.current,templateId=draftRef.current?.id;
    try{const next=await newDesignApi.previewBookSync(book.id,targetVersionId);if(selected===selection.current&&templateId===draftRef.current?.id&&next.bookId===book.id&&next.toTemplateVersionId===targetVersionId)setPreviews(current=>({...current,[book.id]:next}));}
    catch{if(selected===selection.current)setMessage("预览本书模板升级失败；尚未应用升级，当前草稿和书内内容保留，请再次预览升级。");}
  }
  async function apply(bookId:string){const current=previews[bookId];if(!draft||!current?.id||locked||recovery.isLocked()||syncRecovery.isLocked()||dirty)return;
    await syncRecovery.apply(draft,current);void load().catch(()=>setMessage("目录刷新失败；当前原升级凭证与已核对结果保留，请重新读取目录。"));
  }
  const selectedBooks=books.filter(book=>book.templateId===draft?.id),latest=versions[0],payload=latest?.payload;
  const currentSource=templates.find(template=>template.id===draft?.id);
  const count=(key:string)=>{const values=payload?.[key];return Array.isArray(values)?values.length:0;};
  return <StructureShell title="开书模板" description="把内容类型、选项、资料关联、创作表单和菜单冻结成版本，再安全安装到每本书。">
    <div className="nd-structure-workspace"><aside className="nd-catalog-list"><div className="nd-list-heading"><div><p className="nd-kicker">模板目录</p><strong>{templates.length} 个</strong></div><button disabled={locked} type="button" onClick={()=>choose(blankTemplate())}>＋</button></div>{templates.map(template=><button disabled={locked} className={draft?.id===template.id?"is-selected":""} key={template.id} type="button" onClick={()=>choose(template)}><strong>{template.name}</strong><small>{template.currentVersion?'已发布 v'+template.currentVersion:"草稿"}</small></button>)}</aside>
      <section className="nd-structure-editor">{draft?<>
        <label className="nd-control"><span>模板名称</span><input disabled={locked} value={draft.name} onChange={event=>{if(!recovery.isLocked()&&!syncRecovery.isLocked())setDraft({...draft,name:event.target.value});}}/></label>
        <label className="nd-control"><span>用途说明</span><textarea disabled={locked} value={draft.description} onChange={event=>{if(!recovery.isLocked()&&!syncRecovery.isLocked())setDraft({...draft,description:event.target.value});}}/></label>
        <details><summary>高级技术信息（只读）</summary><p className="nd-help-text">内部标识：{draft.key}；来源修订：{draft.revision}。{dirty?"当前有未保存修改。":"当前与已读取草稿一致。"}</p></details>
        {currentSource&&currentSource.revision!==draft.revision&&<p className="nd-message" role="alert">“{currentSource.name}”的目录来源已更新；当前填写保留。{locked?"先核对原请求或原升级结果，目录变化不能证明原操作没有写入。":"点击目录中的同名模板可明确切换并核对新版草稿；不会自动覆盖当前填写。"}</p>}
        <div className="nd-template-summary">{[["cardTypes","内容类型"],["dictionaries","选项字典"],["relationTypes","资料关联"],["forms","创作表单"]].map(([key,label])=><div key={key}><strong>{count(key)}</strong><span>{label}</span></div>)}</div>
        <p className="nd-help-text">发布会读取高级设置中当前已发布的内容，生成不可变快照。以后模板升级只向书内追加新的非必填稳定字段。修改模板后请先保存草稿，再发布。</p>
        <div className="nd-editor-actions"><button className="nd-button nd-button-secondary" disabled={locked||!draft.id||dirty} type="button" onClick={()=>void publish()}>发布新版本</button><button className="nd-button nd-button-primary" disabled={locked||!draft.name.trim()} type="button" onClick={()=>void save()}>{recovery.working?"核对中…":"保存草稿"}</button></div>
        {draft.id&&<ReferenceSpecification template={draft} disabled={recovery.locked||syncRecovery.locked||dirty} onLock={setReferenceLocked} onPublished={value=>{const selected=++selection.current;draftRef.current=structuredClone(value);baseline.current=structureDraftHash(value);setDraft(draftRef.current);setPreviews({});void readVersions(value.id,selected);void load().catch(()=>setMessage("目录读取失败，原发布结果保留。"));}}/>}
        {draft.id&&<section className="nd-template-installs"><div className="nd-section-heading"><div><p className="nd-kicker">安装与升级</p><h2>使用此模板的书籍</h2></div><span>{versions.length} 个不可变版本</span></div>{selectedBooks.length?selectedBooks.map(book=>{const sync=previews[book.id],upToDate=!latest||book.templateVersionId===latest.id;return <article key={book.id}><div><strong>{book.name}</strong><small>已安装 v{book.templateVersion}{latest?' · 最新 v'+latest.version:""}</small></div>{upToDate?<span className="nd-status nd-status-published">{latest?"已是最新":"版本尚未读取"}</span>:<button disabled={locked||dirty} className="nd-button nd-button-secondary" type="button" onClick={()=>void preview(book,latest.id)}>预览升级</button>}{sync&&<div className="nd-sync-preview"><p>可安全新增 {sync.additions.reduce((sum,item)=>sum+item.fields.length,0)} 个字段；冲突 {sync.conflicts.length} 项。</p>{sync.conflicts.map(item=><small key={item.typeKey+'-'+item.fieldKey}>{templateConflictLabel(latest,item.typeKey,item.fieldKey)}：{item.reason}</small>)}{sync.status==="previewed"&&<button className="nd-button nd-button-primary" disabled={locked||dirty} type="button" onClick={()=>void apply(book.id)}>应用安全新增</button>}{sync.status==="applied"&&<span>已应用</span>}</div>}</article>}):<div className="nd-empty nd-empty-compact">还没有书籍安装此模板。</div>}</section>}
        {message&&<p className="nd-message" role="status">{message}</p>}{recovery.message&&<p className="nd-message" role="status">{recovery.message}</p>}{syncRecovery.message&&<p className="nd-message" role="status">{syncRecovery.message}</p>}{recovery.issues.length>0&&<ul role="alert">{recovery.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul>}
        <div className="nd-editor-actions"><button type="button" className="nd-button nd-button-secondary" disabled={recovery.working} onClick={()=>void load().catch(()=>setMessage("重新读取模板目录失败；当前草稿保留。"))}>重新读取目录</button>{draft.id&&<button type="button" className="nd-button nd-button-secondary" disabled={recovery.working} onClick={()=>void readVersions(draft.id,selection.current)}>重新读取版本</button>}{recovery.pending&&<button type="button" className="nd-button nd-button-secondary" disabled={recovery.working} onClick={()=>void recovery.verify()}>核对原请求结果</button>}{syncRecovery.pending&&<button type="button" className="nd-button nd-button-secondary" disabled={recovery.working||syncRecovery.working} onClick={()=>void syncRecovery.verify()}>核对原升级结果</button>}{locked&&<a href="/new-design/structure/maintenance">打开运行维护</a>}</div>
      </>:<div className="nd-empty nd-empty-page">选择或创建一个开书模板。{message&&<p role="status">{message}</p>}{recovery.message&&<p role="status">{recovery.message}</p>}{syncRecovery.message&&<p role="status">{syncRecovery.message}</p>}{locked&&<a href="/new-design/structure/maintenance">打开运行维护</a>}</div>}</section>
    </div>
  </StructureShell>;
}
