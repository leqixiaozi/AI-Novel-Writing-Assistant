import { Component, useEffect, useState, type ReactNode } from "react";
import NewDesignPage from "../NewDesignPage";
import {ModelFailureNotice} from "../modelSettings";
import { NEW_DESIGN_ADVANCED_NAV, NEW_DESIGN_PRIMARY_NAV } from "../navigation";
import { applyTheme, readTheme, THEMES, type ThemeKey } from "./theme";

class PageBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <section className="nd-shell nd-fatal" role="alert"><h1>页面显示失败</h1><p>未保存的编辑可能无法恢复，重新载入会清除当前页面状态。请先在新标签打开运行维护或模型设置检查服务；核对已保存内容后再决定重新载入。</p><button className="nd-button" onClick={() => location.reload()}>确认重新打开页面</button><a className="nd-button" href="/new-design/structure/maintenance" target="_blank" rel="noreferrer">打开运行维护</a><a className="nd-button" href="/new-design/structure/models" target="_blank" rel="noreferrer">打开模型设置</a></section> : this.props.children;
  }
}

export function StandaloneLayout() {
  const [theme, setTheme] = useState<ThemeKey>(readTheme);
  const [expanded, setExpanded] = useState(location.pathname.startsWith("/new-design/structure/"));
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    applyTheme(theme);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => { if (theme === "system") applyTheme(theme); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  const active = (href: string) => location.pathname === href || (href !== "/new-design" && location.pathname.startsWith(`${href}/`));
  return <div className="nd-independent-layout">
    <a href="#creative-content" className="nd-independent-skip">跳到编辑内容</a>
    <ModelFailureNotice/>
    <header className="nd-independent-header"><button className="nd-independent-menu" aria-label={mobileOpen ? "收起导航" : "展开导航"} aria-expanded={mobileOpen} aria-controls="creative-navigation" onClick={() => setMobileOpen(value => !value)}>☰</button><a href="/new-design" className="nd-independent-brand">小说创作工作台<small>规划 · 创作 · 完本</small></a><a className="nd-independent-models" href="/new-design/structure/models">模型设置</a><label className="nd-independent-theme">主题<select value={theme} onChange={event => setTheme(event.target.value as ThemeKey)}>{THEMES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></header>
    <div className="nd-independent-body"><aside id="creative-navigation" className={`nd-independent-sidebar${mobileOpen ? " is-open" : ""}`}><nav aria-label="创作导航">{NEW_DESIGN_PRIMARY_NAV.map(link => <a key={link.key} href={link.href} aria-current={active(link.href) ? "page" : undefined}>{link.label}</a>)}<a href="/new-design/resources/prompts" aria-current={active("/new-design/resources/prompts") ? "page" : undefined}>提示词管理</a><button className="nd-independent-section" aria-expanded={expanded} aria-controls="advanced-navigation" onClick={() => setExpanded(value => !value)}>高级设置<span aria-hidden="true">{expanded ? "⌄" : "›"}</span></button>{expanded && <div id="advanced-navigation" className="nd-independent-advanced">{NEW_DESIGN_ADVANCED_NAV.map(link => <a key={link.key} href={link.href} aria-current={active(link.href) ? "page" : undefined}>{link.label}</a>)}</div>}<a className="nd-independent-version" href="/novels?view=shelf">切换到旧版</a></nav></aside><main id="creative-content" className="nd-independent-content" tabIndex={-1}><PageBoundary><NewDesignPage /></PageBoundary></main></div>
  </div>;
}
