import type { ReactNode } from "react";

export type ResearchNavKey="records"|"radar"|"analysis"|"packs";

export default function ResearchShell({active,children}:{active:ResearchNavKey;children:ReactNode}){
  return <div className="nd-shell"><header className="nd-page-header"><div><p className="nd-eyebrow">新设计／资源／研究与分析</p><h1>研究与分析</h1><p>扫描市场、拆解作品和保存证据都可以独立完成；用于开书只是可选出口。</p></div><a className="nd-button nd-button-secondary" href="/new-design/resources">返回我的卡片</a></header><nav className="nd-subnav" aria-label="研究与分析"><a className={active==="radar"?"active":""} href="/new-design/research/market-radar">市场雷达</a><a className={active==="analysis"?"active":""} href="/new-design/research/book-analysis">拆书</a><a className={active==="records"?"active":""} href="/new-design/research/records">研究记录</a><a className={active==="packs"?"active":""} href="/new-design/research/reference-packs">研究参考包</a></nav>{children}</div>;
}
