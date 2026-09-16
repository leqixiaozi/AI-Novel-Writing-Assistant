import {useEffect,useRef,useState} from "react";
import type {CardSummary} from "../../common/contracts";
import {PROMPT_COMPONENT_RESOURCE_SPACE_ID as SPACE} from "../../common/contracts";
import {promptCategoryDescendants,type PromptCatalog,type PromptSaveInput} from "../../common/promptManagement";
import {ApiError,newDesignApi as api} from "../api";
import DynamicForm from "../DynamicForm";
import ResourceShell from "../ResourceShell";
import ClassifiedPromptTree from "./ClassifiedPromptTree";
import "./prompts.css";
export {default as ClassifiedPromptTree} from "./ClassifiedPromptTree";

const EDITABLE=new Set(["component_type","content","task_families","notes","enabled"]);
const scope={spaceId:SPACE},key=()=>`prompt-${crypto.randomUUID()}`;

export default function PromptManagementPage(){
  const [catalog,setCatalog]=useState<PromptCatalog|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [retry,setRetry]=useState<{label:string;work:()=>Promise<void>}|null>(null);
  const [editing,setEditing]=useState<CardSummary|null>(null),[title,setTitle]=useState(""),[values,setValues]=useState<Record<string,unknown>>({}),[dirty,setDirty]=useState(false);
  const [mode,setMode]=useState<"category"|"component">("category"),[categoryId,setCategoryId]=useState<string|null>(null),[categoryName,setCategoryName]=useState(""),[parentId,setParentId]=useState<string|null>(null);
  const [comparison,setComparison]=useState<CardSummary|null>(null),[issues,setIssues]=useState<Record<string,string>>({});
  const [serverChecked,setServerChecked]=useState(false);
  const phase=useRef("");
  const groups=catalog?.organization.groups.filter(group=>group.status==="active")??[],category=groups.find(group=>group.id===categoryId)??null;
  const fields=(catalog?.fields??[]).filter(field=>EDITABLE.has(field.key)).map(field=>({...field,name:field.key==="task_families"?"适用任务":field.key==="component_type"?"组件职责":field.name}));
  const read=async()=>{setCatalog(await api.getPromptCatalog());};
  const run=async(label:string,work:()=>Promise<void>)=>{
    if(busy)return;setBusy(true);setMessage("");setServerChecked(false);phase.current=label;
    try{if(retry)await read();await work();setRetry(null);setIssues({});setMessage(`${label}完成。`);}
    catch(error){setMessage(`${phase.current}失败或待核对：${error instanceof ApiError?error.message:"未收到有效回执。"} 当前页面编辑仍保留。`);if(error instanceof ApiError)setIssues(error.issues);setRetry(error instanceof ApiError&&error.status===422?null:{label:phase.current,work});}
    finally{setBusy(false);}
  };
  useEffect(()=>{void run("读取提示词",read);},[]);
  const canSwitch=()=>!busy&&!retry&&(!dirty||window.confirm("当前编辑尚未保存。确定放弃当前页面编辑并切换？"));
  const selectCategory=(id:string)=>{if(!canSwitch())return;const group=groups.find(group=>group.id===id);setMode("category");setEditing(null);setCategoryId(group?.id??null);setCategoryName(group?.name??"");setParentId(group?.parentId??null);setDirty(false);setMessage("");};
  const selectComponent=(id:string)=>{if(!canSwitch())return;const card=catalog?.components.find(component=>component.id===id);if(!card)return;setMode("component");setEditing(card);setTitle(card.title);setValues(card.values);setCategoryId(catalog?.primaryGroups[id]??null);setDirty(false);setMessage("");};
  const addCategory=(parent:string|null)=>{if(!canSwitch())return;setMode("category");setCategoryId(null);setCategoryName("");setParentId(parent);setDirty(false);};
  const addComponent=()=>{if(!canSwitch())return;setMode("component");setEditing(null);setTitle("");setValues(Object.fromEntries(fields.map(field=>[field.key,field.defaultValue])));setDirty(false);};
  const saveCategory=()=>{const command=category?{name:categoryName.trim(),parentId,sortOrder:category.sortOrder,expectedRevision:category.revision,idempotencyKey:key()}:{key:`prompt_${crypto.randomUUID().replaceAll("-","")}`,name:categoryName.trim(),parentId,sortOrder:1000,idempotencyKey:key()};void run("保存分类",async()=>{const saved=category?await api.revisePromptCategory(category.id,command as Parameters<typeof api.reviseMaterialGroup>[2]):await api.createPromptCategory(command as Parameters<typeof api.createMaterialGroup>[1]);setCategoryId(saved.id);setDirty(false);await read();});};
  const reorder=(id:string,direction:-1|1)=>{if(!canSwitch())return;const group=groups.find(group=>group.id===id);if(!group)return;const siblings=groups.filter(item=>item.parentId===group.parentId).sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name,"zh-CN"));const i=siblings.findIndex(item=>item.id===id),j=i+direction;if(j<0||j>=siblings.length)return;[siblings[i],siblings[j]]=[siblings[j],siblings[i]];const input={parentId:group.parentId,orderedIds:siblings.map(item=>item.id),expectedRevisions:Object.fromEntries(siblings.map(item=>[item.id,item.revision])),idempotencyKey:key()};void run("调整分类顺序",async()=>setCatalog(await api.reorderPromptGroups(input)));};
  const archiveCategory=()=>{if(!category||!window.confirm(`归档“${category.name}”？${category.memberCount} 个组件引用保留，正文不会删除；下级分类提升到同级，主分类在此的组件进入待选择分类。`))return;const input={expectedRevision:category.revision,childMode:"promote" as const,idempotencyKey:key()},id=category.id;void run("归档分类",async()=>{await api.archivePromptCategory(id,input);await read();setCategoryId(null);setCategoryName("");setDirty(false);});};
  const saveComponent=()=>{
    const selectedGroup=groups.find(group=>group.id===categoryId);if(!selectedGroup){setMessage("请选择中文主分类，再保存组件。");return;}
    const input:PromptSaveInput={cardId:editing?.id??null,expectedRevision:editing?.revision??null,title:title.trim(),values:Object.fromEntries(Object.entries(values).filter(([field])=>EDITABLE.has(field))),idempotencyKey:key()},classificationKey=key();
    void run("保存提示词",async()=>{phase.current="保存组件正文";const saved=await api.savePrompt(input);setEditing(saved);setDirty(false);phase.current="设置组件主分类（正文已保存）";setCatalog(await api.classifyPrompt(saved.id,{groupId:selectedGroup.id,expectedCardRevision:saved.revision,expectedGroupRevision:selectedGroup.revision,idempotencyKey:classificationKey}));});
  };
  const checkServer=async()=>{setBusy(true);try{const next=await api.getPromptCatalog();setCatalog(next);setServerChecked(true);setComparison(next.components.find(card=>card.id===editing?.id)??null);setMessage(mode==="category"?`服务器分类：${next.organization.groups.find(group=>group.id===categoryId)?.name??"尚未确认创建"}。当前名称和上级编辑仍保留；请核对后点击“保留编辑继续”。`:"服务器内容已读取，请对比后选择保留当前编辑继续。");}catch{setMessage("读取服务器结果失败。当前编辑仍保留，请检查运行维护后再次核对。");}finally{setBusy(false);}};
  const useRevision=()=>{if(!comparison)return;setEditing(comparison);setRetry(null);setComparison(null);setDirty(true);setMessage("当前编辑仍保留。请检查差异后保存；保存将替换服务器正文，历史版本仍保留。");};
  const allowedParents=category?groups.filter(group=>!promptCategoryDescendants(groups,category.id).has(group.id)):groups;
  const membership=catalog?.organization.memberships.find(member=>member.cardId===editing?.id);
  const extraGroups=groups.filter(group=>membership?.groupIds.includes(group.id)&&group.id!==catalog?.primaryGroups[editing?.id??""]);
  const selectedNode=mode==="component"&&editing?`component:${catalog?.primaryGroups[editing.id]??"unclassified"}:${editing.id}`:categoryId;
  return <ResourceShell active="prompts"><main className="nd-prompt-page">
    <p className="nd-help-text">分类用于查找，标签用于筛选，配方决定组合顺序。组件可供多个配方引用；系统任务合同与模型设置单独维护。</p>
    {message&&<section className="nd-type-recovery" role="alert"><p>{message}</p><div className="nd-action-row">{retry&&<button className="nd-button nd-button-secondary" disabled={busy} onClick={()=>void run(retry.label,retry.work)}>核对并重试{retry.label}</button>}{retry&&<button className="nd-button nd-button-secondary" disabled={busy} onClick={()=>void checkServer()}>查看服务器内容</button>}{retry&&mode==="category"&&<button className="nd-button nd-button-secondary" disabled={busy||!serverChecked} onClick={()=>{setRetry(null);setDirty(true);setMessage("当前编辑仍保留。请核对分类名称与上级，点击保存将以当前编辑更新分类。");}}>保留编辑继续</button>}<a className="nd-button nd-button-secondary" href="/new-design/structure/maintenance" target="_blank" rel="noreferrer">打开运行维护</a></div></section>}
    {catalog&&<div className="nd-prompt-workspace"><fieldset className="nd-prompt-navigation" disabled={busy||Boolean(retry)}><ClassifiedPromptTree catalog={catalog} selectedId={selectedNode} onCategory={selectCategory} onComponent={selectComponent} onAdd={addCategory} onMove={reorder}/></fieldset>
      <section className="nd-prompt-editor"><fieldset disabled={busy||Boolean(retry)} className="nd-type-editor-fields">
        {mode==="category"?<><header className="nd-section-heading"><div><p className="nd-kicker">提示词分类</p><h2>{category?category.name:"新建分类"}</h2></div><button className="nd-button nd-button-secondary" disabled={!category} onClick={addComponent}>＋ 分类内新建组件</button></header><label className="nd-control"><span>分类名称</span><input value={categoryName} onChange={event=>{setCategoryName(event.target.value);setDirty(true);}} placeholder="输入中文名称"/></label><label className="nd-control"><span>上级分类</span><select value={parentId??""} onChange={event=>{setParentId(event.target.value||null);setDirty(true);}}><option value="">顶层分类</option>{allowedParents.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label><p className="nd-help-text">移动分类只改变目录位置，组件正文、配方引用和运行历史不变。</p><div className="nd-action-row"><button className="nd-button nd-button-primary" disabled={!categoryName.trim()} onClick={saveCategory}>保存分类</button>{category&&<button className="nd-button nd-button-secondary" onClick={archiveCategory}>归档分类</button>}</div></>:<><header className="nd-section-heading"><div><p className="nd-kicker">可复用提示词组件</p><h2>{editing?editing.title:"新建组件"}</h2></div><button className="nd-button nd-button-secondary" onClick={addComponent}>＋ 新建组件</button></header><label className="nd-control"><span>组件名称</span><input value={title} onChange={event=>{setTitle(event.target.value);setDirty(true);}}/></label><label className="nd-control"><span>主分类</span><select value={categoryId??""} onChange={event=>{setCategoryId(event.target.value||null);setDirty(true);}}><option value="">请选择中文分类</option>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label><DynamicForm fields={fields} values={values} issues={issues} onChange={next=>{setValues(next);setDirty(true);}}/>{extraGroups.length>0&&<p className="nd-help-text">额外分组（保留引用）：{extraGroups.map(group=>group.name).join("、")}</p>}{membership?.tagIds.length?<p className="nd-help-text">标签：{catalog.organization.tags.filter(tag=>membership.tagIds.includes(tag.id)).map(tag=>tag.name).join("、")}</p>:null}<button className="nd-button nd-button-primary" disabled={!title.trim()||!categoryId} onClick={saveComponent}>保存组件与主分类</button><details><summary>正文预览</summary><pre className="nd-prompt-content">{String(values.content??"")||"填写内容后查看预览"}</pre></details></>}
      </fieldset>{comparison&&<section className="nd-type-recovery"><h3>服务器内容：{comparison.title}</h3><pre className="nd-prompt-content">{String(comparison.values.content??"")}</pre><button className="nd-button nd-button-secondary" disabled={busy} onClick={useRevision}>保留我的编辑，按核对后的修订继续</button></section>}</section></div>}
  </main></ResourceShell>;
}
