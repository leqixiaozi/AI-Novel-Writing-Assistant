import type { ReactNode } from "react";

export default function ResourceShell({ active, children }: { active: "home" | "strategies"; children: ReactNode }) {
  return <div className="nd-shell"><header className="nd-page-header"><div><p className="nd-eyebrow">新设计／资源</p><h1>{active === "home" ? "资源中心" : "创作策略"}</h1><p>公共资源可以跨书复用；安装后会成为本书独立快照，不会与其他作品互相改动。</p></div><a className="nd-button nd-button-primary" href="/new-design/books/new">＋ 用资源开新书</a></header><nav className="nd-subnav" aria-label="资源中心"><a className={active === "home" ? "active" : ""} href="/new-design/resources">资源中心</a><a className={active === "strategies" ? "active" : ""} href="/new-design/resources/strategies">创作策略</a></nav>{children}</div>;
}
