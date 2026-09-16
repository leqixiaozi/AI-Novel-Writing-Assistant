import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MarketAnalysisResult,
  MarketScanDetail,
  MarketSourceDefinition,
  ResearchRecordDetail,
  ResearchRecordSummary,
} from "../common/contracts";
import { newDesignApi } from "./api";
import ResearchShell from "./ResearchShell";
import { marketAnalysisMatchesSelection } from "../common/researchInputReview";

interface PendingAnalysis {requestKey:string;input:{scanRecordId:string;scanVersionId:string;itemIds:string[];focus:string;budgetTokens:number};retryRecordId:string|null;expectedVersionId:string|null;recordId:string|null;versionId:string|null;}
const recoveryKey="new-design:market-analysis:original-request";
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function readPendingAnalysis():PendingAnalysis|null{const raw=sessionStorage.getItem(recoveryKey);if(!raw)return null;const parsed:unknown=JSON.parse(raw);if(!parsed||typeof parsed!=="object")throw new Error("原市场分析凭证无法读取，请核对网站存储与原研究记录，不重新分析。");const value=parsed as Record<string,unknown>,input=value.input;if(!input||typeof input!=="object")throw new Error("原市场分析输入凭证无效，不重新分析。");const snapshot=input as Record<string,unknown>;if(typeof value.requestKey!=="string"||!uuidPattern.test(value.requestKey)||typeof snapshot.scanRecordId!=="string"||!uuidPattern.test(snapshot.scanRecordId)||typeof snapshot.scanVersionId!=="string"||!uuidPattern.test(snapshot.scanVersionId)||!Array.isArray(snapshot.itemIds)||!snapshot.itemIds.every(id=>typeof id==="string"&&uuidPattern.test(id))||typeof snapshot.focus!=="string"||typeof snapshot.budgetTokens!=="number"||!Number.isInteger(snapshot.budgetTokens)||snapshot.budgetTokens<1||!([value.retryRecordId,value.expectedVersionId,value.recordId,value.versionId].every(id=>id===null||typeof id==="string"&&uuidPattern.test(id))))throw new Error("原市场分析来源凭证不完整，不重新分析。");return{requestKey:value.requestKey,input:{scanRecordId:snapshot.scanRecordId,scanVersionId:snapshot.scanVersionId,itemIds:snapshot.itemIds.filter((id):id is string=>typeof id==="string"),focus:snapshot.focus,budgetTokens:snapshot.budgetTokens},retryRecordId:value.retryRecordId as string|null,expectedVersionId:value.expectedVersionId as string|null,recordId:value.recordId as string|null,versionId:value.versionId as string|null};}

const statusLabel = {
  queued: "等待开始",
  running: "采集中",
  completed: "已完成",
  partial: "部分完成",
  failed: "失败",
  cancelled: "已取消",
} as const;
const analysisSections: [
  keyof Omit<MarketAnalysisResult, "evidenceBoundary" | "signals">,
  string,
][] = [
  ["genre", "题材"],
  ["protagonistIdentities", "主角身份"],
  ["coreAdvantages", "核心优势"],
  ["openingPatterns", "开局方式"],
  ["relationshipHooks", "关系钩子"],
  ["titlePatterns", "标题模式"],
  ["readerPayoffs", "读者满足"],
  ["crowdedTropes", "拥挤套路"],
  ["differentiationOpportunities", "差异化机会"],
];
const isPrimaryList = (listKey: string) =>
  listKey === "new_book" || listKey === "new_author";
const defaultAnalysisItems = (scan: MarketScanDetail) => {
  const successful = scan.snapshots.filter(
    (snapshot) => snapshot.status === "succeeded" && snapshot.items.length,
  );
  const primary = successful.filter((snapshot) =>
    isPrimaryList(snapshot.listKey),
  );
  return (primary.length ? primary : successful).flatMap((snapshot) =>
    snapshot.items.slice(0, 5).map((item) => item.id),
  );
};

export default function MarketRadarPage() {
  const scopeSequence=useRef(0),writeFlight=useRef(false),[pending,setPending]=useState<PendingAnalysis|null>(null),[recoveryBlocked,setRecoveryBlocked]=useState(false);
  const pendingRef=useRef<PendingAnalysis|null>(null);pendingRef.current=pending;
  const persistPending=(value:PendingAnalysis|null)=>{try{if(value)sessionStorage.setItem(recoveryKey,JSON.stringify(value));else sessionStorage.removeItem(recoveryKey);pendingRef.current=value;setPending(value);return true;}catch{setRecoveryBlocked(true);setMessage("原市场分析凭证无法安全保存，填写与此前报告保留；核对前不发起新的分析。");return false;}};
  const [sources, setSources] = useState<MarketSourceDefinition[]>([]),
    [sourceKeys, setSourceKeys] = useState<string[]>([]),
    [records, setRecords] = useState<ResearchRecordSummary[]>([]);
  const [scan, setScan] = useState<MarketScanDetail | null>(null),
    [selectedItems, setSelectedItems] = useState<string[]>([]),
    [analysis, setAnalysis] = useState<ResearchRecordDetail | null>(null);
  const [focus, setFocus] = useState("寻找仙侠、成长与悬疑结合的差异化机会"),
    [budget, setBudget] = useState(5000),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const loadRecords = async () => {
    const next = await newDesignApi.listResearchRecords({
      type: "market_scan",
    });
    setRecords(next);
    return next;
  };
  useEffect(() => {
    let active=true;try{const original=readPendingAnalysis();pendingRef.current=original;setPending(original);}catch(error){setRecoveryBlocked(true);setMessage(error instanceof Error?error.message:"原分析凭证无法读取，不重新分析。");}
    void Promise.all([
      newDesignApi.listMarketSources(),
      loadRecords(),
      newDesignApi.listResearchRecords({ type: "market_analysis" }),
    ])
      .then(([nextSources, nextRecords, analyses]) => {
        if(!active)return;
        setSources(nextSources);
        setSourceKeys(
          nextSources.map((item) => `${item.platform}:${item.listKey}`),
        );
        if (nextRecords[0]&&!pendingRef.current&&!recoveryBlocked) {
          const sequence=scopeSequence.current,id=nextRecords[0].id;
          void newDesignApi.getMarketScan(id).then(detail=>{if(active&&sequence===scopeSequence.current&&detail.record.id===id)setScan(detail);}).catch(error=>{if(active)setMessage(error instanceof Error?error.message:"原扫描读取失败。");});
          const related = analyses.find(
            (item) =>
              item.currentVersion.sourceScope.scanRecordId ===
              nextRecords[0].id,
          );
          if (related)
            void newDesignApi.getResearchRecord(related.id).then(detail=>{if(active&&sequence===scopeSequence.current&&detail.id===related.id&&detail.currentVersion.sourceScope.scanRecordId===id)setAnalysis(detail);}).catch(error=>{if(active)setMessage(error instanceof Error?error.message:"原分析读取失败。");});
        }
      })
      .catch((error) =>
        active&&setMessage(
          error instanceof Error ? error.message : "市场雷达加载失败。",
        ),
      );return()=>{active=false;++scopeSequence.current;};
  }, []);
  const scanRunning =
      scan &&
      ["queued", "running"].includes(scan.version.runStatus),
    analysisRunning =
      analysis &&
      ["queued", "running"].includes(analysis.currentVersion.runStatus);
  useEffect(() => {
    if (!scanRunning && !analysisRunning) return;
    let active=true;const sequence=scopeSequence.current;
    const timer = window.setInterval(() => {
      if (scanRunning && scan)
        void newDesignApi.getMarketScan(scan.record.id,scan.version.id).then(detail=>{if(active&&sequence===scopeSequence.current&&detail.record.id===scan.record.id&&detail.version.id===scan.version.id)setScan(detail);}).catch(error=>{if(active)setMessage(error instanceof Error?error.message:"原扫描刷新失败，已读取快照保留。");});
      if (analysisRunning && analysis)
        void newDesignApi.getResearchRecord(analysis.id).then(detail=>{if(active&&sequence===scopeSequence.current&&detail.id===analysis.id){const version=detail.versions.find(item=>item.id===analysis.currentVersion.id);if(version)setAnalysis({...detail,currentVersion:version});else setMessage("原分析版本不存在，已读取报告保留，不选最新版本代替。");}}).catch(error=>{if(active)setMessage(error instanceof Error?error.message:"原分析刷新失败，已读取报告保留。");});
      void loadRecords().catch(error=>{if(active)setMessage(error instanceof Error?error.message:"扫描目录刷新失败，原报告保留。");});
    }, 1200);
    return () => {active=false;window.clearInterval(timer);};
  }, [scan?.record.id,scan?.version.id, scanRunning, analysis?.id,analysis?.currentVersion.id, analysisRunning]);
  useEffect(() => {
    if (scan && !scanRunning && !selectedItems.length)
      setSelectedItems(defaultAnalysisItems(scan));
  }, [scan?.version.id, scanRunning]);
  const grouped = useMemo(
    () =>
      sources.reduce<Record<string, MarketSourceDefinition[]>>((all, item) => {
        (all[item.platformLabel] ??= []).push(item);
        return all;
      }, {}),
    [sources],
  );
  const result = analysis?.currentVersion.structuredResult as
    | Partial<MarketAnalysisResult>
    | undefined;
  const beginScan = async () => {
    if(writeFlight.current||pendingRef.current||recoveryBlocked)return;writeFlight.current=true;++scopeSequence.current;
    setBusy(true);
    setMessage("");
    try {
      const run = await newDesignApi.startMarketScan(sourceKeys);
      const detail = await newDesignApi.getMarketScan(run.recordId);
      setScan(detail);
      setAnalysis(null);setSelectedItems([]);
      await loadRecords();
      setMessage("扫描已开始；只采集公开榜单元数据，不会调用 AI。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "扫描启动失败。");
    } finally {
      setBusy(false);
      writeFlight.current=false;
    }
  };
  const openScan = async (id: string) => {
    if(writeFlight.current||pendingRef.current||recoveryBlocked)return;const sequence=++scopeSequence.current;
    setBusy(true);
    try {
      const detail=await newDesignApi.getMarketScan(id);if(sequence!==scopeSequence.current)return;if(detail.record.id!==id)throw new Error("原扫描来源不匹配，不能选择其他记录代替。");setScan(detail);setAnalysis(null);setSelectedItems([]);
    } catch (error) {
      if(sequence===scopeSequence.current)setMessage(error instanceof Error ? error.message : "扫描记录加载失败。");
    } finally {
      if(sequence===scopeSequence.current)setBusy(false);
    }
  };
  const retry = async () => {
    if (!scan||writeFlight.current||pendingRef.current||recoveryBlocked) return;writeFlight.current=true;++scopeSequence.current;
    setBusy(true);
    try {
      await newDesignApi.retryMarketScan(scan.record.id);
      setScan(await newDesignApi.getMarketScan(scan.record.id));
      setSelectedItems([]);
      setMessage("已新增扫描版本，旧快照保持不变。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重试失败。");
    } finally {
      setBusy(false);
      writeFlight.current=false;
    }
  };
  const cancel = async (versionId: string) => {
    if(writeFlight.current||pendingRef.current||recoveryBlocked)return;
    try {
      await newDesignApi.cancelResearchRun(versionId);
      setMessage("已请求取消，当前已保存的来源快照会保留。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取消失败。");
    }
  };
  const checkAnalysis=async()=>{const original=pendingRef.current;if(!original||writeFlight.current)return;writeFlight.current=true;setBusy(true);try{const detail=await newDesignApi.getMarketAnalysisByKey(original.input.scanRecordId,original.requestKey);if(!detail){setMessage("原请求尚未读到回执，不证明未执行；原输入和凭证保留，只读核对，不重新分析。");return;}const version=detail.currentVersion;if(detail.type!=="market_analysis"||version.sourceScope.requestKey!==original.requestKey||version.sourceScope.scanRecordId!==original.input.scanRecordId||version.sourceScope.scanVersionId!==original.input.scanVersionId||version.inputSnapshot.focus!==original.input.focus||version.budgetTokens!==original.input.budgetTokens||JSON.stringify(version.sourceScope.itemIds)!==JSON.stringify(original.input.itemIds)||original.retryRecordId&&detail.id!==original.retryRecordId||original.expectedVersionId&&version.parentVersionId!==original.expectedVersionId||original.recordId&&detail.id!==original.recordId||original.versionId&&version.id!==original.versionId)throw new Error("原分析回执与冻结输入不一致，凭证与填写保留，不按其他报告代替。");const source=await newDesignApi.getMarketScan(original.input.scanRecordId,original.input.scanVersionId);if(source.record.id!==original.input.scanRecordId||source.version.id!==original.input.scanVersionId)throw new Error("原扫描版本未核对，原分析回执保留。");++scopeSequence.current;setScan(source);setAnalysis(detail);setSelectedItems(original.input.itemIds);setFocus(original.input.focus);setBudget(original.input.budgetTokens);persistPending(null);setMessage("原市场分析请求已核对，只读取原报告与版本，没有再次调用模型。");}catch(error){setMessage(error instanceof Error?error.message:"核对原市场分析失败，原凭证与输入保留。");}finally{writeFlight.current=false;setBusy(false);}};
  const beginAnalysis = async (retryOriginal=false) => {
    if (!scan||writeFlight.current||pendingRef.current||recoveryBlocked||analysisRunning||!selectedItems.length) return;
    if(retryOriginal&&(!analysis||!marketAnalysisMatchesSelection(analysis,scan,selectedItems,focus,budget))){setMessage("当前勾选或输入与原分析不一致。请明确按当前选择新建分析，不会偷偷重跑旧输入。");return;}
    const input={scanRecordId:scan.record.id,scanVersionId:scan.version.id,itemIds:[...selectedItems],focus,budgetTokens:budget},original:PendingAnalysis={requestKey:crypto.randomUUID(),input,retryRecordId:retryOriginal&&analysis?analysis.id:null,expectedVersionId:retryOriginal&&analysis?analysis.currentVersion.id:null,recordId:null,versionId:null};if(!persistPending(original))return;writeFlight.current=true;++scopeSequence.current;
    setBusy(true);
    setMessage("");
    try {
      const run = retryOriginal&&analysis
        ? await newDesignApi.retryMarketAnalysis(analysis.id,{requestKey:original.requestKey,expectedVersionId:analysis.currentVersion.id})
        : await newDesignApi.startMarketAnalysis({
            ...input,requestKey:original.requestKey,
          });
      persistPending({...original,recordId:run.recordId,versionId:run.versionId});const detail=await newDesignApi.getMarketAnalysisByKey(input.scanRecordId,original.requestKey);if(!detail||detail.id!==run.recordId||detail.currentVersion.id!==run.versionId)throw new Error("分析已提交，原回执尚未核对；仅核对原请求，不再次生成。");setAnalysis(detail);persistPending(null);
      setMessage(
        retryOriginal
          ? `已新增市场分析 v${run.version}，旧报告保持不变。`
        : "AI 只会分析你勾选的作品；结果先成为候选，不会自动建书或写入正式资料。",
      );
    } catch (error) {
      setMessage(`未完成步骤：准备市场分析或读取原回执。${error instanceof Error ? error.message : "执行结果待核对。"} 原勾选、输入、旧报告与原凭证保留，请点击“只读核对原分析请求”，不重新调用模型。`);
    } finally {
      setBusy(false);
      writeFlight.current=false;
    }
  };
  const adopt = async (id: string) => {
    if(writeFlight.current||pendingRef.current||recoveryBlocked||!analysis?.candidates.some(candidate=>candidate.id===id&&candidate.researchVersionId===analysis.currentVersion.id&&candidate.status==="candidate"))return;
    setBusy(true);
    try {
      const card = await newDesignApi.adoptMarketSignal(id);
      if (analysis)
        setAnalysis(await newDesignApi.getResearchRecord(analysis.id));
      setMessage(`“${card.title}”已由你确认保存为市场信号资料。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "市场信号保存失败。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResearchShell active="radar">
      <main className="nd-market-radar">
        {(pending||recoveryBlocked)&&<div className="nd-message" role="alert"><p>原分析请求需要核对，填写、旧报告与原凭证保留；不能新建或重跑分析。</p>{pending&&<button className="nd-button nd-button-secondary" type="button" disabled={busy} onClick={()=>void checkAnalysis()}>只读核对原分析请求</button>}<a href="/new-design/research/records">打开原研究记录核对来源</a></div>}
        <section className="nd-radar-source-panel">
          <div className="nd-section-heading">
            <div>
              <p className="nd-kicker">第一步 · 只采集</p>
              <h2>选择公开榜单</h2>
              <p>进入页面不会扫描；点击后也只保存公开元数据和来源时间。</p>
            </div>
            <button
              className="nd-button nd-button-primary"
              disabled={busy ||pending!==null||recoveryBlocked|| !sourceKeys.length}
              onClick={() => void beginScan()}
              type="button"
            >
              开始扫描
            </button>
          </div>
          <div className="nd-radar-sources">
            {Object.entries(grouped).map(([platform, items]) => (
              <fieldset key={platform}>
                <legend>{platform}</legend>
                {items.map((item) => {
                  const key = `${item.platform}:${item.listKey}`;
                  return (
                    <label key={key}>
                      <input
                        disabled={busy||pending!==null||recoveryBlocked}
                        checked={sourceKeys.includes(key)}
                        onChange={(event) =>
                          setSourceKeys((current) =>
                            event.target.checked
                              ? [...current, key]
                              : current.filter((value) => value !== key),
                          )
                        }
                        type="checkbox"
                      />
                      <span>
                        <strong>{item.listLabel}</strong>
                        <small>
                          {item.channel === "male"
                            ? "男频"
                            : item.channel === "female"
                              ? "女频"
                              : "综合"}{" "}
                          · 公开页面
                        </small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
        </section>
        <section className="nd-radar-history">
          <div className="nd-section-heading">
            <div>
              <p className="nd-kicker">扫描历史</p>
              <h2>每次运行都留版本</h2>
            </div>
            <b>{records.length}</b>
          </div>
          <div>
            {records.map((record) => (
              <button
                className={scan?.record.id === record.id ? "is-selected" : ""}
                key={record.id}
                disabled={busy||pending!==null||recoveryBlocked}
                onClick={() => void openScan(record.id)}
                type="button"
              >
                <span>
                  <strong>{record.title}</strong>
                  <small>
                    v{record.currentVersion.version} ·{" "}
                    {statusLabel[record.currentVersion.runStatus]}
                  </small>
                </span>
                <b>{record.currentVersion.progress}%</b>
              </button>
            ))}
          </div>
        </section>
        {scan && (
          <section className="nd-radar-results">
            <div className="nd-radar-run-head">
              <div>
                <p className="nd-kicker">
                  扫描 v{scan.version.version}
                </p>
                <h2>
                  {statusLabel[scan.version.runStatus]} ·{" "}
                  {scan.snapshots.reduce(
                    (sum, item) => sum + item.items.length,
                    0,
                  )}{" "}
                  条
                </h2>
                <p>
                  {scan.version.report ||
                    scan.version.lastError ||
                    "正在逐个读取所选公开榜单。"}
                </p>
              </div>
              <div>
                {scanRunning && (
                  <button
                    className="nd-button nd-button-secondary"
                    disabled={busy||pending!==null||recoveryBlocked}
                    onClick={() => void cancel(scan.version.id)}
                    type="button"
                  >
                    取消扫描
                  </button>
                )}
                {!scanRunning && (
                  <button
                    className="nd-button nd-button-secondary"
                    disabled={busy||pending!==null||recoveryBlocked}
                    onClick={() => void retry()}
                    type="button"
                  >
                    重试并新增版本
                  </button>
                )}
              </div>
            </div>
            <progress max="100" value={scan.version.progress} />
            <div className="nd-radar-snapshots">
              {scan.snapshots.map((snapshot) => (
                <details
                  open={snapshot.status === "succeeded"}
                  key={snapshot.id}
                >
                  <summary>
                    <span>
                      {snapshot.platform}／{snapshot.listLabel}
                    </span>
                    <b className={`nd-state is-${snapshot.status}`}>
                      {snapshot.status === "succeeded"
                        ? `${snapshot.items.length} 条`
                        : snapshot.status === "failed"
                          ? "失败"
                          : "旧快照"}
                    </b>
                  </summary>
                  {snapshot.error && (
                    <p className="nd-message is-error">
                      {snapshot.error}；其他来源与既有记录不受影响。
                    </p>
                  )}
                  <div>
                    {snapshot.items.map((item) => (
                      <label key={item.id}>
                        <input
                          disabled={busy||pending!==null||recoveryBlocked||Boolean(analysisRunning)}
                          checked={selectedItems.includes(item.id)}
                          onChange={(event) =>
                            setSelectedItems((current) =>
                              event.target.checked
                                ? [...current, item.id]
                                : current.filter((id) => id !== item.id),
                            )
                          }
                          type="checkbox"
                        />
                        <span className="nd-rank">{item.rank}</span>
                        <span>
                          <strong>{item.title}</strong>
                          <small>
                            {[item.author, item.category, item.heatLabel]
                              .filter(Boolean)
                              .join(" · ") || "公开榜单条目"}
                          </small>
                        </span>
                        <a
                          href={item.sourceUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          来源
                        </a>
                      </label>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </section>
        )}
        {scan &&
          !scanRunning &&
          scan.snapshots.some((item) => item.items.length) && (
            <section className="nd-radar-analysis">
              <div className="nd-section-heading">
                <div>
                  <p className="nd-kicker">第二步 · 明确调用 AI</p>
                  <h2>分析已选的 {selectedItems.length} 条作品</h2>
                  <p>
                    未勾选的数据不会进入分析；扫描和 AI 分析是两次独立运行。
                  </p>
                </div>
                <button
                  className="nd-button nd-button-primary"
                  disabled={
                    busy ||pending!==null||recoveryBlocked|| !selectedItems.length || Boolean(analysisRunning)
                  }
                  onClick={() => void beginAnalysis(false)}
                  type="button"
                >
                  {analysis?"按当前选择新建 AI 分析":"开始 AI 分析"}
                </button>
                {analysis&&<button className="nd-button nd-button-secondary" type="button" disabled={busy||pending!==null||recoveryBlocked||Boolean(analysisRunning)||!marketAnalysisMatchesSelection(analysis,scan,selectedItems,focus,budget)} onClick={()=>void beginAnalysis(true)}>明确重跑原输入（新增版本）</button>}
              </div>
              <div className="nd-radar-analysis-controls">
                <label className="nd-control">
                  <span>这次重点看什么</span>
                  <input
                    disabled={busy||pending!==null||recoveryBlocked}
                    value={focus}
                    onChange={(event) => setFocus(event.target.value)}
                  />
                </label>
                <label className="nd-control">
                  <span>最大输出预算</span>
                  <select
                    disabled={busy||pending!==null||recoveryBlocked}
                    value={budget}
                    onChange={(event) => setBudget(Number(event.target.value))}
                  >
                    <option value={3000}>快速 · 3,000 tokens</option>
                    <option value={5000}>标准 · 5,000 tokens</option>
                    <option value={8000}>完整 · 8,000 tokens</option>
                  </select>
                </label>
              </div>
              {analysis && (
                <div className="nd-analysis-output">
                  <div className="nd-radar-run-head">
                    <div>
                      <h3>{statusLabel[analysis.currentVersion.runStatus]}</h3>
                      <p>
                        {analysis.currentVersion.lastError ||
                          `已使用 ${analysis.currentVersion.usedTokens} tokens`}
                      </p>
                    </div>
                    {analysisRunning && (
                      <button
                        className="nd-button nd-button-secondary"
                        disabled={busy||pending!==null||recoveryBlocked}
                        onClick={() => void cancel(analysis.currentVersion.id)}
                        type="button"
                      >
                        取消分析
                      </button>
                    )}
                  </div>
                  <progress
                    max="100"
                    value={analysis.currentVersion.progress}
                  />
                  {analysis.currentVersion.runStatus === "completed" && (
                    <>
                      <div className="nd-analysis-grid">
                        {analysisSections.map(([key, label]) => (
                          <article key={key}>
                            <strong>{label}</strong>
                            <p>
                              {(result?.[key] ?? []).join("、") ||
                                "没有足够证据"}
                            </p>
                          </article>
                        ))}
                      </div>
                      <aside>
                        <strong>证据边界</strong>
                        <p>{result?.evidenceBoundary}</p>
                      </aside>
                      <div className="nd-signal-candidates">
                        <div>
                          <p className="nd-kicker">待你确认</p>
                          <h3>市场信号候选</h3>
                        </div>
                        {analysis.candidates.filter(candidate=>candidate.researchVersionId===analysis.currentVersion.id).map((candidate) => (
                          <article key={candidate.id}>
                            <div>
                              <small>
                                {String(candidate.values.signal_type)}
                              </small>
                              <h4>{candidate.title}</h4>
                              <p>{String(candidate.values.summary ?? "")}</p>
                              <em>
                                来源：
                                {String(candidate.values.source_refs ?? "")}
                              </em>
                            </div>
                            <button
                              className="nd-button nd-button-secondary"
                              disabled={busy||pending!==null||recoveryBlocked || candidate.status !== "candidate"}
                              onClick={() => void adopt(candidate.id)}
                              type="button"
                            >
                              {candidate.status === "adopted"
                                ? "已保存"
                                  : "确认保存为资料"}
                            </button>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          )}
        {message && <p className="nd-message">{message}</p>}
      </main>
    </ResearchShell>
  );
}
