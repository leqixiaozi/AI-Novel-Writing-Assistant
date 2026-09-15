import { useEffect, useMemo, useState } from "react";
import { PROMPT_COMPONENT_RESOURCE_SPACE_ID, type BookSummary, type StrategyResourceSummary } from "../common/contracts";
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
  const [books,setBooks]=useState<BookSummary[]>([]);
  const [promptCount,setPromptCount]=useState(0);
  const [message,setMessage]=useState("");
  useEffect(()=>{void Promise.all([newDesignApi.listStrategyResources(),newDesignApi.listCardTypes(),newDesignApi.listBooks()]).then(async([nextResources,types,nextBooks])=>{setResources(nextResources);setBooks(nextBooks);const promptType=types.find((item)=>item.key==="prompt_component");setPromptCount(promptType?(await newDesignApi.listCards(promptType.id,false,PROMPT_COMPONENT_RESOURCE_SPACE_ID)).length:0);}).catch((error)=>setMessage(error instanceof Error?error.message:"资源加载失败。"));},[]);
  const recent=useMemo(()=>[...resources].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,5),[resources]);
  return <ResourceShell active="home"><main className="nd-resource-home">{message&&<p className="nd-message is-error">{message}</p>}<section className="nd-my-card-tree" aria-label="我的卡片资源树"><details open><summary><span/><div><strong>业务资源卡</strong><small>题材、文风、推进方式与质量规则</small></div><b>{resources.length}</b></summary><div className="nd-my-card-children">{GROUPS.map((group)=><a href={`/new-design/resources/strategies?type=${group.key}`} key={group.key}><span>└</span><div><strong>{group.name}</strong><small>{group.description}</small></div><b>{resources.filter((item)=>item.typeKey===group.key).length}</b></a>)}</div></details><details open><summary><span/><div><strong>AI 资源</strong><small>可复用指令、示例与写作要求</small></div><b>{promptCount}</b></summary><div className="nd-my-card-children"><a href="/new-design/resources/ai/prompt-components"><span>└</span><div><strong>提示词组件</strong><small>动态表单维护；不包含任务合同、配方或模型路由</small></div><b>{promptCount}</b></a></div></details><details><summary><span/><div><strong>正式小说事实</strong><small>人物、世界、事件与时间线关系投影</small></div><b>{books.length} 本</b></summary><div className="nd-my-card-children">{books.map((book)=><a href={`/new-design/books/${book.id}/cards`} key={book.id}><span>└</span><div><strong>{book.name}</strong><small>进入本书资料树 · 不复制事实</small></div><b>{book.cardCount}</b></a>)}</div></details></section><section className="nd-resource-recent"><div className="nd-section-heading"><div><p className="nd-kicker">最近更新</p><h2>可直接安装的业务资源</h2></div><a href="/new-design/resources/strategies">查看全部</a></div>{recent.length?<div>{recent.map((item)=><article key={item.id}><small>{item.cardTypeName}</small><strong>{item.title}</strong><time>{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</time></article>)}</div>:<div className="nd-empty nd-empty-compact">正在准备内置业务资源。</div>}</section></main></ResourceShell>;
}
