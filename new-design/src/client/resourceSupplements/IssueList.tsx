import {useEffect,useState} from 'react';
import type {ResourceSupplementIssue} from '../../common/resourceSupplements/api';
import {newDesignApi} from '../api';
export default function ResourceSupplementIssueList({bookId,characterId}:{bookId:string;characterId:string}){
 const [issues,setIssues]=useState<ResourceSupplementIssue[]>([]),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;setIssues([]);setError('');void newDesignApi.listResourceSupplementIssues(bookId,characterId).then(result=>{if(active)setIssues(result);}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'资源冲突来源未读取。');});return()=>{active=false;};},[bookId,characterId,attempt]);
 if(error)return <p role="alert">资源冲突清单未读取：{error} <button className="nd-button" onClick={()=>setAttempt(value=>value+1)}>只读重查冲突来源</button></p>;
 if(!issues.length)return null;
 return <section className="nd-resource-backfill" aria-label="人物资源来源核对"><h4>资源来源需核对</h4><p>返回原章节查看实际章前依据、原确认与修正清单；影响确认不会自行解除冲突。</p><ul>{issues.map(issue=><li key={issue.issueId}><a href={issue.sourceRoute}>{issue.title} · 核对本章资源来源</a></li>)}</ul></section>;
}
