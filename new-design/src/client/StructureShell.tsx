import type { ReactNode } from "react";

interface StructureShellProps {
  title: string;
  description: string;
  children: ReactNode;
}

const links = [
  { to: "/new-design/structure/card-types", label: "元卡片类型" },
  { to: "/new-design/structure/dictionaries-relations", label: "字典与关系" },
  { to: "/new-design/structure/forms", label: "卡片组表单" },
  { to: "/new-design/structure/templates", label: "模板组" },
];

export default function StructureShell({ title, description, children }: StructureShellProps) {
  return (
    <div className="nd-shell">
      <header className="nd-context-header">
        <div>
          <p className="nd-breadcrumb">新设计／结构设计中心／{title}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <nav className="nd-subnav" aria-label="结构设计中心">
        {links.map((link) => <a className={window.location.pathname === link.to ? "active" : ""} key={link.to} href={link.to}>{link.label}</a>)}
      </nav>
      {children}
    </div>
  );
}
