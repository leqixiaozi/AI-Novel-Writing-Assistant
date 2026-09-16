import {useCallback,useEffect,useRef,useState} from "react";
import type {AiUsageSummary} from "../../common/contracts";
import type {AuthorTaskRecord} from "../../common/authorTasks";
import {authorUsageScope,presentAuthorUsageSummary,type AuthorUsagePresentation} from "../../common/authorUsage";
import {newDesignApi} from "../api";
import "./author-usage.css";
export interface AuthorUsageApi {summarizeAiUsage(input:{bookId?:string;taskId?:string}):Promise<AiUsageSummary>;}
const actualApi:AuthorUsageApi={summarizeAiUsage:input=>newDesignApi.summarizeAiUsage(input)};
/** Only original scoped summary GET. No recovery, billing, model probe or task mutation. */
export function AuthorUsagePanel({record,api=actualApi}:{record:AuthorTaskRecord;api?:AuthorUsageApi}){
 const scope=authorUsageScope(record),scopeKey=scope?JSON.stringify(scope.filter):"unavailable";
 const [result,setResult]=useState<{scopeKey:string;value:AuthorUsagePresentation}|null>(null),[failure,setFailure]=useState(""),[busy,setBusy]=useState(false);
 const generation=useRef(0),mounted=useRef(true);
 const refresh=useCallback(async()=>{const current=authorUsageScope(record);if(!current)return;const token=++generation.current;setBusy(true);setFailure("");try{const raw=await api.summarizeAiUsage(current.filter),value=presentAuthorUsageSummary(raw);if(mounted.current&&token===generation.current)setResult({scopeKey:JSON.stringify(current.filter),value});}catch{if(mounted.current&&token===generation.current)setFailure("未完成步骤：读取原用量账本。已有候选、人工稿件与运行凭证保留；可刷新用量或回原来源核对，不重发模型。");}finally{if(mounted.current&&token===generation.current)setBusy(false);}},[api,record]);
 useEffect(()=>{mounted.current=true;setResult(null);setFailure("");void refresh();return()=>{mounted.current=false;generation.current++;};},[refresh]);
 if(!scope)return <section className="nd-author-usage"><h3>原运行用量</h3><p>此记录尚无可核对的正式书籍或原任务引用，未读取全局用量，也不据此认为没有调用。</p></section>;
 const visible=result?.scopeKey===scopeKey?result.value:null;
 return <section className="nd-author-usage" aria-label="原运行用量" aria-busy={busy}><header><h3>原运行用量</h3><button className="nd-button" type="button" disabled={busy} onClick={()=>void refresh()}>刷新用量</button></header><p>{scope.label}</p>{busy&&<p role="status">正在只读核对原用量账本…</p>}{failure&&<p role="alert">{failure}</p>}{visible&&<><dl>{visible.rows.map(row=><div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl><p>{visible.usageNotice}</p><p>{visible.costNotice}</p></>}<p>刷新或打开来源只读核对，不继续任务、不重发模型、不采用正文；恢复决定仍在原来源页明确操作。</p><a href={scope.sourceRoute}>{scope.sourceLabel}</a></section>;
}
