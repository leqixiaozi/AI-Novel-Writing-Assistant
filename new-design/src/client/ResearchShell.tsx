import type { ReactNode } from "react";
import Help from './storyWorkspace/Help';

export type ResearchNavKey="records"|"radar"|"analysis"|"packs";

export default function ResearchShell({active,children,headerActions}:{active:ResearchNavKey;children:ReactNode;headerActions?:ReactNode}){
  const title=active==="radar"?"热门题材雷达":"研究与分析";
  const nav=<nav className="nd-subnav" aria-label="研究与分析">{active!=="radar"&&<a href="/new-design/research/market-radar">市场雷达</a>}<a className={active==="analysis"?"active":""} href="/new-design/research/book-analysis">拆书</a><a className={active==="records"?"active":""} href="/new-design/research/records">研究记录</a><a className={active==="packs"?"active":""} href="/new-design/research/reference-packs">研究参考包</a>{active==="radar"&&<a href="/new-design/resources">创作资源</a>}</nav>;
  return <div className={`nd-shell${active==="radar"?" nd-radar-shell":""}`}><header className="nd-page-header"><div><p className="nd-eyebrow">新设计／研究与分析</p><h1>{title} <Help label={title}>扫描市场、拆解作品和保存证据都可以独立完成；用于开书只是可选出口。</Help></h1>{active==="radar"&&nav}</div>{headerActions??<a className="nd-button nd-button-secondary" href="/new-design/resources">返回创作资源</a>}</header>{active!=="radar"&&nav}{children}</div>;
}
