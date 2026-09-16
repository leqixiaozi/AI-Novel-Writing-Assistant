import { useEffect, useState } from "react";
import { FALLBACK_LABELS, MODEL_TASKS, type ManagedRouteSettings, type ManagedRouteSummary, type ManagedTaskRoute, type ModelRouteCenterCatalog, type SaveManagedModelRouteResult } from "../../common/modelRouting";
import { ApiError, newDesignApi } from "../api";
import StructureShell from "../StructureShell";
import { ConnectionEditor } from "./ConnectionEditor";
import { copySettings, initialSettings, recoveryComparison, selectedRoute, settingsDifferences, type RouteSelection } from "./editing";
import "./models.css";
export { ModelFailureNotice } from "./ModelFailureNotice";
type Pending = { action: "save" | "inherit"; checked: ModelRouteCenterCatalog | null; success: SaveManagedModelRouteResult | null };

export default function ModelSettingsPage() {
  const [catalog, setCatalog] = useState<ModelRouteCenterCatalog | null>(null);
  const [selection, setSelection] = useState<RouteSelection>("default");
  const [draft, setDraft] = useState<ManagedRouteSettings | null>(null);
  const [base, setBase] = useState<ManagedRouteSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [failedStep, setFailedStep] = useState("");
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Record<string,string>>({});
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<SaveManagedModelRouteResult | null>(null);
  const [replaceUnsupported, setReplaceUnsupported] = useState(false);
  const [preview, setPreview] = useState<ManagedTaskRoute | null>(null);
  const [credentialName, setCredentialName] = useState("");
  const [credentialVariable, setCredentialVariable] = useState("");
  const [credentialOutcomeUnknown, setCredentialOutcomeUnknown] = useState(false);
  const [credentialChecked, setCredentialChecked] = useState(false);
  const locked = busy || Boolean(pending) || credentialOutcomeUnknown;
  const report = (reason: unknown, step: string) => { setFailedStep(reason instanceof ApiError ? reason.recovery?.failedStep ?? step : step); setIssues(reason instanceof ApiError ? reason.issues : {}); setError(reason instanceof Error ? reason.message : "未收到有效服务器回执，请先核对结果。"); };
  const useServer = (value: ModelRouteCenterCatalog, next: RouteSelection) => {
    setCatalog(value); setSelection(next); setBase(selectedRoute(value, next)); setDraft(initialSettings(value, next)); setReplaceUnsupported(false); setPreview(null);
  };
  const read = async () => {
    setBusy(true); setError("");
    try {
      const value = await newDesignApi.getManagedModelCatalog();
      if (!draft) useServer(value, selection); else setCatalog(value);
      if (pending) setPending({ ...pending, checked: value });
      if (credentialOutcomeUnknown) { setCredentialChecked(true); setNotice("凭据目录读取成功。请核对是否存在同名引用，点击“已核对凭据目录，继续编辑”后继续；当前路线编辑保留。"); }
    } catch (reason) { report(reason, pending?.success ? "保存成功后的目录刷新" : "读取模型路线目录"); }
    finally { setBusy(false); }
  };
  useEffect(() => { void read(); }, []);
  const choose = (next: RouteSelection) => {
    if (!catalog || locked || next === selection) return;
    if (draft && settingsDifferences(base?.published ?? (base ? base.current : initialSettings(catalog, selection)), draft).length && !confirm("切换会放弃此页尚未保存的模型设置，是否继续？")) return;
    useServer(catalog, next); setSaved(null); setNotice(""); setError("");
  };
  const change = (value: ManagedRouteSettings) => { setDraft(value); setSaved(null); setNotice(""); };
  const refreshAfterWrite = async (action: "save" | "inherit", result: SaveManagedModelRouteResult | null) => {
    try { const value = await newDesignApi.getManagedModelCatalog(); useServer(value, selection); setPending(null); }
    catch (reason) { setPending({ action, success: result, checked: null }); report(reason, action === "save" ? "保存成功后的目录刷新" : "恢复默认成功后的目录刷新"); }
  };
  const save = async () => {
    if (!draft || locked || ((base?.configurationIssue || base?.editable === false) && !replaceUnsupported)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await newDesignApi.saveManagedModelRoute({ ...copySettings(draft), scope: selection === "default" ? "system_default" : "task", taskType: selection === "default" ? null : selection, expectedConfigId: base?.id ?? null, expectedRevision: base?.revision ?? null, idempotencyKey: crypto.randomUUID(), replaceUnsupported });
      setSaved(result); setBase(result.route); setNotice(result.active ? `设置已保存并启用，第 ${result.savedVersion} 版。` : `第 ${result.savedVersion} 版已保存，但不是当前生效版本，请核对生效路线。`);
      await refreshAfterWrite("save", result);
    } catch (reason) {
      report(reason, "保存并启用模型路线");
      if (!(reason instanceof ApiError) || reason.status === 409 || reason.status >= 500) setPending({ action: "save", success: null, checked: null });
    } finally { setBusy(false); }
  };
  const inherit = async () => {
    if (!base || selection === "default" || locked || !confirm("此任务将使用默认模型路线。既有运行快照和已保存创作结果保留，是否继续？")) return;
    setBusy(true); setError(""); setNotice("");
    try { await newDesignApi.inheritManagedModelRoute(base.id, base.revision); setNotice("恢复默认操作成功；此任务后续生成使用默认设置。已有运行快照保留。"); await refreshAfterWrite("inherit", null); }
    catch (reason) { report(reason, "恢复此任务的默认路线"); if (!(reason instanceof ApiError) || reason.status === 409 || reason.status >= 500) setPending({ action: "inherit", success: null, checked: null }); }
    finally { setBusy(false); }
  };
  const keepMine = () => { if (!pending?.checked) return; setCatalog(pending.checked); setBase(selectedRoute(pending.checked, selection)); setPending(null); setReplaceUnsupported(false); setError(""); setNotice("当前编辑保留，已对齐服务器最新修订。请核对后明确点击“保存并启用”。"); };
  const adoptServer = () => { if (!pending?.checked) return; useServer(pending.checked, selection); setPending(null); setError(""); setNotice("已采用服务器设置；没有重新发起保存或创作任务。"); };
  const addCredential = async () => {
    if (!draft || locked || !credentialName.trim() || !credentialVariable) return;
    setBusy(true); setError("");
    try {
      await newDesignApi.createManagedModelCredential({ name: credentialName.trim(), provider: draft.primary.provider, environmentVariable: credentialVariable });
      setNotice("凭据引用已创建，不包含密钥正文。请从路线的凭据列表明确选择。" );
      setCredentialName("");
      try { setCatalog(await newDesignApi.getManagedModelCatalog()); }
      catch (reason) { report(reason, "凭据已创建后的目录刷新"); setCredentialOutcomeUnknown(true); setCredentialChecked(false); }
    } catch (reason) { report(reason, "创建环境变量凭据引用"); if (!(reason instanceof ApiError) || reason.status === 409 || reason.status >= 500) { setCredentialOutcomeUnknown(true); setCredentialChecked(false); } }
    finally { setBusy(false); }
  };
  const readPreview = async () => {
    if (selection === "default" || locked) return;
    setBusy(true); setError("");
    try { setPreview(await newDesignApi.getManagedModelPreview(selection)); }
    catch (reason) { report(reason, "读取已生效路线"); }
    finally { setBusy(false); }
  };
  const check = pending?.checked && draft ? recoveryComparison(pending.checked, selection, draft, pending.action) : null;
  return <StructureShell title="模型设置" description="选择创作任务，配置模型、备用方案与用量上限。保存后仅影响后续生成，已有资料及运行快照保留。">
    {saved && <section className="nd-model-success" role="status"><h2>{saved.active ? "模型设置已保存并启用" : "模型设置已保存"}</h2><p>保存版本：第 {saved.savedVersion} 版。{saved.repeated ? "此回执来自已处理的请求。" : ""}</p><details><summary>保存凭证</summary><code>{saved.savedVersionId}</code></details></section>}
    {notice && <p role="status">{notice}</p>}
    {credentialOutcomeUnknown && <section className="nd-model-recovery"><h2>核对凭据引用创建结果</h2><p>不自动重复新增。请读取并核对目录中的引用名称；已成功创建的引用仍保留。</p>{credentialChecked && <ul>{catalog?.credentials.map(item => <li key={item.id}>{item.label} · {item.available ? "环境变量可用" : "环境变量未配置"}</li>)}</ul>}<div className="nd-action-row"><button className="nd-button" disabled={busy} onClick={() => void read()}>核对服务器结果</button><button className="nd-button" disabled={busy || !credentialChecked} onClick={() => { setCredentialOutcomeUnknown(false); setCredentialName(""); setError(""); setNotice("已明确核对凭据目录，当前模型设置仍保留。请选择需要的凭据引用。"); }}>已核对凭据目录，继续编辑</button></div></section>}
    {error && <section className="nd-message is-error" role="alert"><h2>{failedStep}未完成</h2><p>{error}</p>{Object.entries(issues).length > 0 && <ul>{Object.entries(issues).map(([path, detail]) => <li key={path}>{({provider:"模型服务",endpoint:"连接地址",model:"创作模型",credentialId:"凭据引用",failureCategories:"备用技术失败类别",maxOutputTokens:"每次输出上限",maxTotalTokens:"总用量上限",timeoutMs:"单次等待",maxRetries:"技术重试次数",retryDelayMs:"重试间隔",environmentVariable:"环境变量引用",name:"引用名称",expectedRevision:"服务器修订",expectedConfigId:"路线身份"} as Record<string,string>)[path.split(".").at(-1) ?? ""] ?? "设置内容"}：{detail}</li>)}</ul>}<p>{saved ? "已成功保存的版本保留，此处失败是读取或后续操作，不是原保存失败。" : "当前编辑和已保存创作内容保留。"}{pending ? "提交结果需先核对；写入及切换已暂停，避免重复提交。请点击“核对服务器结果”。" : "字段校验失败请核对列出的字段后点击“保存并启用”；读取失败点击“重新读取目录”，连接检查失败可在连接区域重试。"}</p></section>}
    {pending && <section className="nd-model-recovery"><h2>核对服务器结果后继续</h2><p>{check?.message ?? "不会自动重复保存。请先读取服务器状态，当前设置仍保留。"}</p>{check && draft && <p>差异：{settingsDifferences(check.route?.published ?? null, draft).join("、") || "生效设置一致"}</p>}<div className="nd-action-row"><button className="nd-button" disabled={busy} onClick={() => void read()}>核对服务器结果</button><button className="nd-button" disabled={busy || !pending.checked} onClick={adoptServer}>使用服务器设置</button><button className="nd-button" disabled={busy || !pending.checked} onClick={keepMine}>保留我的设置，按最新修订继续</button></div></section>}
    <div className="nd-model-route-workspace"><aside className="nd-model-task-list" aria-label="模型路线选择"><button disabled={locked} aria-pressed={selection === "default"} onClick={() => choose("default")}>默认创作模型<small>所有任务的基础设置</small></button>{MODEL_TASKS.map(task => <button key={task.key} disabled={locked} aria-pressed={selection === task.key} onClick={() => choose(task.key)}>{task.label}<small>{catalog && selectedRoute(catalog, task.key) ? "独立路线" : "继承默认"}</small></button>)}<button className="nd-button" disabled={busy} onClick={() => void read()}>{pending || credentialOutcomeUnknown ? "核对服务器结果" : "重新读取目录"}</button></aside>
    <section className="nd-model-route-editor" aria-busy={busy}>{draft && catalog ? <><header><h2>{selection === "default" ? "默认创作模型" : MODEL_TASKS.find(task => task.key === selection)?.label}</h2><p>{base ? `当前修订 ${base.revision} · ${base.published ? `生效第 ${base.published.version} 版` : "尚未启用"}` : selection === "default" ? "填写连接信息后保存启用。" : "此任务继承默认设置。保存将建立独立任务路线。"}</p></header>{(base?.configurationIssue || base?.editable === false) && <section className="nd-message is-error"><h3>历史设置需要明确处理</h3><p>{base?.configurationIssue ?? "此路线包含此页不能安全编辑的历史设置，请明确确认处理方式。"}</p><label><input type="checkbox" disabled={locked} checked={replaceUnsupported} onChange={event => setReplaceUnsupported(event.target.checked)}/>我确认用此页支持的设置替换未知历史参数；历史版本仍保留</label></section>}
      <h3>首选模型</h3><ConnectionEditor value={draft.primary} onChange={primary => change({ ...draft, primary })} catalog={catalog} disabled={locked} onBusy={setBusy}/>
      <section className="nd-model-fallbacks"><div className="nd-model-section-heading"><h3>备用模型</h3><button className="nd-button" disabled={locked || draft.fallbacks.length >= 4} onClick={() => change({ ...draft, fallbacks: [...draft.fallbacks, { ...draft.primary, failureCategories: ["timeout", "provider_unavailable", "transport"] }] })}>＋ 添加备用</button></div><p>最多设置 4 个备用，按显示顺序尝试。只在勾选的连接故障时使用备用；生成内容不合格时请回来源页调整后重试。</p>{draft.fallbacks.map((fallback, index) => <section key={index} className="nd-model-fallback-row"><div className="nd-model-section-heading"><h4>备用 {index + 1}</h4><div className="nd-action-row"><button className="nd-button" aria-label={`备用 ${index + 1} 上移`} disabled={locked || index === 0} onClick={() => { const rows = [...draft.fallbacks]; [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]; change({ ...draft, fallbacks: rows }); }}>上移</button><button className="nd-button" aria-label={`备用 ${index + 1} 下移`} disabled={locked || index === draft.fallbacks.length - 1} onClick={() => { const rows = [...draft.fallbacks]; [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]]; change({ ...draft, fallbacks: rows }); }}>下移</button><button className="nd-button" disabled={locked} onClick={() => change({ ...draft, fallbacks: draft.fallbacks.filter((_, position) => position !== index) })}>移除</button></div></div><ConnectionEditor value={fallback} onChange={connection => change({ ...draft, fallbacks: draft.fallbacks.map((row, position) => position === index ? { ...row, ...connection } : row) })} catalog={catalog} disabled={locked} onBusy={setBusy}/><fieldset disabled={locked} className="nd-model-failure-choices"><legend>哪些技术失败使用此备用</legend>{Object.entries(FALLBACK_LABELS).map(([key, label]) => <label key={key}><input type="checkbox" checked={fallback.failureCategories.includes(key as typeof fallback.failureCategories[number])} onChange={event => { const category = key as typeof fallback.failureCategories[number]; change({ ...draft, fallbacks: draft.fallbacks.map((row, position) => position === index ? { ...row, failureCategories: event.target.checked ? [...row.failureCategories, category] : row.failureCategories.filter(item => item !== category) } : row) }); }}/>{label}</label>)}</fieldset></section>)}</section>
      <section><h3>等待、重试和用量</h3><fieldset disabled={locked} className="nd-model-form-grid nd-model-policy">{[["timeoutMs", "单次等待（秒）", 1000], ["maxRetries", "技术重试次数", 1], ["retryDelayMs", "重试间隔（秒）", 1000], ["maxOutputTokens", "每次输出上限（计量单位）", 1], ["maxTotalTokens", "总用量上限（计量单位）", 1]].map(([key, label, divisor]) => <label className="nd-control" key={key}>{label}<input type="number" min={key === "maxRetries" || key === "retryDelayMs" ? 0 : 1} step={1} value={draft.policy[key as keyof typeof draft.policy] / Number(divisor)} onChange={event => { const numeric = Number(event.target.value); change({ ...draft, policy: { ...draft.policy, [key]: Number.isFinite(numeric) ? numeric * Number(divisor) : 0 } }); }}/></label>)}</fieldset><p>预算涵盖生成、技术重试与备用调用；额度耗尽将明确停止，不把错误当作创作结果。</p></section>
      <details className="nd-model-credential-details"><summary>环境变量凭据引用</summary><p>这里只选择服务进程的专用环境变量并保存引用，不输入密钥正文。配置后重启独立服务；不要将密钥放入资料、提示词或 Git。</p><fieldset disabled={locked} className="nd-model-form-grid"><label className="nd-control">引用名称<input value={credentialName} onChange={event => setCredentialName(event.target.value)}/></label><label className="nd-control">专用环境变量<select value={credentialVariable} onChange={event => setCredentialVariable(event.target.value)}><option value="">请选择环境变量引用</option>{catalog.environmentReferences.map(item => <option key={item.name} value={item.name}>{item.name}{item.available ? "（服务可读取）" : "（未配置）"}</option>)}</select></label><button className="nd-button" disabled={!credentialName.trim() || !credentialVariable} onClick={() => void addCredential()}>创建凭据引用</button></fieldset></details>
      <div className="nd-action-row"><button className="nd-button nd-button-primary" disabled={locked || Boolean((base?.configurationIssue || base?.editable === false) && !replaceUnsupported)} onClick={() => void save()}>保存并启用</button>{selection !== "default" && <><button className="nd-button" disabled={locked || !base} onClick={() => void inherit()}>此任务恢复默认</button><button className="nd-button" disabled={locked} onClick={() => void readPreview()}>查看已生效路线</button></>}</div>{preview && <section><h3>此任务已生效路线</h3><p>模型：{preview.primary.model}；备用 {preview.fallbacks.length} 个。</p><ol>{preview.sourceLayers.map(layer => <li key={layer.versionId}>{layer.scope === "system_default" ? "默认设置" : "任务独立设置"}<details><summary>版本凭证</summary><code>{layer.versionId}</code></details></li>)}</ol><p>此处只读，不会修改草稿、生成任务或已保存快照。</p></section>}
    </> : <p>正在读取模型路线，读取失败请点击“重新读取目录”。</p>}</section></div>
  </StructureShell>;
}
