import { useEffect, useState } from "react";
import type { BookSummary, TemplateGroupSummary, TemplateGroupVersion, TemplateSyncPreview } from "../common/contracts";
import { newDesignApi } from "./api";
import StructureShell from "./StructureShell";

function blankTemplate():TemplateGroupSummary { const now=new Date().toISOString();return {id:"",key:`template_${Date.now().toString(36)}`,name:"",description:"",status:"draft",revision:1,currentVersion:null,currentVersionId:null,draftConfig:{},createdAt:now,updatedAt:now}; }

export default function TemplateGroupsPage() {
  const [templates,setTemplates]=useState<TemplateGroupSummary[]>([]);
  const [books,setBooks]=useState<BookSummary[]>([]);
  const [draft,setDraft]=useState<TemplateGroupSummary|null>(null);
  const [versions,setVersions]=useState<TemplateGroupVersion[]>([]);
  const [previews,setPreviews]=useState<Record<string,TemplateSyncPreview>>({});
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const choose=async(template:TemplateGroupSummary)=>{setDraft(structuredClone(template));setVersions(await newDesignApi.listTemplateVersions(template.id));setPreviews({});};
  const load=async()=>{const [nextTemplates,nextBooks]=await Promise.all([newDesignApi.listTemplates(),newDesignApi.listBooks()]);setTemplates(nextTemplates);setBooks(nextBooks);if(!draft&&nextTemplates[0])await choose(nextTemplates[0]);};
  useEffect(()=>{void load().catch((error)=>setMessage(error instanceof Error?error.message:"模板组加载失败。"));},[]);
  const save=async()=>{if(!draft)return;setBusy(true);setMessage("");try{const saved=draft.id?await newDesignApi.updateTemplate(draft):await newDesignApi.createTemplate(draft);await load();await choose(saved);setMessage("模板组草稿已保存。");}catch(error){setMessage(error instanceof Error?error.message:"模板保存失败。");}finally{setBusy(false);}};
  const publish=async()=>{if(!draft?.id)return;setBusy(true);setMessage("");try{const saved=await newDesignApi.publishTemplate(draft.id,draft.revision);await load();await choose(saved);setMessage(`模板快照 v${saved.currentVersion} 已发布。`);}catch(error){setMessage(error instanceof Error?error.message:"模板发布失败。");}finally{setBusy(false);}};
  const preview=async(book:BookSummary,targetVersionId:string)=>{try{const next=await newDesignApi.previewBookSync(book.id,targetVersionId);setPreviews((current)=>({...current,[book.id]:next}));}catch(error){setMessage(error instanceof Error?error.message:"同步预览失败。");}};
  const apply=async(bookId:string)=>{const current=previews[bookId];if(!current?.id)return;setBusy(true);try{const next=await newDesignApi.applyBookSync(current.id);setPreviews((all)=>({...all,[bookId]:next}));await load();setMessage("安全新增字段已同步；书内已有字段与内容未被覆盖。");}catch(error){setMessage(error instanceof Error?error.message:"同步失败。");}finally{setBusy(false);}};
  const selectedBooks=books.filter((book)=>book.templateId===draft?.id);
  const latest=versions[0];
  const payload=latest?.payload as {cardTypes?:unknown[];dictionaries?:unknown[];relationTypes?:unknown[];forms?:unknown[];menu?:{pages?:unknown[]}}|undefined;
  return <StructureShell title="模板组" description="把类型、字典、关系、表单和菜单冻结成版本，再安全安装到每本书。">
    <div className="nd-structure-workspace"><aside className="nd-catalog-list"><div className="nd-list-heading"><div><p className="nd-kicker">模板目录</p><strong>{templates.length} 个</strong></div><button type="button" onClick={()=>{setDraft(blankTemplate());setVersions([]);}}>＋</button></div>{templates.map((template)=><button className={draft?.id===template.id?"is-selected":""} key={template.id} type="button" onClick={()=>void choose(template)}><strong>{template.name}</strong><small>{template.currentVersion?`已发布 v${template.currentVersion}`:"草稿"}</small></button>)}</aside>
      <section className="nd-structure-editor">{draft?<><div className="nd-form-grid"><label className="nd-control"><span>模板名称</span><input value={draft.name} onChange={(event)=>setDraft({...draft,name:event.target.value})}/></label><label className="nd-control"><span>稳定键</span><input disabled={Boolean(draft.id)} value={draft.key} onChange={(event)=>setDraft({...draft,key:event.target.value})}/></label></div><label className="nd-control"><span>用途说明</span><textarea value={draft.description} onChange={(event)=>setDraft({...draft,description:event.target.value})}/></label><div className="nd-template-summary"><div><strong>{payload?.cardTypes?.length??0}</strong><span>元卡片类型</span></div><div><strong>{payload?.dictionaries?.length??0}</strong><span>字典</span></div><div><strong>{payload?.relationTypes?.length??0}</strong><span>关系类型</span></div><div><strong>{payload?.forms?.length??0}</strong><span>创作表单</span></div></div><p className="nd-help-text">发布会读取结构设计中心当前的已发布内容，生成不可变快照。以后模板升级只向书内追加新的非必填稳定字段。</p><div className="nd-editor-actions"><button className="nd-button nd-button-secondary" disabled={busy||!draft.id} type="button" onClick={()=>void publish()}>发布新版本</button><button className="nd-button nd-button-primary" disabled={busy||!draft.name.trim()} type="button" onClick={()=>void save()}>{busy?"处理中…":"保存草稿"}</button></div>
        {draft.id&&<section className="nd-template-installs"><div className="nd-section-heading"><div><p className="nd-kicker">安装与升级</p><h2>使用此模板的书籍</h2></div><span>{versions.length} 个不可变版本</span></div>{selectedBooks.length?selectedBooks.map((book)=>{const sync=previews[book.id];const upToDate=!latest||book.templateVersionId===latest.id;return <article key={book.id}><div><strong>{book.name}</strong><small>已安装 v{book.templateVersion}{latest?` · 最新 v${latest.version}`:""}</small></div>{upToDate?<span className="nd-status nd-status-published">已是最新</span>:<button className="nd-button nd-button-secondary" type="button" onClick={()=>void preview(book,latest.id)}>预览升级</button>}{sync&&<div className="nd-sync-preview"><p>可安全新增 {sync.additions.reduce((sum,item)=>sum+item.fields.length,0)} 个字段；冲突 {sync.conflicts.length} 项。</p>{sync.conflicts.map((item)=><small key={`${item.typeKey}-${item.fieldKey}`}>{item.typeKey}.{item.fieldKey}：{item.reason}</small>)}{sync.status==="previewed"&&<button className="nd-button nd-button-primary" disabled={busy} type="button" onClick={()=>void apply(book.id)}>应用安全新增</button>}{sync.status==="applied"&&<span>已应用</span>}</div>}</article>}):<div className="nd-empty nd-empty-compact">还没有书籍安装此模板。</div>}</section>}
        {message&&<p className="nd-message">{message}</p>}</>:<div className="nd-empty nd-empty-page">选择或创建一个模板组。</div>}</section>
    </div>
  </StructureShell>;
}
