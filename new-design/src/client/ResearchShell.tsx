import type { ReactNode } from "react";
import Help from './storyWorkspace/Help';

export type ResearchNavKey="records"|"radar"|"analysis"|"packs";

export default function ResearchShell({active,children}:{active:ResearchNavKey;children:ReactNode}){
  const title=active==="radar"?"热门题材雷达":"研究与分析";
  return <div className="nd-shell"><header className="nd-page-header"><div><p className="nd-eyebrow">新设计／研究与分析</p><h1>{title} <Help label={title}>扫描市场、拆解作品和保存证据都可以独立完成；用于开书只是可选出口。</Help></h1></div><a className="nd-button nd-button-secondary" href="/new-design/resources">返回创作资源</a></header><nav className="nd-subnav" aria-label="研究与分析"><a className={active==="radar"?"active":""} href="/new-design/research/market-radar">市场雷达</a><a className={active==="analysis"?"active":""} href="/new-design/research/book-analysis">拆书</a><a className={active==="records"?"active":""} href="/new-design/research/records">研究记录</a><a className={active==="packs"?"active":""} href="/new-design/research/reference-packs">研究参考包</a></nav>{children}</div>;
}
