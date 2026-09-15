import type { ReactNode } from "react";

export default function ResourceShell({ active, children }: { active: "home" | "strategies" | "prompts"; children: ReactNode }) {
  const title=active==="home"?"我的卡片":active==="strategies"?"业务资源卡":"提示词组件卡";
  const description=active==="prompts"?"维护可复用的 AI 指令零件；组件不是小说事实，也不等于最终提示词或运行合同。":"按资源、AI 指令与正式小说事实分清用途；同一类型只保留一份定义。";
  return <div className="nd-shell"><header className="nd-page-header"><div><p className="nd-eyebrow">新设计／资源</p><h1>{title}</h1><p>{description}</p></div><a className="nd-button nd-button-primary" href="/new-design/books/new">＋ 开始一本新书</a></header><nav className="nd-subnav" aria-label="我的卡片"><a className={active === "home" ? "active" : ""} href="/new-design/resources">我的卡片</a><a className={active === "strategies" ? "active" : ""} href="/new-design/resources/strategies">业务资源卡</a><a className={active === "prompts" ? "active" : ""} href="/new-design/resources/ai/prompt-components">提示词组件卡</a></nav>{children}</div>;
}
