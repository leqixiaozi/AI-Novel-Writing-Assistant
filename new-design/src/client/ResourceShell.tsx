import type { ReactNode } from "react";

export default function ResourceShell({ active, children }: { active: "home" | "strategies" | "prompts" | "dictionaries" | "tags"; children: ReactNode }) {
  const title=active==="home"?"创作资源":active==="strategies"?"创作策略":active==="prompts"?"AI 创作资源":active==="dictionaries"?"字典树":"标签树";
  const description=active==="prompts"?"维护可跨书复用的 AI 指令零件；它们不是任何一本小说的正式设定。":active==="dictionaries"?"用树状标准值统一人物定位、地点等表单选项，作者只需使用中文。":active==="tags"?"用多个独立维度组织剧情定位、人物特征和作者标记。":"这里保存跨书复用的策略与 AI 指令；人物、世界、剧情等正式内容只进入对应的本书资料。";
  return <div className="nd-shell"><header className="nd-page-header"><div><p className="nd-eyebrow">新设计／创作资源</p><h1>{title}</h1><p>{description}</p></div><a className="nd-button nd-button-primary" href="/new-design/books/new">＋ 开始一本新书</a></header><nav className="nd-subnav" aria-label="创作资源"><a className={active === "home" ? "active" : ""} href="/new-design/resources">资源总览</a><a className={active === "strategies" ? "active" : ""} href="/new-design/resources/strategies">创作策略</a><a className={active === "dictionaries" ? "active" : ""} href="/new-design/resources/dictionaries">字典树</a><a className={active === "tags" ? "active" : ""} href="/new-design/resources/tags">标签树</a><a className={active === "prompts" ? "active" : ""} href="/new-design/resources/ai/prompt-components">AI 创作资源</a></nav>{children}</div>;
}
