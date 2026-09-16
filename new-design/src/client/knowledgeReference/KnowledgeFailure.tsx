import type {MouseEvent} from "react";
import {ApiError} from "../api";
import {knowledgeIssueLocation} from "./pending";
/** Locate existing controls, never reconstruct a different form to repair a failed write. */
function focusIssue(event:MouseEvent<HTMLButtonElement>,field:string){
  const page=event.currentTarget.closest('main');if(!page)return;
  const labels:Record<string,string>={filename:'UTF-8 文本或 Markdown',title:'参考标题',owner:'绑定到',reason:'归档原因',manifest:'选择上下文清单',slot:'参考位置',reference:'确认使用本参考'};
  const label=Array.from(page.querySelectorAll('label')).find(row=>row.textContent?.trim().startsWith(labels[field]??'__unavailable__'));
  const control=label?.querySelector<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea');
  label?.scrollIntoView({block:'center'});if(control&&!control.disabled)control.focus();
}
export default function KnowledgeFailure({error,onRead,locked}:{error:Error;onRead:()=>void;locked:boolean}){
  const api=error instanceof ApiError?error:null;
  return <section className="nd-message is-error" role="alert"><p>{error.message}</p>
    {api&&Object.keys(api.issues).length>0&&<ul>{Object.entries(api.issues).map(([key,value])=>{const location=knowledgeIssueLocation(key);return <li key={key}>{location.label}：{value} {location.field&&<button className="nd-button" type="button" onClick={event=>focusIssue(event,location.field!)}>定位{location.label}</button>}</li>;})}</ul>}
    <p>{api?.recovery?.savedResult??'输入和已确认保存的结果保留。'}</p>
    {locked&&<p>原请求未核对前不能修改后重发。请先点击“核对原请求”；定位按钮只查看出错位置。</p>}
    <button className="nd-button" type="button" onClick={onRead}>重读参考状态</button>
    {api?.recovery&&<a className="nd-button" href={api.recovery.sourceRoute}>{api.recovery.actionLabel}</a>}
    <a className="nd-button" href="/new-design/structure/maintenance">打开运行维护</a><p>读取和跳转不会重新上传、解析、采用或归档；原输入留在此页，离开前需确认是否保留。</p>
  </section>;
}
