import { useState } from "react";
import StructureShell from "../StructureShell";
import { loadUiPreferences, saveUiPreferences, type UiPreferences } from "./preferences";
import "./settings.css";

const capabilityGroups = [
  { title: "AI 与创作任务", description: "配置模型任务、上下文范围，并查看只读运行记录。", links: [
    { label: "模型与任务配置", detail: "设置各类创作任务使用的模型、备用方案与用量上限。", href: "/new-design/structure/models" },
    { label: "上下文管理", detail: "核对创作任务可引用的资料版本、预算和裁剪原因。", href: "/new-design/structure/context" },
    { label: "运行记录", detail: "查看任务状态、错误、恢复位置和原来源页面。", href: "/new-design/operations/records" },
  ] },
  { title: "知识与质量", description: "维护知识索引与质量规则，供创作流程按明确来源使用。", links: [
    { label: "知识与参考", detail: "上传、解析、索引并绑定知识来源。", href: "/new-design/knowledge" },
    { label: "反 AI 与质量规则", detail: "维护可复用的质量检查与表达约束。", href: "/new-design/resources/strategies?type=quality_rule" },
  ] },
  { title: "运行维护", description: "检查数据库、任务、备份和本地运行状态。", links: [
    { label: "运行维护", detail: "查看运行环境状态和需要人工处理的维护信息。", href: "/new-design/structure/maintenance" },
  ] },
] as const;

export default function SystemSettingsPage() {
  const [preferences, setPreferences] = useState<UiPreferences>(() => loadUiPreferences());
  const [message, setMessage] = useState("");
  const update = (next: UiPreferences) => {
    setPreferences(next);
    setMessage(saveUiPreferences(next) ? "本次浏览会话的界面偏好已保存。" : "界面偏好已应用，但浏览器未允许保存本次会话设置。");
  };
  return <StructureShell title="系统设置" description="集中进入新版的模型、知识、质量和运行设置；每项配置仍由对应模块维护。">
    <main className="nd-system-settings">
      <section className="nd-system-preferences" aria-labelledby="ui-preferences-title">
        <div><p className="nd-kicker">本次浏览会话</p><h2 id="ui-preferences-title">界面偏好</h2><p>只影响当前浏览会话的显示，不修改书籍、模型或创作资料。</p></div>
        <fieldset><legend>内容密度</legend><label><input type="radio" name="density" checked={preferences.density === "comfortable"} onChange={() => update({ ...preferences, density: "comfortable" })}/>舒展</label><label><input type="radio" name="density" checked={preferences.density === "compact"} onChange={() => update({ ...preferences, density: "compact" })}/>紧凑</label></fieldset>
        <label className="nd-system-toggle"><input type="checkbox" checked={preferences.reduceMotion} onChange={event => update({ ...preferences, reduceMotion: event.target.checked })}/><span><strong>减少动态效果</strong><small>关闭过渡和动画，保留状态变化。</small></span></label>
        {message && <p className="nd-message" role="status">{message}</p>}
      </section>
      <div className="nd-system-groups">{capabilityGroups.map(group => <section key={group.title}>
        <header><h2>{group.title}</h2><p>{group.description}</p></header>
        <div>{group.links.map(link => <a href={link.href} key={link.href}><strong>{link.label}</strong><span>{link.detail}</span><b aria-hidden="true">→</b></a>)}</div>
      </section>)}</div>
    </main>
  </StructureShell>;
}
