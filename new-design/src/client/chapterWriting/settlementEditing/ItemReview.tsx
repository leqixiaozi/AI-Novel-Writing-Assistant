import type {ChapterSettlementEditingWorkspace} from "../../../common/chapterSettlementEditing";
import type {ChapterSettlementItem} from "../../../common/contracts";
import {categoryLabels,riskLabels} from "./editing";
const decisionLabels={pending:"待确认",confirm:"纳入本章结果",reject:"不纳入",defer:"稍后处理"} as const;
export default function ItemReview({items,workspace,disabled,onEdit,onDecide}:{items:ChapterSettlementItem[];workspace:ChapterSettlementEditingWorkspace|null;disabled:boolean;onEdit:(item:ChapterSettlementItem)=>void;onDecide:(item:ChapterSettlementItem,decision:"confirm"|"reject"|"defer")=>void}){
  return <div className="nd-settlement-item-list">{items.length?items.map(item=>{const spec=workspace?.itemSpecifications.find(candidate=>candidate.itemId===item.id);return <article data-risk={item.riskLevel} data-settlement-item={item.id} key={item.id}>
    <header><div><span>{categoryLabels[item.category]}</span><strong>{item.title}</strong><small>{item.subjectLabel} · {spec?.fieldLabel??"历史记录字段"}</small></div><div><span>{riskLabels[item.riskLevel]}</span><span>{decisionLabels[item.decision]}</span></div></header>
    <dl><div><dt>变化前</dt><dd>{spec?.beforeDisplay??"历史值待核对"}</dd></div><div><dt>变化后</dt><dd>{spec?.afterDisplay??"历史值待核对"}</dd></div></dl>{spec?.unavailableReason&&<p>{spec.unavailableReason}</p>}
    <details><summary>查看正文证据与来源</summary><blockquote>{item.evidence.excerpt}</blockquote><small>第 {item.evidence.startOffset+1}–{item.evidence.endOffset} 字 · {item.sourceKind==="ai"?"AI 提案":"人工补充"}</small></details>
    <footer>{item.decision==="pending"&&<button type="button" disabled={disabled||!spec?.editable} onClick={()=>onEdit(item)}>修改</button>}<button type="button" disabled={disabled||!workspace} onClick={()=>onDecide(item,"reject")}>不纳入</button><button type="button" disabled={disabled||!workspace} onClick={()=>onDecide(item,"defer")}>稍后处理</button><button className="nd-button-primary" type="button" disabled={disabled||!spec?.editable} onClick={()=>onDecide(item,"confirm")}>纳入本章结果</button></footer>
  </article>;}):<div className="nd-empty-state"><strong>确认清单为空</strong><p>补充正文中的资料变化；正文没有资料变化时可直接形成稳定结果。</p></div>}</div>;
}
