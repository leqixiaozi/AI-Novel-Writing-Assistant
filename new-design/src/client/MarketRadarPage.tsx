import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MarketAnalysisResult,
  MarketSignalDraft,
  MarketSavedSignal,
  MarketScanDetail,
  MarketSourceDefinition,
  ResearchRecordDetail,
  ResearchRecordSummary,
} from "../common/contracts";
import { newDesignApi } from "./api";
import ResearchShell from "./ResearchShell";
import { marketAnalysisMatchesSelection } from "../common/researchInputReview";
import {marketBriefUrl,marketInfluenceLabels,type MarketInfluenceMode} from "./marketRadarBrief";

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
const signalTypeLabels: Record<MarketSignalDraft["signalType"], string> = {
  genre: "热门题材",
  protagonist: "主角身份",
  advantage: "金手指",
  opening: "开局爆点",
  relationship: "关系卖点",
  title: "标题句式",
  payoff: "读者回报",
  crowding: "拥挤套路",
  differentiation: "差异化机会",
};
const levelLabels: Record<MarketSignalDraft["heat"], string> = { low: "低", medium: "中", high: "高" };
const trendLabels: Record<MarketSignalDraft["trend"], string> = { rising: "正在升温", stable: "相对稳定", falling: "正在降温", uncertain: "证据不足" };
const labelFor = (labels: Record<string, string>, value: unknown, fallback: string) =>
  typeof value === "string" ? labels[value] ?? fallback : fallback;
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
    snapshot.items.map((item) => item.id),
  ).slice(0,80);
};

export default function MarketRadarPage() {
  const scopeSequence=useRef(0),writeFlight=useRef(false),initialScanStarted=useRef(false),analysisSelectionTouched=useRef(false),[pending,setPending]=useState<PendingAnalysis|null>(null),[recoveryBlocked,setRecoveryBlocked]=useState(false);
  const pendingRef=useRef<PendingAnalysis|null>(null);pendingRef.current=pending;
  const persistPending=(value:PendingAnalysis|null)=>{try{if(value)sessionStorage.setItem(recoveryKey,JSON.stringify(value));else sessionStorage.removeItem(recoveryKey);pendingRef.current=value;setPending(value);return true;}catch{setRecoveryBlocked(true);setMessage("原市场分析凭证无法安全保存，填写与此前报告保留；核对前不发起新的分析。");return false;}};
  const [sources, setSources] = useState<MarketSourceDefinition[]>([]),
    [sourceKeys, setSourceKeys] = useState<string[]>([]),
    [records, setRecords] = useState<ResearchRecordSummary[]>([]),
    [analysisRecords,setAnalysisRecords]=useState<ResearchRecordSummary[]>([]),
    [savedSignals,setSavedSignals]=useState<MarketSavedSignal[]>([]);
  const [scan, setScan] = useState<MarketScanDetail | null>(null),
    [selectedItems, setSelectedItems] = useState<string[]>([]),
    [analysis, setAnalysis] = useState<ResearchRecordDetail | null>(null),
    [selectedSignalIds,setSelectedSignalIds]=useState<string[]>([]),
    [viewTab,setViewTab]=useState<"rankings"|"analysis"|"saved">("rankings"),
    [influenceMode,setInfluenceMode]=useState<MarketInfluenceMode>("differentiate");
  const [initialLoaded,setInitialLoaded]=useState(false);
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
  const loadSaved=async()=>{const next=await newDesignApi.listSavedMarketSignals();setSavedSignals(next);return next;};
  useEffect(() => {
    let active=true;try{const original=readPendingAnalysis();pendingRef.current=original;setPending(original);}catch(error){setRecoveryBlocked(true);setMessage(error instanceof Error?error.message:"原分析凭证无法读取，不重新分析。");}
    void Promise.all([
      newDesignApi.listMarketSources(),
      loadRecords(),
      newDesignApi.listResearchRecords({ type: "market_analysis" }),
      newDesignApi.listSavedMarketSignals(),
    ])
      .then(([nextSources, nextRecords, analyses, saved]) => {
        if(!active)return;
        setSources(nextSources);
        setAnalysisRecords(analyses);
        setSavedSignals(saved);
        setInitialLoaded(true);
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
    if (!scan||scanRunning||analysisSelectionTouched.current)return;
    const available=new Set(scan.snapshots.flatMap(snapshot=>snapshot.items.map(item=>item.id)));
    const original=analysis?.currentVersion.sourceScope.scanVersionId===scan.version.id?analysis.currentVersion.sourceScope.itemIds:null;
    if(Array.isArray(original)&&original.length&&original.every(id=>typeof id==="string"&&available.has(id)))setSelectedItems(original as string[]);
    else if(!selectedItems.length)setSelectedItems(defaultAnalysisItems(scan));
  }, [scan?.version.id, scanRunning, analysis?.id,analysis?.currentVersion.id]);
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
  const sameAnalysisInput=Boolean(analysis&&scan&&marketAnalysisMatchesSelection(analysis,scan,selectedItems,focus,budget));
  const candidates=analysis?.candidates.filter(candidate=>candidate.researchVersionId===analysis.currentVersion.id&&candidate.targetTypeKey==="market_signal")??[];
  const savedByCandidate=new Map(savedSignals.map(signal=>[signal.candidateId,signal]));
  const rankingSnapshots=[...(scan?.snapshots??[])].sort((left,right)=>Number(isPrimaryList(right.listKey))-Number(isPrimaryList(left.listKey)));
  const selectedPlatforms=new Set(sources.filter(source=>sourceKeys.includes(`${source.platform}:${source.listKey}`)).map(source=>source.platform));
  useEffect(()=>{
    if(!analysis||!candidates.length)return;
    const recommended=[...candidates.filter(candidate=>candidate.values.signal_type==="differentiation"),...candidates.filter(candidate=>candidate.values.signal_type!=="differentiation")].slice(0,4).map(candidate=>candidate.id);
    setSelectedSignalIds(current=>current.some(id=>candidates.some(candidate=>candidate.id===id))?current:recommended);
  },[analysis?.id,analysis?.currentVersion.id,candidates.length]);
  const togglePlatform=(platform:string)=>{
    const keys=sources.filter(source=>source.platform===platform).map(source=>`${source.platform}:${source.listKey}`);
    const hasAny=keys.some(key=>sourceKeys.includes(key));
    if(hasAny&&selectedPlatforms.size===1)return;
    setSourceKeys(current=>hasAny?current.filter(key=>!keys.includes(key)):[...new Set([...current,...keys])]);
  };
  const toggleAnalysisItem=(id:string)=>{analysisSelectionTouched.current=true;setSelectedItems(current=>{if(current.includes(id))return current.filter(item=>item!==id);if(current.length>=80){setMessage("一次最多分析 80 本作品，请先取消部分选择。");return current;}return [...current,id];});};
  const toggleAnalysisList=(ids:string[])=>{analysisSelectionTouched.current=true;setSelectedItems(current=>{if(ids.every(id=>current.includes(id)))return current.filter(id=>!ids.includes(id));const next=[...new Set([...current,...ids])];if(next.length>80){setMessage("一次最多分析 80 本作品，请先取消部分选择。");return current;}return next;});};
  const toggleSignal=(id:string)=>setSelectedSignalIds(current=>{if(current.includes(id))return current.filter(item=>item!==id);if(current.length>=5){setMessage("最多选择 5 项市场信号。");return current;}return [...current,id];});
  const createFromSignals=(ids=selectedSignalIds,record=analysis,versionId=analysis?.currentVersion.id)=>{
    if(!record||!versionId||!ids.length)return;
    location.assign(marketBriefUrl({recordId:record.id,versionId,candidateIds:ids,influenceMode}));
  };
  const beginScan = async () => {
    if(writeFlight.current||pendingRef.current||recoveryBlocked)return;writeFlight.current=true;++scopeSequence.current;
    setBusy(true);
    setMessage("");
    try {
      const run = await newDesignApi.startMarketScan(sourceKeys);
      const detail = await newDesignApi.getMarketScan(run.recordId);
      setScan(detail);
      analysisSelectionTouched.current=false;setAnalysis(null);setSelectedItems([]);setViewTab("rankings");
      await loadRecords();
      setMessage("扫描已开始；只采集公开榜单元数据，不会调用 AI。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "扫描启动失败。");
    } finally {
      setBusy(false);
      writeFlight.current=false;
    }
  };
  useEffect(()=>{if(!initialLoaded||records.length||!sourceKeys.length||initialScanStarted.current||pendingRef.current||recoveryBlocked)return;initialScanStarted.current=true;void beginScan();},[initialLoaded,records.length,sourceKeys.join("|"),recoveryBlocked]);
  const openScan = async (id: string) => {
    if(writeFlight.current||pendingRef.current||recoveryBlocked)return;const sequence=++scopeSequence.current;
    setBusy(true);
    try {
      const detail=await newDesignApi.getMarketScan(id);if(sequence!==scopeSequence.current)return;if(detail.record.id!==id)throw new Error("原扫描来源不匹配，不能选择其他记录代替。");analysisSelectionTouched.current=false;setScan(detail);setAnalysis(null);setSelectedItems([]);setViewTab("rankings");
      const related=analysisRecords.find(item=>item.currentVersion.sourceScope.scanRecordId===id);
      if(related){const report=await newDesignApi.getResearchRecord(related.id);if(sequence===scopeSequence.current&&report.id===related.id&&report.currentVersion.sourceScope.scanRecordId===id)setAnalysis(report);}
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
      analysisSelectionTouched.current=false;setSelectedItems([]);setViewTab("rankings");
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
      setViewTab("analysis");
      void newDesignApi.listResearchRecords({type:"market_analysis"}).then(setAnalysisRecords).catch(()=>{});
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
    writeFlight.current=true;setBusy(true);
    try {
      const card = await newDesignApi.adoptMarketSignal(id);
      if (analysis)
        setAnalysis(await newDesignApi.getResearchRecord(analysis.id));
      await loadSaved();
      setMessage(`“${card.title}”已由你确认保存为市场信号资料。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "市场信号保存失败。");
    } finally {
      setBusy(false);
      writeFlight.current=false;
    }
  };
  const toggleSaved=async(candidateId:string)=>{
    const saved=savedByCandidate.get(candidateId);
    if(!saved){await adopt(candidateId);return;}
    if(writeFlight.current||pendingRef.current||recoveryBlocked)return;
    writeFlight.current=true;setBusy(true);
    try{
      if(saved.cardStatus==="active")await newDesignApi.archiveCard(saved.cardId,saved.cardRevision);
      else await newDesignApi.restoreCard(saved.cardId,saved.cardRevision);
      await loadSaved();
      setMessage(saved.cardStatus==="active"?"已取消收藏；市场信号资料保留在归档中。":"已恢复收藏的市场信号。");
    }catch(error){setMessage(error instanceof Error?error.message:"收藏状态调整失败。");}
    finally{writeFlight.current=false;setBusy(false);}
  };
  const createFromSaved=async(saved:MarketSavedSignal)=>{
    setBusy(true);
    try{
      const record=await newDesignApi.getResearchRecord(saved.researchRecordId);
      if(!record.versions.some(version=>version.id===saved.researchVersionId)||!record.candidates.some(candidate=>candidate.id===saved.candidateId&&candidate.researchVersionId===saved.researchVersionId))throw new Error("收藏题材的原分析版本无法核对，请从研究记录查看来源。");
      createFromSignals([saved.candidateId],record,saved.researchVersionId);
    }catch(error){setMessage(error instanceof Error?error.message:"收藏题材来源读取失败。");}
    finally{setBusy(false);}
  };
  return (
    <ResearchShell active="radar">
      <div className="nd-radar-page-head">
        <div className="nd-radar-platforms" aria-label="下次扫描的平台">
          {Object.entries(grouped).map(([platform,items])=><button key={platform} className={selectedPlatforms.has(items[0].platform)?"is-selected":""} aria-pressed={selectedPlatforms.has(items[0].platform)} type="button" disabled={busy||pending!==null||recoveryBlocked} onClick={()=>togglePlatform(items[0].platform)}>{platform}</button>)}
          <button className="nd-button nd-button-secondary" disabled={busy||pending!==null||recoveryBlocked||!sourceKeys.length||Boolean(scanRunning)} onClick={()=>void beginScan()} type="button">{scanRunning?`正在获取榜单 ${scan?.version.progress??0}%`:"重新扫榜"}</button>
        </div>
      </div>
      <nav className="nd-radar-tabs" aria-label="市场雷达内容">
        <button type="button" className={viewTab==="rankings"?"is-active":""} onClick={()=>setViewTab("rankings")}>当前榜单</button>
        <button type="button" className={viewTab==="analysis"?"is-active":""} disabled={!analysis} onClick={()=>setViewTab("analysis")}>AI 分析结果</button>
        <button type="button" className={viewTab==="saved"?"is-active":""} onClick={()=>setViewTab("saved")}>热门题材列表{savedSignals.filter(item=>item.cardStatus==="active").length?` · ${savedSignals.filter(item=>item.cardStatus==="active").length}`:""}</button>
      </nav>
      <main className="nd-market-radar">
        {(pending||recoveryBlocked)&&<div className="nd-message" role="alert"><p>原分析请求需要核对，填写、旧报告与原凭证保留；不能新建或重跑分析。</p>{pending&&<button className="nd-button nd-button-secondary" type="button" disabled={busy} onClick={()=>void checkAnalysis()}>只读核对原分析请求</button>}<a href="/new-design/research/records">打开原研究记录核对来源</a></div>}
        {viewTab==="rankings"&&<details className="nd-radar-source-panel">
          <summary>调整下次扫描的公开榜单 · 已选 {sourceKeys.length} 个</summary>
          <div className="nd-section-heading">
            <div>
              <h2>选择公开榜单</h2>
              <p>扫描只保存公开榜单元数据和来源时间，不调用 AI。</p>
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
        </details>}
        {viewTab==="rankings"&&<details className="nd-radar-history">
          <summary>扫描历史 · {records.length} 次</summary>
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
        </details>}
        {viewTab==="rankings"&&!scan&&<section className="nd-radar-empty"><h3>还没有可展示的榜单数据</h3><p>选择平台后开始扫描公开榜单，再勾选作品进行 AI 分析。</p><button className="nd-button nd-button-primary" type="button" disabled={busy||pending!==null||recoveryBlocked||!sourceKeys.length} onClick={()=>void beginScan()}>开始扫描</button></section>}
        {viewTab==="rankings"&&scan && (
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
            {scan.version.lastError&&scan.version.runStatus!=="failed"&&<p className="nd-message is-error">{scan.version.lastError}</p>}
            {scan.snapshots.some(snapshot=>snapshot.status==="failed")&&<p className="nd-message is-error">部分榜单无法读取，仍可使用成功采集的作品：{scan.snapshots.filter(snapshot=>snapshot.status==="failed").map(snapshot=>`${sources.find(source=>source.platform===snapshot.platform)?.platformLabel??snapshot.platform} · ${snapshot.listLabel}：${snapshot.error||"读取失败"}`).join("；")}</p>}
            {rankingSnapshots.length>0&&<div className="nd-radar-selection-bar"><p>{sameAnalysisInput?"本次报告使用当前勾选作品；调整选择后可新建分析。":`已选 ${selectedItems.length} 本作品，可在各榜单全选或逐本调整。`}</p><button className="nd-button nd-button-primary" disabled={busy||pending!==null||recoveryBlocked||Boolean(scanRunning)||Boolean(analysisRunning)||!selectedItems.length} onClick={()=>sameAnalysisInput?setViewTab("analysis"):void beginAnalysis(false)} type="button">{analysisRunning?`AI 分析中 ${analysis?.currentVersion.progress??0}%`:sameAnalysisInput?"查看 AI 分析":analysis?`按当前选择新建 AI 分析（${selectedItems.length} 本）`:`开始 AI 分析（${selectedItems.length} 本）`}</button></div>}
            <details className="nd-radar-advanced"><summary>本次分析重点与输出预算</summary><div className="nd-radar-analysis-controls"><label className="nd-control"><span>这次重点看什么</span><input disabled={busy||pending!==null||recoveryBlocked} value={focus} onChange={event=>setFocus(event.target.value)}/></label><label className="nd-control"><span>最大输出预算</span><select disabled={busy||pending!==null||recoveryBlocked} value={budget} onChange={event=>setBudget(Number(event.target.value))}><option value={3000}>快速 · 3,000 tokens</option><option value={5000}>标准 · 5,000 tokens</option><option value={8000}>完整 · 8,000 tokens</option></select></label></div></details>
            <div className="nd-radar-snapshots">
              {rankingSnapshots.map((snapshot) => (
                <article key={snapshot.id}>
                  <header><div><h3>{sources.find(source=>source.platform===snapshot.platform)?.platformLabel??snapshot.platform} · {snapshot.listLabel}</h3><small>本次识别 {snapshot.items.length} 条公开上榜记录</small></div><button type="button" disabled={busy||pending!==null||recoveryBlocked||Boolean(scanRunning)||Boolean(analysisRunning)||!snapshot.items.length} aria-pressed={snapshot.items.length>0&&snapshot.items.every(item=>selectedItems.includes(item.id))} onClick={()=>toggleAnalysisList(snapshot.items.map(item=>item.id))}>{snapshot.items.every(item=>selectedItems.includes(item.id))?"取消全选":"全选"}</button></header>
                  {snapshot.error && (
                    <p className="nd-message is-error">
                      {snapshot.error}；其他来源与既有记录不受影响。
                    </p>
                  )}
                  <div className="nd-radar-ranking-rows">
                    {snapshot.items.map((item) => (
                      <label key={item.id}>
                        <input
                          disabled={busy||pending!==null||recoveryBlocked||Boolean(analysisRunning)}
                          checked={selectedItems.includes(item.id)}
                          onChange={()=>toggleAnalysisItem(item.id)}
                          type="checkbox"
                        />
                        <span className="nd-rank">#{item.rank}</span>
                        <span>
                          <strong>{item.title}</strong>
                          <small>
                            {[item.author, item.category, item.heatLabel]
                              .filter(Boolean)
                              .join(" · ") || "公开榜单条目"}
                          </small>
                        </span>
                        <a href={item.sourceUrl} rel="noreferrer" target="_blank" aria-label={`查看${item.title}的公开来源`}>↗</a>
                      </label>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {viewTab==="analysis" && scan && analysis && (
            <section className="nd-radar-analysis">
              <div className="nd-section-heading">
                <div>
                  <h2>本期判断</h2>
                  <p>分析于 {new Date(analysis.currentVersion.createdAt).toLocaleString("zh-CN")}；结论可回看所选榜单来源。</p>
                </div>
                <button className="nd-button nd-button-secondary" type="button" disabled={busy||pending!==null||recoveryBlocked||Boolean(analysisRunning)||!marketAnalysisMatchesSelection(analysis,scan,selectedItems,focus,budget)} onClick={()=>void beginAnalysis(true)}>按原输入新增分析版本</button>
              </div>
              {analysis && (
                <div className="nd-analysis-output">
                  <div className="nd-radar-run-head">
                    <div>
                      <h3>{analysis.currentVersion.runStatus==="running"?"分析中":statusLabel[analysis.currentVersion.runStatus]}</h3>
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
                      <div className="nd-radar-summary"><p>{(result?.differentiationOpportunities??[]).slice(0,2).join("；")||(result?.genre??[]).slice(0,4).join("、")||"本次分析没有形成稳定判断，请核对来源和模型输出。"}</p><small>分析使用 {Array.isArray(analysis.currentVersion.sourceScope.itemIds)?analysis.currentVersion.sourceScope.itemIds.length:0} 本已选作品；市场信号可分别选择、收藏与用于开书。</small></div>
                      <details className="nd-radar-full-judgement"><summary>查看完整分析与证据边界</summary><div className="nd-analysis-grid">
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
                      </details>
                      <div className="nd-signal-candidates">
                        <div>
                          <h3>市场信号</h3>
                          <p>选出适合创作的方向；收藏的题材可在列表中继续使用。</p>
                        </div>
                        {candidates.map((candidate) => {const saved=savedByCandidate.get(candidate.id),selected=selectedSignalIds.includes(candidate.id);return <article className={selected?"is-selected":""} key={candidate.id}>
                          <div className="nd-signal-heading"><button className="nd-signal-select" type="button" aria-pressed={selected} onClick={()=>toggleSignal(candidate.id)}><small className="nd-signal-type">{labelFor(signalTypeLabels,candidate.values.signal_type,"市场信号")}</small><span className="nd-signal-selected">{selected?"已选":"选择"}</span><h4>{candidate.title}</h4><p>{String(candidate.values.summary??"")}</p><div className="nd-signal-meta"><span>热度 {labelFor(levelLabels,candidate.values.heat,"未标注")}</span><span>拥挤度 {labelFor(levelLabels,candidate.values.crowding,"未标注")}</span><span>{labelFor(trendLabels,candidate.values.trend,"趋势未标注")}</span></div></button><button className="nd-signal-favorite" type="button" disabled={busy||pending!==null||recoveryBlocked||(!saved&&candidate.status!=="candidate")} aria-label={`${saved?.cardStatus==="active"?"取消收藏":"收藏"}${candidate.title}`} onClick={()=>void toggleSaved(candidate.id)}>{saved?.cardStatus==="active"?"★":"☆"}</button></div>
                          <details className="nd-signal-source"><summary>查看来源证据</summary><p>{String(candidate.values.source_refs??"未提供来源")}</p></details>
                        </article>;})}
                      </div>
                      <div className="nd-radar-create-bar"><div><strong>已选 {selectedSignalIds.length}/5 项市场信号</strong><p>已为你勾选优先方向，可调整后进入开书表单。</p></div><div><select aria-label="市场方向取舍" value={influenceMode} onChange={event=>setInfluenceMode(event.target.value as MarketInfluenceMode)}>{Object.entries(marketInfluenceLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><button className="nd-button nd-button-primary" type="button" disabled={!selectedSignalIds.length} onClick={()=>createFromSignals()}>用这些信号创作 →</button></div></div>
                    </>
                  )}
                </div>
              )}
            </section>
          )}
        {viewTab==="saved"&&<section className="nd-radar-saved"><div className="nd-section-heading"><div><h2>热门题材列表</h2><p>收藏的市场信号保留来源和推荐理由，可继续用于开书。</p></div><span>{savedSignals.filter(item=>item.cardStatus==="active").length} 个</span></div>{savedSignals.some(item=>item.cardStatus==="active")?<div className="nd-radar-saved-grid">{savedSignals.filter(item=>item.cardStatus==="active").map(saved=><article key={saved.cardId}><div className="nd-radar-saved-head"><div><small className="nd-signal-type">{labelFor(signalTypeLabels,saved.values.signal_type,"市场信号")}</small><h3>{saved.title}</h3></div><button type="button" aria-label={`取消收藏${saved.title}`} disabled={busy||pending!==null||recoveryBlocked} onClick={()=>void toggleSaved(saved.candidateId)}>×</button></div><p>{String(saved.values.summary??"")}</p><div className="nd-signal-meta"><span>热度 {labelFor(levelLabels,saved.values.heat,"未标注")}</span><span>拥挤度 {labelFor(levelLabels,saved.values.crowding,"未标注")}</span></div><details className="nd-signal-source"><summary>查看来源证据</summary><p>{String(saved.values.source_refs??"未提供来源")}</p></details><div className="nd-radar-saved-actions"><small>收藏于 {new Date(saved.savedAt).toLocaleString("zh-CN")}</small><button className="nd-button nd-button-primary" type="button" disabled={busy} onClick={()=>void createFromSaved(saved)}>用此题材开书</button></div></article>)}</div>:<p className="nd-radar-empty">完成 AI 分析后，收藏认可的市场信号，它们会显示在这里。</p>}</section>}
        {message && <p className="nd-message">{message}</p>}
      </main>
    </ResearchShell>
  );
}
