import type {FormEvent} from 'react';
import type {CreativeHubTurn} from '../../common/creativeHub';
import {isSafeCreativeHubActionHref} from './location';

const STATUS:Record<CreativeHubTurn['status'],string>={running:'诊断中／原请求待核对',succeeded:'诊断完成',failed:'已确认失败',result_unknown:'结果未知，禁止重发'};
export function CreativeHubConversation({turns,busy,question,onQuestionChange,onSubmit,onResume,disabled=false}:{turns:CreativeHubTurn[];busy:boolean;question:string;onQuestionChange(value:string):void;onSubmit():void;onResume(turn:CreativeHubTurn):void;disabled?:boolean}){
  const submit=(event:FormEvent)=>{event.preventDefault();if(question.trim()&&!busy&&!disabled)onSubmit();};
  return <section className="nd-hub-conversation" aria-label="创作诊断对话">
    <div className="nd-hub-turns">{turns.length?turns.map(turn=><article key={turn.id} className={`nd-hub-turn is-${turn.status}`}>
      <div className="nd-hub-question"><span>你</span><p>{turn.question}</p></div>
      <div className="nd-hub-answer"><header><span>创作中枢</span><small>{STATUS[turn.status]}</small></header>
        {turn.result?<><p className="nd-hub-summary">{turn.result.summary}</p>{turn.result.findings.length>0&&<ul className="nd-hub-findings">{turn.result.findings.map((finding,index)=><li key={`${finding.kind}:${index}`} className={`is-${finding.severity}`}><strong>{finding.label}</strong><p>{finding.detail}</p>{finding.source&&<small>依据：{finding.source.label}</small>}</li>)}</ul>}<div className="nd-hub-actions">{turn.result.actions.filter(action=>isSafeCreativeHubActionHref(action.href)).map((action,index)=><a className="nd-button" href={action.href} key={`${action.kind}:${index}`}>{action.label}</a>)}</div></>:turn.failure?<p role="alert">{turn.failure}</p>:<p>原请求已保存。正在等待诊断回执；刷新只会读取原记录，不会重发模型。</p>}
        {turn.status==='failed'&&<button type="button" className="nd-button" disabled={busy||disabled} onClick={()=>onResume(turn)}>按原冻结状态重试诊断</button>}
      </div>
    </article>):<div className="nd-empty-state"><p>还没有诊断记录。</p><p>可以询问当前作品进度、失败原因、人工修改影响，或应该前往哪个已有页面处理。</p></div>}</div>
    <form className="nd-hub-composer" onSubmit={submit}><label htmlFor="nd-hub-question">询问当前创作状态</label><textarea id="nd-hub-question" rows={4} maxLength={4000} value={question} disabled={disabled} onChange={event=>onQuestionChange(event.target.value)} placeholder="例如：第十章为什么还不能进入下一步？我应该到哪里处理？"/><div><p>中枢只诊断和定位，不会代替你生成正文、采用候选或修改任务。</p><button className="nd-button nd-button-primary" type="submit" disabled={disabled||busy||!question.trim()}>{busy?'正在核对原请求…':'发送诊断'}</button></div></form>
  </section>;
}
