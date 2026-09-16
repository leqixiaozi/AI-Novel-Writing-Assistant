import { useEffect, useRef, useState } from "react";
import type { FieldDefinition } from "../../../common/contracts";
import type { FormAssistAction, FormAssistAdoption, FormAssistRun, FormAssistTarget, FormAssistTree } from "../../../common/formAssist";
import { formAiFieldVisible } from "../../../common/formAssist";
import { newDesignApi } from "../../api";
import "./panel.css";
import FormAiReferences from "./References";

export interface FormAiContext {target:FormAssistTarget;tagIds:string[];onAdopt:(result:FormAssistAdoption)=>void;}
const ACTIONS:Array<{key:FormAssistAction;name:string;instruction:string}>=[
  {key:"fill_required",name:"AI 填写必填项",instruction:"只准备空白的必填项目及资料名称，不要求作者先填写。根据一句想法或已有参考资料提出可用于创作的设定；没有方向时推荐一致的创作方向。保留已有人工内容，推测仅作为待采用设定。"},
  {key:"prepare_all",name:"AI 全部准备",instruction:"准备所有允许的空白项目及资料名称，不要求作者先填写。结合想法及参考资料提出完整一致的创作设定；没有方向时推荐方向。不得替换人工已有内容；不确定内容只作为待采用设定。"},
  {key:"fill_empty",name:"填写空白项",instruction:"根据已填写内容及关联资料，只填写所选空白项，保留已有内容。不确定的设定不要当作事实。"},
  {key:"supplement",name:"AI 补充剩余内容",instruction:"结合当前草稿及关联资料，仅填入剩余空白项目，不能替换或覆盖任何已有人工内容。没有方向时提出一致的创作设定供作者采用。"},
  {key:"check",name:"检查矛盾",instruction:"检查当前草稿与关联资料中的矛盾，仅提供检查意见，说明依据与不确定性，不修改资料。"},
  {key:"alternatives",name:"生成三个方案",instruction:"根据当前草稿与关联资料，提出一个可用于创作的备选方案，保持既有核心设定。"},
  {key:"adjust",name:"按我的要求调整",instruction:"仅按作者补充的要求调整所选项目，保持其他设定及关联资料不变。"},
  {key:"recommend",name:"推荐选项与标签",instruction:"根据当前草稿推荐允许范围内的字典选项和标签，遵守层级与选择数量。没有适用项时仅提出新增名称建议，不自动创建。"},
];
function text(value:unknown,field?:FieldDefinition,tree?:FormAssistTree):string {
  if(value===null||value===undefined||value===""||Array.isArray(value)&&!value.length)return "未填写";
  if(Array.isArray(value))return value.map(item=>text(item,field,tree)).join("、");
  if(typeof value==="boolean")return value?"是":"否";
  const node=tree?.nodes.find(item=>item.id===value);if(node)return node.path.join(" / ")||node.name;
  return field?.options.find(item=>item.value===value)?.label??(typeof value==="object"?"结构化内容（请在表单中查看）":String(value));
}
export default function FormAiPanel({context,fields,values,disabled}:{context:FormAiContext;fields:FieldDefinition[];values:Record<string,unknown>;disabled?:boolean}){
  const [open,setOpen]=useState(false),[action,setAction]=useState<FormAssistAction>("fill_required"),[instruction,setInstruction]=useState(""),[fieldKeys,setFieldKeys]=useState<string[]>([]);
  const [run,setRun]=useState<FormAssistRun|null>(null),[candidateId,setCandidateId]=useState(""),[selected,setSelected]=useState<Set<string>>(()=>new Set()),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [referenceCardIds,setReferenceCardIds]=useState<string[]>([]);
  const [newNames,setNewNames]=useState<Record<string,string>>({});
  const latest=useRef({values,tagIds:context.tagIds,target:context.target});latest.current={values,tagIds:context.tagIds,target:context.target};
  const generation=useRef(0),requestKey=useRef<{key:string;signature:string}|null>(null),adoptKey=useRef<{key:string;signature:string}|null>(null);
  useEffect(()=>{generation.current++;setReferenceCardIds([]);setRun(null);setCandidateId("");setSelected(new Set());setMessage("");setBusy(false);requestKey.current=null;adoptKey.current=null;},[context.target.bookId,context.target.cardId,context.target.cardTypeId,context.target.cardRevision]);
  const candidate=run?.candidates.find(item=>item.id===candidateId),available=fields.filter(field=>formAiFieldVisible(field,values)&&field.aiSuggestible!==false);
  const rows=candidate?[...Object.entries(candidate.values).map(([key,value])=>({key:`field:${key}`,fieldKey:key,treeKey:null as string|null,name:key==="__title"?"资料名称":fields.find(item=>item.key===key)?.name??"表单项目",before:text(key==="__title"?run?.snapshot.target.title:run?.snapshot.values[key],fields.find(item=>item.key===key),run?.snapshot.trees.find(tree=>tree.kind==="dictionary"&&tree.key===key)),after:text(value,fields.find(item=>item.key===key),run?.snapshot.trees.find(tree=>tree.kind==="dictionary"&&tree.key===key))})),...Object.entries(candidate.tags).map(([key,ids])=>{const tree=run?.snapshot.trees.find(item=>item.kind==="tag"&&item.key===key);return {key:`tree:${key}`,fieldKey:null as string|null,treeKey:key,name:tree?.name??"分类标签",before:text(run?.snapshot.tagIds.filter(id=>tree?.nodes.some(node=>node.id===id)),undefined,tree),after:text(ids,undefined,tree)};})]:[];
  const choose=(result:FormAssistRun)=>{setRun(result);setCandidateId(result.candidates[0]?.id??"");setSelected(new Set());setNewNames(Object.fromEntries(result.newNodes.map(item=>[item.id,item.name])));};
  const generate=async()=>{
    const sequence=++generation.current;setBusy(true);setMessage("");
    const captured=latest.current,payload={target:captured.target,action,instruction:[ACTIONS.find(item=>item.key===action)!.instruction,instruction.trim()].filter(Boolean).join("\n"),values:captured.values,tagIds:captured.tagIds,fieldKeys,referenceCardIds},signature=JSON.stringify(payload),key=requestKey.current?.signature===signature?requestKey.current.key:crypto.randomUUID();requestKey.current={key,signature};
    try {let result=await newDesignApi.generateBusinessFormAi({...payload,idempotencyKey:key});
      if(sequence!==generation.current)return;choose(result);requestKey.current=null;
      if(result.status==="failed")setMessage(`${result.error??"AI 生成没有完成。"} 未保存的表单内容保留；在本区域点击“重试生成建议”。`);
      if(result.status==="running")setMessage("同一次请求仍在生成，可稍后读取结果。");
    }catch(error){if(sequence===generation.current)setMessage(error instanceof Error?error.message:"生成失败。请重试同一次请求。");}finally{if(sequence===generation.current)setBusy(false);}
  };
  const adopt=async()=>{
    if(!run||!candidate)return;const captured=latest.current,sequence=generation.current;setBusy(true);setMessage("");const payload={candidateId:candidate.id,fieldKeys:rows.filter(row=>selected.has(row.key)&&row.fieldKey).map(row=>row.fieldKey!),treeKeys:rows.filter(row=>selected.has(row.key)&&row.treeKey).map(row=>row.treeKey!),values:captured.values,tagIds:captured.tagIds,title:captured.target.title},signature=JSON.stringify(payload),key=adoptKey.current?.signature===signature?adoptKey.current.key:crypto.randomUUID();adoptKey.current={key,signature};
    try{const result=await newDesignApi.adoptBusinessFormAi(context.target.bookId,run.id,{...payload,idempotencyKey:key});
      if(sequence!==generation.current)return;
      if(JSON.stringify(latest.current)!==JSON.stringify(captured)){setMessage("采用期间表单又有修改，未覆盖本地草稿。请重新生成后确认。");return;}
      context.onAdopt(result);setSelected(new Set());adoptKey.current=null;setMessage("勾选建议已填入表单草稿。检查后点击保存资料，才会写入正式资料。");
    }catch(error){setMessage(error instanceof Error?error.message:"采用失败，原草稿保留。");}finally{if(sequence===generation.current)setBusy(false);}
  };
  const discard=async()=>{if(!run)return;setBusy(true);try{await newDesignApi.discardBusinessFormAi(context.target.bookId,run.id,crypto.randomUUID());setRun(null);setMessage("建议已丢弃，表单内容保持不变。");}catch(error){setMessage(error instanceof Error?error.message:"丢弃失败。");}finally{setBusy(false);}};
  const resetRequest=()=>{requestKey.current=null;adoptKey.current=null;};
  return <section className="nd-form-ai"><button className="nd-form-ai-toggle" type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>AI 帮我完善 <span>{open?"收起":"展开"}</span></button>{open&&<div className="nd-form-ai-body">
    <p className="nd-help-text">AI 参考当前未保存内容与本书关联资料。建议需由你勾选采用，不会自动覆盖正式资料。</p>
    <div className="nd-form-ai-actions">{ACTIONS.map(item=><button className={`nd-button nd-button-secondary${action===item.key?" is-active":""}`} type="button" disabled={busy||disabled} aria-pressed={action===item.key} key={item.key} onClick={()=>{setAction(item.key);setFieldKeys([]);resetRequest();}}>{item.name}</button>)}</div>
    {action!=="check"&&action!=="recommend"&&<details><summary>指定要完善的项目（不选时参考全部允许项目）</summary><div className="nd-form-ai-fields">{available.map(field=><label key={field.key}><input type="checkbox" disabled={busy||disabled} checked={fieldKeys.includes(field.key)} onChange={event=>{setFieldKeys(keys=>event.target.checked?[...keys,field.key]:keys.filter(key=>key!==field.key));resetRequest();}}/>{field.name}</label>)}</div></details>}
    <FormAiReferences bookId={context.target.bookId} selected={referenceCardIds} disabled={busy||disabled} onChange={ids=>{setReferenceCardIds(ids);resetRequest();}}/>
    <label className="nd-control"><span>补充要求{action==="adjust"?"（必填）":"（可选）"}</span><textarea rows={2} value={instruction} disabled={busy||disabled} placeholder="例如：保留人物动机，补充与宗门之间的冲突" onChange={event=>{setInstruction(event.target.value);resetRequest();}}/></label>
    <button className="nd-button nd-button-primary" type="button" disabled={busy||disabled||action==="adjust"&&!instruction.trim()} onClick={()=>void generate()}>{busy?"处理中…":run?.status==="failed"?"重试生成建议":"生成建议"}</button>
    <p className="nd-help-text">可以从空白开始：输入一句想法，或直接让 AI 推荐。必填项在保存时检查；填写与补充保留人工内容。</p>
    {run&&<div className="nd-form-ai-review"><p className="nd-kicker">基于生成时的表单草稿 · 第 {run.snapshot.target.cardRevision??1} 次资料修订</p>
      {run.status==="running"&&<button className="nd-button nd-button-secondary" type="button" disabled={busy} onClick={()=>void newDesignApi.getBusinessFormAi(context.target.bookId,run.id).then(choose).catch(error=>setMessage(error.message))}>读取生成结果</button>}
      {run.observations.length>0&&<section><h4>检查意见（不是修改候选）</h4>{run.observations.map((item,index)=><p className="nd-form-ai-value" key={index}>{item.message}</p>)}</section>}
      {run.candidates.length>0&&<><div className="nd-form-ai-actions">{run.candidates.map(item=><button className="nd-button nd-button-secondary" type="button" disabled={busy} aria-pressed={candidateId===item.id} key={item.id} onClick={()=>{setCandidateId(item.id);setSelected(new Set());adoptKey.current=null;}}>{item.name}</button>)}</div>
      <div className="nd-row-actions"><button className="nd-text-button" type="button" disabled={busy} onClick={()=>{setSelected(new Set(rows.map(row=>row.key)));adoptKey.current=null;}}>全选建议</button><button className="nd-text-button" type="button" disabled={busy} onClick={()=>{setSelected(new Set());adoptKey.current=null;}}>取消选择</button></div>
      {rows.map(row=><article className="nd-form-ai-diff" key={row.key}><label><input type="checkbox" disabled={busy||disabled} checked={selected.has(row.key)} onChange={event=>{setSelected(current=>{const next=new Set(current);if(event.target.checked)next.add(row.key);else next.delete(row.key);return next;});adoptKey.current=null;}}/>{row.name}</label><dl><div><dt>生成时的内容</dt><dd>{row.before}</dd></div><div><dt>建议内容</dt><dd>{row.after}</dd></div></dl></article>)}
      <button className="nd-button nd-button-primary" type="button" disabled={busy||disabled||!selected.size} onClick={()=>void adopt()}>采用勾选项到草稿</button></>}
      {run.newNodes.map(item=>{const tree=run.snapshot.trees.find(tree=>tree.key===item.treeKey);return <div className="nd-form-ai-new" key={item.id}><label className="nd-control"><span>{tree?.name} · 建议新增（仅本书）</span><input value={newNames[item.id]??item.name} disabled={busy} onChange={event=>setNewNames(names=>({...names,[item.id]:event.target.value}))}/></label><button className="nd-button nd-button-secondary" type="button" disabled={busy||disabled||!tree?.rule.allowInlineCreate||!(newNames[item.id]??item.name).trim()} onClick={()=>{setBusy(true);void newDesignApi.confirmFormAiNode(context.target.bookId,run.id,{suggestionId:item.id,name:(newNames[item.id]??item.name).trim(),idempotencyKey:crypto.randomUUID()}).then(result=>setMessage(result.message)).catch(error=>setMessage(error.message)).finally(()=>setBusy(false));}}>确认新增到本书</button>{!tree?.rule.allowInlineCreate&&<small>该范围不允许原地新增，请到创作资源维护书内选项。</small>}</div>;})}
      <button className="nd-text-button" type="button" disabled={busy||run.status==="running"} onClick={()=>void discard()}>丢弃这组建议</button>
    </div>}{message&&<p className="nd-message" role="status">{message}</p>}
  </div>}</section>;
}
