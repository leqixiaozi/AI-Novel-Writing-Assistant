import { Component, useEffect, useState, type ReactNode } from "react";
import NewDesignPage from "../NewDesignPage";
import {ModelFailureNotice} from "../modelSettings";
import { NEW_DESIGN_NAV_GROUPS, isNewDesignBookWorkspacePath, newDesignCurrentMenuHref } from "../navigation";
import { applyTheme, readTheme, THEMES, type ThemeKey } from "./theme";

const COLLAPSED_GROUPS_KEY = "new-design:navigation:collapsed-groups";

function readCollapsedGroups(): Set<string> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(COLLAPSED_GROUPS_KEY) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((key): key is string =>
      typeof key === "string" && NEW_DESIGN_NAV_GROUPS.some((group) => group.key === key)) : []);
  } catch {
    return new Set();
  }
}

class PageBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <section className="nd-shell nd-fatal" role="alert"><h1>页面显示失败</h1><p>未保存的编辑可能无法恢复，重新载入会清除当前页面状态。请先在新标签打开运行维护或模型设置检查服务；核对已保存内容后再决定重新载入。</p><button className="nd-button" onClick={() => location.reload()}>确认重新打开页面</button><a className="nd-button" href="/new-design/structure/maintenance" target="_blank" rel="noreferrer">打开运行维护</a><a className="nd-button" href="/new-design/structure/models" target="_blank" rel="noreferrer">打开模型设置</a></section> : this.props.children;
  }
}

export function StandaloneLayout() {
  const [pathname, setPathname] = useState(location.pathname);
  const [theme, setTheme] = useState<ThemeKey>(readTheme);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(readCollapsedGroups);
  const bookWorkspace = isNewDesignBookWorkspacePath(pathname);
  const [projectNavigation, setProjectNavigation] = useState(false);
  const currentHref = newDesignCurrentMenuHref(pathname);
  useEffect(() => {
    applyTheme(theme);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => { if (theme === "system") applyTheme(theme); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  useEffect(()=>{const changed=()=>setPathname(location.pathname);addEventListener('popstate',changed);return()=>removeEventListener('popstate',changed);},[]);
  useEffect(() => {
    try { sessionStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...collapsedGroups])); }
    catch { /* Navigation still works if browser storage is unavailable. */ }
  }, [collapsedGroups]);
  const toggleGroup = (key: string) => setCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return <div className={`nd-independent-layout${bookWorkspace ? " is-book-workspace" : ""}${projectNavigation ? " is-project-navigation" : ""}`}>
    <a href="#creative-content" className="nd-independent-skip">跳到编辑内容</a>
    <ModelFailureNotice/>
    <header className="nd-independent-header"><button className="nd-independent-menu" aria-label={mobileOpen ? "收起导航" : "展开导航"} aria-expanded={mobileOpen} aria-controls="creative-navigation" onClick={() => setMobileOpen(value => !value)}>☰</button><a href="/new-design" className="nd-independent-brand">小说创作工作台<small>规划 · 创作 · 完本</small></a>{bookWorkspace&&<button className="nd-independent-nav-switch" type="button" onClick={()=>setProjectNavigation(value=>!value)}>{projectNavigation?"创作导航":"项目导航"}</button>}<a className="nd-independent-models" href="/new-design/structure/models">模型设置</a><label className="nd-independent-theme">主题<select value={theme} onChange={event => setTheme(event.target.value as ThemeKey)}>{THEMES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></header>
    <div className="nd-independent-body">
      <aside id="creative-navigation" className={`nd-independent-sidebar${mobileOpen ? " is-open" : ""}`}>
        <nav aria-label={bookWorkspace&&projectNavigation?"项目导航":"创作导航"}>
          {NEW_DESIGN_NAV_GROUPS.map(group => {
            const collapsed = collapsedGroups.has(group.key);
            const currentLink = group.items.find(link => link.href === currentHref);
            const panelId = `nd-nav-group-${group.key}`;
            return <section key={group.key} className={`nd-independent-nav-group${collapsed ? " is-collapsed" : ""}${currentLink ? " is-current" : ""}`}>
              <button type="button" className="nd-independent-nav-group-toggle" aria-expanded={!collapsed} aria-controls={panelId} onClick={() => toggleGroup(group.key)}>
                <span>{group.label}{collapsed && currentLink && <small>{currentLink.label}</small>}</span>
                <svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 7 5 5 5-5"/></svg>
              </button>
              <div id={panelId} className="nd-independent-nav-group-links" hidden={collapsed}>
                {group.items.map(link => <a key={link.key} href={link.href} aria-current={link.href === currentHref ? "page" : undefined}>{link.label}</a>)}
              </div>
            </section>;
          })}
        </nav>
      </aside>
      <main id="creative-content" className="nd-independent-content" tabIndex={-1}><PageBoundary><NewDesignPage pathname={pathname}/></PageBoundary></main>
    </div>
  </div>;
}
