import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ResolvedWritingRequirements, WritingAdjustmentScope, WritingAdjustmentWorkspace, WritingControls, WritingSettingsResponse } from "@ai-novel/shared/types/writingAdjustments";
import { createWritingAdjustmentApi } from "@/api/writingAdjustments";
import { Button } from "@/components/ui/button";
import { AdjustmentOperationKeys, explicitDirectorTaskId, preserveLines, validateWritingControls } from "./adjustmentState";
import { WritingControlsForm, adjustmentInputClass } from "./WritingControlsForm";
import { WritingChapterPanel } from "./WritingChapterPanel";
import { WritingEvidencePanel, type AdjustmentRun } from "./WritingEvidencePanel";
import { WritingPlanPanel } from "./WritingPlanPanel";
import { WritingLinesPanel } from "./WritingLinesPanel";

interface Props {
  novelId: string;
  chapterId?: string;
  currentContent?: string;
  selection?: { from: number; to: number; text: string } | null;
  onAccepted?: () => Promise<void>;
}

/** Mount the data workspace only after an explicit open. Closing preserves unsaved input. */
export function WritingAdjustmentPanel(props: Props) {
  const [visited, setVisited] = useState(false);
  return <details className="shrink-0 rounded-lg bg-muted/25 p-3" onToggle={(event) => { if (event.currentTarget.open) setVisited(true); }}>
    <summary className="cursor-pointer text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">人工调整（可选）</summary>
    {visited && <WritingAdjustmentWorkspacePanel key={`${props.novelId}:${props.chapterId ?? "novel"}`} {...props} />}
  </details>;
}

function WritingAdjustmentWorkspacePanel({ novelId, chapterId, currentContent, selection, onAccepted }: Props) {
  const [searchParams] = useSearchParams();
  const directorTaskId = explicitDirectorTaskId(searchParams.toString());
  const api = useMemo(() => createWritingAdjustmentApi(novelId), [novelId]);
  const [workspace, setWorkspace] = useState<WritingAdjustmentWorkspace | null>(null);
  const [settings, setSettings] = useState<WritingSettingsResponse | null>(null);
  const [bookSettings, setBookSettings] = useState<WritingSettingsResponse | null>(null);
  const [controls, setControls] = useState<WritingControls>({});
  const [preserve, setPreserve] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [scopeKind, setScopeKind] = useState<"chapter" | "chapters" | "selection" | "scene">(chapterId ? "chapter" : "chapters");
  const [sceneId, setSceneId] = useState("");
  const [chapterIds, setChapterIds] = useState<string[]>(chapterId ? [chapterId] : []);
  const [presetName, setPresetName] = useState("");
  const [requirements, setRequirements] = useState<ResolvedWritingRequirements | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const keys = useRef(new AdjustmentOperationKeys());
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run: AdjustmentRun = async (name, input, operation) => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(name); setError(""); setNotice("");
    const operationKey = keys.current.get(name, input);
    try {
      const result = await operation(operationKey.key);
      keys.current.complete(operationKey.identity);
      if (mounted.current) setNotice(`${name}完成。`);
      return result;
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "操作未完成，请重试。输入内容仍保留。 ");
      return undefined;
    } finally {
      running.current = false;
      if (mounted.current) setBusy("");
    }
  };
  const reload = async () => {
    try { const result = await api.workspace(); if (mounted.current) setWorkspace(result); }
    catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : "调整资料刷新失败，请手动刷新。"); }
  };
  const load = async () => {
    const result = await run("读取调整资料", { chapterId }, () => Promise.all([api.workspace(), api.settings(chapterId), chapterId ? api.settings() : Promise.resolve(null)]));
    if (result && mounted.current) {
      setWorkspace(result[0]); setSettings(result[1]); setBookSettings(result[2] ?? result[1]);
      setPreserve(result[1].effective.preserve.join("\n"));
    }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { setRequirements(null); }, [selection?.from, selection?.to, selection?.text]);
  const updateControls = (value: WritingControls) => { setControls(value); setRequirements(null); };
  const scenes = (workspace?.scenes ?? []).filter(scene => scene.chapterId === chapterId);
  const selectedSceneExists = scenes.some(scene => scene.id === sceneId);
  useEffect(() => { if (scopeKind === "scene" && !selectedSceneExists) setRequirements(null); }, [scopeKind, selectedSceneExists]);
  const scope: WritingAdjustmentScope = scopeKind === "selection" && chapterId && selection
    ? { kind: "selection", chapterId, selection }
    : scopeKind === "scene" && chapterId ? { kind: "scene", chapterId, sceneId }
      : scopeKind === "chapter" && chapterId ? { kind: "chapter", chapterId } : { kind: "chapters", chapterIds };
  const selectedChapterIds = scope.kind === "chapters" ? chapterIds : chapterId ? [chapterId] : [];
  const invalid = validateWritingControls(controls);
  const resolve = async () => {
    if (invalid) { setError(invalid); return; }
    const input = { scope, overrides: controls, preserve: preserveLines(preserve) };
    const result = await run("预览本次要求", input, (key) => api.resolve(input, key));
    if (result) setRequirements(result);
  };
  const saveSettings = async (kind: "novel" | "chapter") => {
    if (enabled && invalid) { setError(invalid); return; }
    const base = kind === "novel" ? bookSettings : settings;
    if (!base) return;
    const input = { scope: kind === "novel" ? { kind: "novel" as const } : { kind: "chapter" as const, chapterId }, expectedRevision: base.revision, settings: { enabled, controls, preserve: preserveLines(preserve) } };
    const result = await run("保存默认要求", input, (key) => api.saveSettings(input, key));
    if (result) {
      if (kind === "novel") setBookSettings(result);
      if (kind === "chapter" || !chapterId) setSettings(result);
      setRequirements(null);
    }
  };
  return <div className="mt-4 max-h-[75vh] space-y-5 overflow-auto pr-1" aria-busy={Boolean(busy)}>
    <p className="text-xs text-muted-foreground">选择本次要求，预览后执行。保存默认要求可用于后续创作。</p>
    {busy && <p role="status" className="text-sm text-muted-foreground">{busy}中…</p>}
    {error && <p role="alert" className="rounded bg-destructive/10 p-3 text-sm text-destructive">{error} 输入仍保留；版本冲突时请先比较最新稿。</p>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {!workspace || !settings ? <Button type="button" size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void load()}>重新读取调整资料</Button> : <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2"><label className="text-sm" htmlFor={`adjustment-scope-${chapterId ?? novelId}`}>本次作用范围</label><select id={`adjustment-scope-${chapterId ?? novelId}`} className={`${adjustmentInputClass} !w-auto`} value={scopeKind} onChange={(event) => { setScopeKind(event.target.value as typeof scopeKind); setRequirements(null); }}>
          {chapterId && <option value="chapter">当前章节</option>}
          {chapterId && <option value="scene">本章场景</option>}
          <option value="chapters">指定章节</option>
          {chapterId && selection?.text && <option value="selection">编辑器选中片段</option>}
        </select><Button type="button" size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void reload()}>刷新调整资料</Button></div>
        {scopeKind === "chapters" && <div className="flex max-h-36 flex-wrap gap-3 overflow-auto">{workspace.chapters.map((chapter) => <label key={chapter.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={chapterIds.includes(chapter.id)} onChange={(event) => { setChapterIds(event.target.checked ? [...chapterIds, chapter.id] : chapterIds.filter((id) => id !== chapter.id)); setRequirements(null); }} />第 {chapter.order} 章 {chapter.title}</label>)}</div>}
        {scopeKind === "selection" && <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{selection?.text ?? "请回到编辑器选择片段。"}</p>}
        {scopeKind === "scene" && <div className="space-y-2">
          <select aria-label="选择本章场景" className={adjustmentInputClass} value={sceneId} onChange={(event) => { setSceneId(event.target.value); setRequirements(null); }}><option value="">选择要调整的场景</option>{scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.sortOrder}. {scene.title}</option>)}</select>
          <p className="text-xs text-muted-foreground">{scenes.length ? "AI 将先定位正文中对应的场景，再生成局部候选。无法准确定位时，可在编辑器中手动选择片段。" : "本章尚无可用场景规划。可先完成章纲，或在编辑器中选择片段。"}</p>
        </div>}
        <select aria-label="载入写作预设" className={adjustmentInputClass} defaultValue="" onChange={(event) => {
          const preset = settings.presets.find((item) => item.id === event.target.value);
          if (preset) { updateControls(preset.settings.controls); setPreserve(preset.settings.preserve.join("\n")); setEnabled(preset.settings.enabled); }
          event.target.value = "";
        }}><option value="">选择预设（载入后可微调）</option>{settings.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select>
        <WritingControlsForm controls={controls} onChange={updateControls} characters={workspace.characters} definitions={settings.definitions} />
        <label className="block space-y-2 text-sm"><span>必须保留的事实、人物动机或剧情结果（每行一条）</span><textarea aria-label="必须保留的内容" rows={3} className={adjustmentInputClass} value={preserve} onChange={(event) => { setPreserve(event.target.value); setRequirements(null); }} /></label>
        <Button type="button" size="sm" variant="secondary" disabled={Boolean(busy) || !selectedChapterIds.length || (scopeKind === "selection" && !selection?.text) || (scopeKind === "scene" && !selectedSceneExists)} onClick={() => void resolve()}>预览本次要求</Button>
        {requirements && <div className="space-y-1 bg-muted/40 p-3"><p className="whitespace-pre-wrap text-sm">{requirements.summary}</p><p className="text-xs text-muted-foreground">本次执行使用这份要求；更改参数后需重新预览。</p></div>}
      </div>
      <details className="space-y-3"><summary className="cursor-pointer text-sm">保存为默认要求或预设</summary>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />保存后启用默认要求</label>
        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void saveSettings("novel")}>保存为本书默认</Button>{chapterId && <Button type="button" size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void saveSettings("chapter")}>保存为本章默认</Button>}</div>
        <p className="text-xs text-muted-foreground">取消勾选后保存，可停用对应默认要求。</p>
        <div className="flex flex-wrap gap-2"><input aria-label="预设名称" className={`${adjustmentInputClass} sm:!w-64`} value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="给这组要求起个名字" /><Button type="button" size="sm" variant="ghost" disabled={Boolean(busy) || !presetName.trim()} onClick={() => void (async () => {
          if (invalid) { setError(invalid); return; }
          const input = { name: presetName.trim(), settings: { enabled, controls, preserve: preserveLines(preserve) } };
          const result = await run("保存预设", input, (key) => api.savePreset(input, key));
          if (result !== undefined) {
            const fresh = await run("刷新预设", { chapterId }, () => api.settings(chapterId));
            if (fresh) setSettings(fresh);
          }
        })()}>另存为预设</Button></div>
      </details>
      {!chapterId && directorTaskId && <section className="space-y-2">
        <h4 className="text-sm">导演中的人工交接</h4>
        <p className="text-xs text-muted-foreground">接管选定章节后调整规划，完成后接回此导演任务。</p>
        <Button type="button" size="sm" variant="secondary" disabled={Boolean(busy) || !selectedChapterIds.length} onClick={() => void (async () => {
          const result = await run("接管导演中的所选章节", { directorTaskId, chapterIds: selectedChapterIds }, key => api.beginDirectorManual(directorTaskId, selectedChapterIds, key));
          if (result) await reload();
        })()}>接管所选章节</Button>
        {workspace.manualSessions.filter(session => session.status === "active" && session.taskId === directorTaskId).map(session => <div key={session.id} className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">调整范围：{session.chapterIds.map(id => workspace.chapters.find(chapter => chapter.id === id)?.title ?? "章节").join("、")}</span>
          <Button type="button" size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void (async () => {
            const result = await run("提交导演继续请求", { directorTaskId, sessionId: session.id }, key => api.completeDirectorManual(directorTaskId, session.id, key));
            if (result !== undefined) await reload();
          })()}>结束调整并继续导演</Button>
        </div>)}
      </section>}
      {chapterId && <WritingChapterPanel key={chapterId} novelId={novelId} chapterId={chapterId} directorTaskId={directorTaskId} currentContent={currentContent} workspace={workspace} requirements={requirements} api={api} run={run} busy={Boolean(busy)} reload={reload} onAccepted={onAccepted} />}
      <details className="space-y-3"><summary className="cursor-pointer text-sm">调整后续剧情与管理干预</summary><WritingPlanPanel novelId={novelId} chapterIds={selectedChapterIds} preserve={preserveLines(preserve)} workspace={workspace} api={api} run={run} busy={Boolean(busy)} reload={reload} /></details>
      <details className="space-y-3"><summary className="cursor-pointer text-sm">查阅历史、人物线与时间线</summary><WritingEvidencePanel novelId={novelId} chapterId={chapterId} workspace={workspace} api={api} run={run} busy={Boolean(busy)} /></details>
      <details className="space-y-3"><summary className="cursor-pointer text-sm">调整事件时间与参与人物</summary><WritingLinesPanel novelId={novelId} chapterId={chapterId} workspace={workspace} api={api} run={run} busy={Boolean(busy)} reload={reload} /></details>
    </fieldset>}
  </div>;
}
