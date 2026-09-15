import type { ReactNode } from "react";
import { NEW_DESIGN_ADVANCED_NAV } from "./navigation";

interface StructureShellProps {
  title: string;
  description: string;
  children: ReactNode;
}

export default function StructureShell({ title, description, children }: StructureShellProps) {
  return (
    <div className="nd-shell">
      <header className="nd-context-header">
        <div>
          <p className="nd-breadcrumb">新设计／高级设置／{title}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <nav className="nd-subnav" aria-label="高级设置">
        {NEW_DESIGN_ADVANCED_NAV.map((link) => <a className={window.location.pathname === link.href ? "active" : ""} key={link.href} href={link.href}>{link.label}</a>)}
      </nav>
      {children}
    </div>
  );
}
