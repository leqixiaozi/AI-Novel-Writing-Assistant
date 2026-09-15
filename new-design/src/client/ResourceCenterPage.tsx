import { useEffect, useMemo, useState } from "react";
import type { StrategyResourceSummary } from "../common/contracts";
import { newDesignApi } from "./api";
import ResourceShell from "./ResourceShell";

const GROUPS = [
  { key: "genre_strategy", name: "题材策略", description: "确定读者、核心体验和题材边界。" },
  { key: "progression_mode", name: "推进模式", description: "定义故事持续升级和阶段兑现的循环。" },
  { key: "writing_config", name: "写法配置", description: "保存视角、语言、节奏和章节密度。" },
  { key: "quality_rule", name: "质量规则", description: "用可解释规则检查质量与机械表达。" },
] as const;

export default function ResourceCenterPage() {
  const [resources,setResources]=useState<StrategyResourceSummary[]>([]);
  const [message,setMessage]=useState("");
  useEffect(()=>{void newDesignApi.listStrategyResources().then(setResources).catch((error)=>setMessage(error instanceof Error?error.message:"资源加载失败。"));},[]);
  const recent=useMemo(()=>[...resources].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,5),[resources]);
  return <ResourceShell active="home"><main className="nd-resource-home">{message&&<p className="nd-message is-error">{message}</p>}<section className="nd-resource-groups">{GROUPS.map((group)=><a href={`/new-design/resources/strategies?type=${group.key}`} key={group.key}><span>{resources.filter((item)=>item.typeKey===group.key).length}</span><h2>{group.name}</h2><p>{group.description}</p><b>浏览与管理 →</b></a>)}</section><section className="nd-resource-recent"><div className="nd-section-heading"><div><p className="nd-kicker">最近更新</p><h2>可直接安装的公共策略</h2></div><a href="/new-design/resources/strategies">查看全部</a></div>{recent.length?<div>{recent.map((item)=><article key={item.id}><small>{item.cardTypeName}</small><strong>{item.title}</strong><time>{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</time></article>)}</div>:<div className="nd-empty nd-empty-compact">正在准备内置策略资源。</div>}</section></main></ResourceShell>;
}
