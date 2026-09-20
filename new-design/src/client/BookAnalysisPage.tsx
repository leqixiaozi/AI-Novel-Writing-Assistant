import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BookAnalysisPlan,
  BookAnalysisPreset,
  BookAnalysisPurpose,
  BookAnalysisResult,
  BookSummary,
  ResearchDocument,
  ResearchDocumentVersion,
  ResearchRecordDetail,
  ResearchRecordSummary,
  FieldDefinition,
} from "../common/contracts";
import { ApiError, newDesignApi } from "./api";
import ResearchShell from "./ResearchShell";
import { publishedProposalFields } from "../common/presentation";
import { researchCandidateValueLabel } from "../common/researchInputReview";

const STRATEGY_SPACE = "60000000-0000-4000-8000-000000000001";
const statusLabels = {
  queued: "等待开始",
  running: "分析中",
  completed: "已完成",
  partial: "部分完成",
  failed: "失败",
  cancelled: "已取消",
} as const;
const purposeLabels: Record<BookAnalysisPurpose, string> = {
  reference_learning: "参考学习",
  continuation: "续写整理",
  diagnosis: "稿件诊断",
};
const reusable = new Set([
  "genre_strategy",
  "progression_mode",
  "writing_config",
  "quality_rule",
]);
type AnalysisRequest={documentVersionId:string;purpose:BookAnalysisPurpose;preset:BookAnalysisPreset;rangeMode:"full"|"range";startOffset?:number;endOffset?:number;focus:string;budgetTokens:number;requestKey:string};
type PendingAnalysis={kind:"start";requestKey:string;input:AnalysisRequest;receipt?:{recordId:string;versionId:string};notWritten?:boolean}|{kind:"retry";requestKey:string;recordId:string;expectedVersionId:string;receipt?:{recordId:string;versionId:string};notWritten?:boolean};
const pendingKey="new-design:book-analysis:original-request",uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function readPending():PendingAnalysis|null{const raw=sessionStorage.getItem(pendingKey);if(!raw)return null;const value:unknown=JSON.parse(raw);if(!value||typeof value!=="object")throw new Error("原拆书请求凭证无法读取，禁止再次提交。");const item=value as Record<string,unknown>,receipt=item.receipt as Record<string,unknown>|undefined;
 if(typeof item.requestKey!=="string"||!uuid.test(item.requestKey)||receipt&&(!uuid.test(String(receipt.recordId))||!uuid.test(String(receipt.versionId))))throw new Error("原拆书请求凭证不完整，禁止再次提交。");
 if(item.kind==="retry"&&typeof item.recordId==="string"&&uuid.test(item.recordId)&&typeof item.expectedVersionId==="string"&&uuid.test(item.expectedVersionId))return item as unknown as PendingAnalysis;
 const input=item.input as Record<string,unknown>|undefined;
 if(item.kind==="start"&&input&&input.requestKey===item.requestKey&&typeof input.documentVersionId==="string"&&uuid.test(input.documentVersionId)&&["reference_learning","continuation","diagnosis"].includes(String(input.purpose))&&["quick","standard","full"].includes(String(input.preset))&&["full","range"].includes(String(input.rangeMode))&&typeof input.focus==="string"&&typeof input.budgetTokens==="number"&&Number.isInteger(input.budgetTokens)&&input.budgetTokens>=1000&&input.budgetTokens<=12000&&(input.rangeMode==="full"||typeof input.startOffset==="number"&&typeof input.endOffset==="number"&&Number.isInteger(input.startOffset)&&Number.isInteger(input.endOffset)&&input.endOffset>input.startOffset))return item as unknown as PendingAnalysis;
 throw new Error("原拆书冻结输入不完整，禁止再次提交。");}

export default function BookAnalysisPage() {
  const reportSequence=useRef(0),reportSource=useRef(""),resultRef=useRef<ResearchRecordDetail|null>(null),selectionRef=useRef<string[]>([]),savedSelections=useRef(new Map<string,string[]>());
  const runFlight=useRef(false),pendingRef=useRef<PendingAnalysis|null>(null),[pending,setPending]=useState<PendingAnalysis|null>(null),[recoveryReady,setRecoveryReady]=useState(false),[storageBlocked,setStorageBlocked]=useState(false);
  const [candidateSpecs,setCandidateSpecs]=useState<Map<string,{name:string;fields:FieldDefinition[]}>>(new Map()),[dictionaryLabels,setDictionaryLabels]=useState<Map<string,string>>(new Map()),[specNotice,setSpecNotice]=useState("");
  const [documents, setDocuments] = useState<ResearchDocument[]>([]),
    [documentId, setDocumentId] = useState(""),
    [versions, setVersions] = useState<ResearchDocumentVersion[]>([]),
    [documentVersionId, setDocumentVersionId] = useState("");
  const [purpose, setPurpose] =
      useState<BookAnalysisPurpose>("reference_learning"),
    [preset, setPreset] = useState<BookAnalysisPreset>("standard"),
    [rangeMode, setRangeMode] = useState<"full" | "range">("full"),
    [startOffset, setStartOffset] = useState(0),
    [endOffset, setEndOffset] = useState(0),
    [focus, setFocus] = useState(
      "拆解可迁移的仙侠长篇生产方法，不复制专有设定",
    ),
    [budget, setBudget] = useState(5000);
  const [plan, setPlan] = useState<BookAnalysisPlan | null>(null),
    [records, setRecords] = useState<ResearchRecordSummary[]>([]),
    [result, setResult] = useState<ResearchRecordDetail | null>(null),
    [books, setBooks] = useState<BookSummary[]>([]),
    [bookId, setBookId] = useState(""),
    [selectedCandidates, setSelectedCandidates] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  resultRef.current=result;selectionRef.current=selectedCandidates;
  useEffect(()=>{try{const previous=readPending();pendingRef.current=previous;setPending(previous);if(previous)setMessage("发现原拆书请求待核对；原输入与凭证保留，不能换新请求再次提交。");}catch(error){setStorageBlocked(true);setMessage(error instanceof Error?error.message:"原请求凭证无法读取，禁止再次提交。");}finally{setRecoveryReady(true);}},[]);
  useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(pending||storageBlocked){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[pending,storageBlocked]);
  const retainPending=(value:PendingAnalysis|null)=>{try{if(value)sessionStorage.setItem(pendingKey,JSON.stringify(value));else sessionStorage.removeItem(pendingKey);pendingRef.current=value;setPending(value);return true;}catch{setStorageBlocked(true);setMessage("原拆书凭证未能保留或清除；写入锁定，请保留本页并核对原研究记录。");return false;}};
  const acceptReport=(next:ResearchRecordDetail)=>{const previous=resultRef.current;if(previous?.id!==next.id||previous.currentVersion.id!==next.currentVersion.id){if(previous)savedSelections.current.set(`${previous.id}:${previous.currentVersion.id}`,[...selectionRef.current]);setSelectedCandidates([]);}else setSelectedCandidates(current=>current.filter(id=>next.candidates.some(candidate=>candidate.id===id&&candidate.researchVersionId===next.currentVersion.id&&candidate.status==="candidate")));resultRef.current=next;setResult(next);};
  const openReport=async(id:string)=>{if(busy)return;const sequence=++reportSequence.current;reportSource.current=id;setBusy(true);try{const next=await newDesignApi.getResearchRecord(id);if(sequence!==reportSequence.current||reportSource.current!==id)return;if(next.id!==id||!["book_analysis","diagnosis"].includes(next.type))throw new Error("原研究报告范围不匹配，原填写保留，不选择其他报告代替。");acceptReport(next);}catch(error){if(sequence===reportSequence.current)setMessage(error instanceof Error?error.message:"原研究报告读取失败，填写保留。");}finally{if(sequence===reportSequence.current)setBusy(false);}};
  const loadRecords = async () => {
    const [analysis, diagnosis] = await Promise.all([
      newDesignApi.listResearchRecords({ type: "book_analysis" }),
      newDesignApi.listResearchRecords({ type: "diagnosis" }),
    ]);
    const next = [...analysis, ...diagnosis].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    setRecords(next);
    return next;
  };
  useEffect(() => {
    void Promise.all([
      newDesignApi.listResearchDocuments(),
      newDesignApi.listBooks(),
      loadRecords(),
    ])
      .then(([docs, nextBooks, nextRecords]) => {
        setDocuments(docs);
        setBooks(nextBooks);
        if (docs[0]) {
          setDocumentId(docs[0].id);
          setDocumentVersionId(docs[0].currentVersion.id);
          setEndOffset(docs[0].currentVersion.characterCount);
        }
        if (nextRecords[0]&&!reportSource.current)void openReport(nextRecords[0].id);
      })
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : "拆书页面加载失败。",
        ),
      );
  }, []);
  useEffect(() => {
    let active=true;setVersions([]);if (!documentId) return;
    void newDesignApi.listResearchDocumentVersions(documentId).then((items) => {
      if(!active)return;
      setVersions(items);
      setDocumentVersionId((current) =>
        items.some((item) => item.id === current)
          ? current
          : (items[0]?.id ?? ""),
      );
      const selected =
        items.find((item) => item.id === documentVersionId) ?? items[0];
      if (selected) setEndOffset(selected.characterCount);
    }).catch(error=>{if(active)setMessage(error instanceof Error?error.message:"原文版本读取失败，填写保留。");});return()=>{active=false;};
  }, [documentId]);
  useEffect(() => {
    let active=true;
    void newDesignApi
      .getBookAnalysisPlan(purpose, preset)
      .then(value=>{if(active)setPlan(value);})
      .catch((error) =>
        active&&setMessage(
          error instanceof Error ? error.message : "分析计划读取失败。",
        ),
      );return()=>{active=false;};
  }, [purpose, preset]);
  const running =
    result && ["queued", "running"].includes(result.currentVersion.runStatus);
  useEffect(() => {
    if (!running || !result) return;
    let active=true;const id=result.id,versionId=result.currentVersion.id,sequence=reportSequence.current;
    const timer = window.setInterval(
      () => void newDesignApi.getResearchRecord(id).then(next=>{if(active&&sequence===reportSequence.current&&reportSource.current===id&&next.id===id){if(next.currentVersion.id!==versionId){setMessage("原报告已有新的运行版本，当前报告与勾选保留；请明确重新打开原报告核对。");return;}acceptReport(next);}}).catch(error=>{if(active&&sequence===reportSequence.current)setMessage(error instanceof Error?error.message:"原报告刷新失败，已读取内容保留。");}),
      1200,
    );
    return () => {active=false;window.clearInterval(timer);};
  }, [running, result?.id,result?.currentVersion.id]);
  useEffect(()=>{let active=true;setCandidateSpecs(new Map());setDictionaryLabels(new Map());setSpecNotice("正在核对当前已发布的中文内容规格…");void(async()=>{const book=bookId?await newDesignApi.getBook(bookId):null;const [local,shared]=await Promise.all([book?newDesignApi.listCardTypes(book.spaceId):Promise.resolve([]),newDesignApi.listCardTypes()]);const types=[...new Map([...shared,...local].filter(type=>type.status==="published").map(type=>[type.key,type])).values()],specs=new Map<string,{name:string;fields:FieldDefinition[]}>();for(const type of types){const fields=publishedProposalFields(type,await newDesignApi.listCardTypeVersions(type.id));if(fields)specs.set(type.key,{name:type.name,fields});}const dictionaryIds=[...new Set([...specs.values()].flatMap(spec=>spec.fields.flatMap(field=>field.optionSource?.kind==="dictionary_tree"?[field.optionSource.dictionaryId]:[])))],labels=new Map<string,string>();for(const id of dictionaryIds){const dictionary=await newDesignApi.getDictionary(id);if(dictionary.id!==id)throw new Error("字典来源不匹配，原候选保留。");for(const item of dictionary.items)labels.set(`${id}:${item.id}`,item.path.length?item.path.map(part=>part.label).join("／"):item.label);}if(active){setCandidateSpecs(specs);setDictionaryLabels(labels);setSpecNotice("中文标签读取当前已发布规格；原候选与原研究版本不被改写，正式采用仍需核对来源规格。");}})().catch(error=>{if(active)setSpecNotice(error instanceof Error?error.message:"中文内容规格未读取，原候选保留，不猜字段名称。");});return()=>{active=false;};},[bookId]);
  useEffect(() => {
    if (!result) return;
    setRecords((current) =>
      current.map((item) =>
        item.id === result.id
          ? {
              ...item,
              currentVersion: result.currentVersion,
              updatedAt: result.updatedAt,
            }
          : item,
      ),
    );
  }, [result?.currentVersion.runStatus, result?.currentVersion.progress]);
  const currentCandidates = useMemo(
    () =>
      result?.candidates.filter(
        (item) => item.researchVersionId === result.currentVersion.id,
      ) ?? [],
    [result],
  );
  const currentEvidence = useMemo(
    () =>
      result?.evidence.filter(
        (item) => item.researchVersionId === result.currentVersion.id,
      ) ?? [],
    [result],
  );
  const output = result?.currentVersion.structuredResult as
    | Partial<BookAnalysisResult>
    | undefined;
  const checkOriginal=async()=>{
    const pending=pendingRef.current;if(!pending||runFlight.current)return;runFlight.current=true;setBusy(true);
    try{const detail=await newDesignApi.getBookAnalysisByKey(pending.requestKey);
      if(!detail){setMessage(pending.notWritten?"服务器确认原提交未通过输入校验；可明确结束这份未写入请求，再修正输入。":"尚未读到原请求回执，不代表未执行；原输入保留，禁止换键重发。 ");return;}
      const version=detail.currentVersion,scope=version.sourceScope,plan=version.inputSnapshot.plan as Partial<BookAnalysisPlan>|undefined;
      const matched=pending.receipt?pending.receipt.recordId===detail.id&&pending.receipt.versionId===version.id:true;
      const start=pending.kind==="start"?pending.input:null;
      if(!matched||scope.requestKey!==pending.requestKey||start&&(scope.documentVersionId!==start.documentVersionId||scope.rangeMode!==start.rangeMode||start.rangeMode==="range"&&(scope.startOffset!==start.startOffset||scope.endOffset!==start.endOffset)||plan?.purpose!==start.purpose||plan?.preset!==start.preset||version.inputSnapshot.focus!==start.focus||version.budgetTokens!==start.budgetTokens)||pending.kind==="retry"&&(detail.id!==pending.recordId||version.parentVersionId!==pending.expectedVersionId))throw new Error("原拆书回执与冻结输入或原版本不一致；凭证保留，不采用其他报告代替。");
      reportSource.current=detail.id;++reportSequence.current;acceptReport(detail);
      if(!retainPending(null))return;
      setMessage("原拆书请求已按原凭证核对；只读取已保存的运行与报告，未再次调用模型。");
      void loadRecords().catch(()=>setMessage("原拆书请求已核对，研究列表暂未刷新；所选原报告保留。"));
    }catch(error){setMessage(error instanceof Error?error.message:"原拆书请求未能核对，凭证与输入保留。");}
    finally{runFlight.current=false;setBusy(false);}
  };
  const begin = async () => {
    if(runFlight.current||pendingRef.current||pending||storageBlocked||!recoveryReady)return;
    const input:AnalysisRequest={documentVersionId,purpose,preset,rangeMode,...(rangeMode==="range"?{startOffset,endOffset}:{}),focus:focus.trim(),budgetTokens:budget,requestKey:crypto.randomUUID()};
    const original:PendingAnalysis={kind:"start",requestKey:input.requestKey,input};if(!retainPending(original))return;
    runFlight.current=true;setBusy(true);let submitted=false;
    setMessage("");
    try {
      const run=await newDesignApi.startBookAnalysis(input);
      retainPending({...original,receipt:{recordId:run.recordId,versionId:run.versionId}});
      submitted=true;
      setMessage("拆书提交已返回原运行标识；请按原凭证核对已保存的报告，不重新提交。");
    } catch (error) {
      const notWritten=error instanceof ApiError&&error.status===422;
      if(notWritten)retainPending({...original,notWritten:true});
      setMessage(`${notWritten?"拆书输入未通过校验":"拆书提交结果未确认"}；原请求凭证与输入保留，请核对原请求，勿重复提交。${error instanceof Error?` ${error.message}`:""}`);
    } finally {
      runFlight.current=false;setBusy(false);if(submitted)void checkOriginal();
    }
  };
  const retry = async () => {
    if(!result||runFlight.current||pendingRef.current||pending||storageBlocked||!recoveryReady)return;
    const original:PendingAnalysis={kind:"retry",requestKey:crypto.randomUUID(),recordId:result.id,expectedVersionId:result.currentVersion.id};if(!retainPending(original))return;
    runFlight.current=true;setBusy(true);let submitted=false;
    try {
      const run=await newDesignApi.retryBookAnalysis(original.recordId,{requestKey:original.requestKey,expectedVersionId:original.expectedVersionId});
      retainPending({...original,receipt:{recordId:run.recordId,versionId:run.versionId}});
      submitted=true;
      setMessage(`原重跑请求返回 v${run.version} 标识；请只读核对原回执，旧报告保持不变。`);
    } catch (error) {
      const notWritten=error instanceof ApiError&&error.status===422;
      if(notWritten)retainPending({...original,notWritten:true});
      setMessage(`拆书重跑结果未确认；原请求与旧报告保留，请核对原凭证，勿重复提交。${error instanceof Error?` ${error.message}`:""}`);
    } finally {
      runFlight.current=false;setBusy(false);if(submitted)void checkOriginal();
    }
  };
  const apply = async (
    decisions: Array<{
      candidateId: string;
      action: "save_resource" | "reference_only" | "ignore";
      targetSpaceId?: string;
      targetCardId?: string;
      expectedRevision?: number;
    }>,
  ) => {
    if (!result||busy||decisions.some(decision=>!currentCandidates.some(candidate=>candidate.id===decision.candidateId&&candidate.status==="candidate"))) return;
    setBusy(true);
    try {
      await newDesignApi.applyResearchCandidates(result.id, decisions);
      const next=await newDesignApi.getResearchRecord(result.id);if(next.id!==result.id||next.currentVersion.id!==result.currentVersion.id)throw new Error("候选处理已提交，原报告版本需要核对；原候选保留，不改选其他版本。");acceptReport(next);
      setSelectedCandidates([]);
      setMessage(
        `已处理 ${decisions.length} 条候选，采用记录与来源版本已保存。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "候选处理失败。");
    } finally {
      setBusy(false);
    }
  };
  const targetBook = books.find((item) => item.id === bookId);
  const prepareBookAdoption = async (candidateIds: string[]) => {
    if (!result ||busy|| !targetBook || !candidateIds.length||candidateIds.some(id=>!currentCandidates.some(candidate=>candidate.id===id&&candidate.status==="candidate"))) return;
    setBusy(true);
    setMessage("");
    try {
      const batch = await newDesignApi.createBookResearchAdoptionPreview({
        bookId: targetBook.id,
        sourceKind: "research_version",
        sourceId: result.currentVersion.id,
        candidateIds,
        idempotencyKey: crypto.randomUUID(),
        createdBy: "user",
      });
      if(batch.bookId!==targetBook.id||batch.sourceId!==result.currentVersion.id)throw new Error("采用预览回执与原书籍或研究版本不一致，原勾选与填写保留，请核对原来源。");window.location.href = `/new-design/research/reference-packs?book=${targetBook.id}&adoption=${batch.id}`;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "本书采用预览生成失败。");
      setBusy(false);
    }
  };
  return (
    <ResearchShell active="analysis">
      <main className="nd-book-analysis">
        {storageBlocked&&<section className="nd-message is-error" role="alert"><p>原拆书凭证无法安全保留或读取；分析写入锁定。请保留网站存储，到研究记录核对原报告。</p><a href="/new-design/research/records">查看研究记录</a></section>}
        {pending&&<section className="nd-message" role="alert"><p>原{pending.kind==="retry"?"重跑":"拆书"}请求结果待核对；原请求 {pending.requestKey}。核对只读，不重新调用模型；未确认前不能换键提交。</p><button className="nd-button" type="button" disabled={busy} onClick={()=>void checkOriginal()}>只读核对原请求</button>{pending.notWritten&&<button className="nd-button" type="button" disabled={busy} onClick={()=>{if(window.confirm("原提交已被服务器拒绝且未写入。确认结束这份原请求，再修改输入？")){retainPending(null);setMessage("未写入的原请求已明确结束；可修正输入后重新发起。");}}}>结束未写入请求</button>}<a href="/new-design/research/records">查看原研究记录</a></section>}
        <section className="nd-analysis-setup">
          <div className="nd-section-heading">
            <div>
              <p className="nd-kicker">第一步 · 锁定来源与计划</p>
              <h2>选择要分析的真实文本版本</h2>
              <p>
                没有文本时先到“研究记录”粘贴或导入；每次运行都锁定这一版原文。
              </p>
            </div>
            <a
              className="nd-button nd-button-secondary"
              href="/new-design/research/records"
            >
              管理来源文本
            </a>
          </div>
          {documents.length ? (
            <>
              <div className="nd-form-grid">
                <label className="nd-control">
                  <span>来源资料</span>
                  <select
                    value={documentId}
                    onChange={(event) => setDocumentId(event.target.value)}
                  >
                    {documents.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="nd-control">
                  <span>不可变版本</span>
                  <select
                    value={documentVersionId}
                    onChange={(event) => {
                      setDocumentVersionId(event.target.value);
                      const version = versions.find(
                        (item) => item.id === event.target.value,
                      );
                      if (version) setEndOffset(version.characterCount);
                    }}
                  >
                    {versions.map((item) => (
                      <option value={item.id} key={item.id}>
                        v{item.version} · {item.characterCount.toLocaleString()}{" "}
                        字
                      </option>
                    ))}
                  </select>
                </label>
                <label className="nd-control">
                  <span>用途</span>
                  <select
                    value={purpose}
                    onChange={(event) =>
                      setPurpose(event.target.value as BookAnalysisPurpose)
                    }
                  >
                    <option value="reference_learning">
                      参考学习 · 只提炼抽象方法
                    </option>
                    <option value="continuation">
                      续写整理 · 可提取原文实体候选
                    </option>
                    <option value="diagnosis">稿件诊断 · 只给观察与建议</option>
                  </select>
                </label>
                <label className="nd-control">
                  <span>深度</span>
                  <select
                    value={preset}
                    onChange={(event) =>
                      setPreset(event.target.value as BookAnalysisPreset)
                    }
                  >
                    <option value="quick">快速 · 最多 1.2 万字</option>
                    <option value="standard">标准 · 最多 4 万字</option>
                    <option value="full">完整 · 最多 10 万字</option>
                  </select>
                </label>
              </div>
              <div className="nd-analysis-range">
                <label>
                  <input
                    checked={rangeMode === "full"}
                    name="range"
                    onChange={() => setRangeMode("full")}
                    type="radio"
                  />{" "}
                  全文
                </label>
                <label>
                  <input
                    checked={rangeMode === "range"}
                    name="range"
                    onChange={() => setRangeMode("range")}
                    type="radio"
                  />{" "}
                  指定字符范围
                </label>
                {rangeMode === "range" && (
                  <>
                    <input
                      aria-label="起始字符"
                      min={0}
                      type="number"
                      value={startOffset}
                      onChange={(event) =>
                        setStartOffset(Number(event.target.value))
                      }
                    />
                    <span>至</span>
                    <input
                      aria-label="结束字符"
                      min={1}
                      type="number"
                      value={endOffset}
                      onChange={(event) =>
                        setEndOffset(Number(event.target.value))
                      }
                    />
                  </>
                )}
              </div>
              <label className="nd-control">
                <span>这次重点</span>
                <textarea
                  rows={3}
                  value={focus}
                  onChange={(event) => setFocus(event.target.value)}
                />
              </label>
              <div className="nd-form-grid">
                <label className="nd-control">
                  <span>输出预算</span>
                  <select
                    value={budget}
                    onChange={(event) => setBudget(Number(event.target.value))}
                  >
                    <option value={3000}>3,000 tokens</option>
                    <option value={5000}>5,000 tokens</option>
                    <option value={8000}>8,000 tokens</option>
                    <option value={12000}>12,000 tokens</option>
                  </select>
                </label>
                <div className="nd-analysis-plan-summary">
                  <span>固定八维分析</span>
                  <b>{plan?.targets.length ?? 0} 种候选规格</b>
                  <small>
                    {plan?.candidateLimit ?? 0} 条上限 · 字段级证据必需
                  </small>
                </div>
              </div>
              {plan && (
                <details className="nd-analysis-plan">
                  <summary>查看本次分析计划</summary>
                  <p>
                    表单：
                    {plan.targetForms.map((item) => item.name).join("、") ||
                      "不生成组合表单"}
                  </p>
                  <div>
                    {plan.targets.map((item) => (
                      <span key={item.typeKey}>
                        <strong>{item.typeName}</strong>{" "}
                        {item.allowedFields.join(" · ")} ·{" "}
                        {item.mergePolicy === "reference_only"
                          ? "仅引用"
                          : "可新建或合并"}
                      </span>
                    ))}
                  </div>
                </details>
              )}
              <button
                className="nd-button nd-button-primary"
                disabled={busy || !documentVersionId || Boolean(running) || Boolean(pending) || storageBlocked || !recoveryReady}
                onClick={() => void begin()}
                type="button"
              >
                开始{purposeLabels[purpose]}
              </button>
            </>
          ) : (
            <div className="nd-empty">
              还没有可分析文本。先保存一份你有权使用的原文。
            </div>
          )}
        </section>
        <aside className="nd-analysis-history">
          <div className="nd-section-heading">
            <div>
              <p className="nd-kicker">历史</p>
              <h2>拆书与诊断</h2>
            </div>
            <b>{records.length}</b>
          </div>
          {records.map((item) => (
            <button
              className={result?.id === item.id ? "is-selected" : ""}
              key={item.id}
              disabled={busy}
              onClick={() => void openReport(item.id)}
              type="button"
            >
              <span>
                {
                  purposeLabels[
                    (
                      item.currentVersion.inputSnapshot.plan as
                        | BookAnalysisPlan
                        | undefined
                    )?.purpose ??
                      (item.type === "diagnosis"
                        ? "diagnosis"
                        : "reference_learning")
                  ]
                }
              </span>
              <strong>{item.title}</strong>
              <small>
                v{item.currentVersion.version} ·{" "}
                {statusLabels[item.currentVersion.runStatus]}
              </small>
            </button>
          ))}
        </aside>
        {result && (
          <section className="nd-analysis-result">
            <div className="nd-radar-run-head">
              <div>
                <p className="nd-kicker">
                  {result.type === "diagnosis" ? "稿件诊断" : "作品拆书"} · v
                  {result.currentVersion.version}
                </p>
                <h2>{statusLabels[result.currentVersion.runStatus]}</h2>
                <p>{result.currentVersion.lastError || result.title}</p>
              </div>
              <div>
                {running && (
                  <button
                    className="nd-button nd-button-secondary"
                    onClick={() =>
                      void newDesignApi.cancelResearchRun(
                        result.currentVersion.id,
                      )
                    }
                    type="button"
                  >
                    取消
                  </button>
                )}
                {!running && (
                  <button
                    className="nd-button nd-button-secondary"
                    onClick={() => void retry()}
                    disabled={busy || Boolean(pending) || storageBlocked || !recoveryReady}
                    type="button"
                  >
                    重跑为新版本
                  </button>
                )}
              </div>
            </div>
            <progress max="100" value={result.currentVersion.progress} />
            {result.currentVersion.runStatus === "completed" && (
              <>
                <article className="nd-analysis-overview">
                  <strong>整体判断</strong>
                  <p>{String(output?.overview ?? "")}</p>
                </article>
                <div className="nd-analysis-dimensions">
                  {(output?.dimensions ?? []).map((item) => (
                    <article key={item.key}>
                      <h3>{item.title}</h3>
                      <p>{item.summary}</p>
                      <dl>
                        <dt>优势</dt>
                        <dd>{item.strengths.join("；") || "无明确证据"}</dd>
                        <dt>风险</dt>
                        <dd>{item.risks.join("；") || "无明确证据"}</dd>
                        <dt>机会</dt>
                        <dd>{item.opportunities.join("；") || "无明确证据"}</dd>
                      </dl>
                    </article>
                  ))}
                </div>
                <div className="nd-evidence-list">
                  <div className="nd-section-heading">
                    <div>
                      <p className="nd-kicker">字段级证据</p>
                      <h3>{currentEvidence.length} 条可回溯片段</h3>
                    </div>
                  </div>
                  {currentEvidence.map((item) => (
                    <blockquote key={item.id}>
                      <span>
                        {item.certainty === "explicit"
                          ? "原文明确"
                          : item.certainty === "inferred"
                            ? "合理推断"
                            : "低置信度"}{" "}
                        · {item.fieldPath}
                      </span>
                      <p>“{item.excerpt}”</p>
                      <small>
                        {item.startOffset === null
                          ? "未精确定位"
                          : `字符 ${item.startOffset}—${item.endOffset}`}{" "}
                        {item.note}
                      </small>
                    </blockquote>
                  ))}
                </div>
                {currentCandidates.length > 0 && (
                  <div className="nd-candidate-workbench">
                    <div className="nd-section-heading">
                      <div>
                        <p className="nd-kicker">第二步 · 人工采用</p>
                        <h3>候选资料</h3>
                        <p>
                  系统会按内容规格校验；你只需要查看候选资料并决定是否采用。
                        </p>
                      </div>
                      <label className="nd-control">
                        <span>目标书籍</span>
                        <select
                          value={bookId}
                          disabled={busy}
                          onChange={(event) => setBookId(event.target.value)}
                        >
                          <option value="">选择书籍</option>
                          {bookId&&!books.some(item=>item.id===bookId)&&<option value={bookId} disabled>原书籍未读取，请核对目标</option>}
                          {books.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {result&&savedSelections.current.get(`${result.id}:${result.currentVersion.id}`)?.length?<p role="status">切换报告时已清除当前选择；此前原版本的勾选仍保留，不会套用到其他报告。<button type="button" className="nd-text-button" disabled={busy} onClick={()=>{const ids=savedSelections.current.get(`${result.id}:${result.currentVersion.id}`)??[];setSelectedCandidates(ids.filter(id=>currentCandidates.some(candidate=>candidate.id===id&&candidate.status==="candidate")));}}>明确恢复本报告原版本的勾选</button></p>:null}
                    <div className="nd-candidate-batch">
                      <label>
                        <input
                          disabled={busy}
                          checked={
                            selectedCandidates.length ===
                              currentCandidates.filter(
                                (item) => item.status === "candidate",
                              ).length && selectedCandidates.length > 0
                          }
                          onChange={(event) =>
                            setSelectedCandidates(
                              event.target.checked
                                ? currentCandidates
                                    .filter(
                                      (item) => item.status === "candidate",
                                    )
                                    .map((item) => item.id)
                                : [],
                            )
                          }
                          type="checkbox"
                        />{" "}
                        全选待处理
                      </label>
                      <button
                        className="nd-button nd-button-secondary"
                        disabled={
                          busy || !targetBook || !selectedCandidates.length
                        }
                        onClick={() =>
                          void prepareBookAdoption(selectedCandidates)
                        }
                        type="button"
                      >
                        生成本书采用预览
                      </button>
                    </div>
                    {currentCandidates.map((candidate) => (
                        <article
                          className={`nd-candidate-card is-${candidate.status}`}
                          key={candidate.id}
                        >
                          <label>
                            <input
                              checked={selectedCandidates.includes(
                                candidate.id,
                              )}
                              disabled={busy||candidate.status !== "candidate"}
                              onChange={(event) =>
                                setSelectedCandidates((current) =>
                                  event.target.checked
                                    ? [...current, candidate.id]
                                    : current.filter(
                                        (id) => id !== candidate.id,
                                      ),
                                )
                              }
                              type="checkbox"
                            />
                          </label>
                          <div>
                            <span>
                              {candidateSpecs.get(candidate.targetTypeKey)?.name??"未匹配已发布内容类型"} ·{" "}
                              {candidate.confidence === null
                                ? "置信度未给出"
                                : `${Math.round(candidate.confidence * 100)}%`}
                            </span>
                            <h4>{candidate.title}</h4>
                            <dl>
                              {Object.entries(candidate.values).map(
                                ([key, value]) => (
                                  <div key={key}>
                                    <dt>{candidateSpecs.get(candidate.targetTypeKey)?.fields.find(field=>field.key===key)?.name??"未匹配来源字段（原值保留）"}</dt>
                                    <dd>
                                      {researchCandidateValueLabel(candidateSpecs.get(candidate.targetTypeKey)?.fields.find(field=>field.key===key),value,dictionaryLabels)}
                                    </dd>
                                  </div>
                                ),
                              )}
                            </dl>
                            <small>
                              {candidate.evidenceIds.length} 条证据 · 状态{" "}
                              {{candidate:"待审阅",reference_only:"仅供参考",ignored:"已忽略",adopted:"已采用"}[candidate.status]}
                            </small>
                            <details><summary>核对原候选内容（只读）</summary><p>{specNotice}</p><pre>{JSON.stringify({type:candidate.targetTypeKey,values:candidate.values},null,2)}</pre></details>
                          </div>
                          {candidate.status === "candidate" && (
                            <aside>
                              <button
                                disabled={busy || !targetBook}
                                onClick={() => void prepareBookAdoption([candidate.id])}
                                type="button"
                              >
                                生成采用预览
                              </button>
                              {reusable.has(candidate.targetTypeKey) && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void apply([
                                      {
                                        candidateId: candidate.id,
                                        action: "save_resource",
                                        targetSpaceId: STRATEGY_SPACE,
                                      },
                                    ])
                                  }
                                  type="button"
                                >
                                  保存为方法资源
                                </button>
                              )}
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void apply([
                                    {
                                      candidateId: candidate.id,
                                      action: "reference_only",
                                    },
                                  ])
                                }
                                type="button"
                              >
                                仅作参考
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void apply([
                                    {
                                      candidateId: candidate.id,
                                      action: "ignore",
                                    },
                                  ])
                                }
                                type="button"
                              >
                                忽略
                              </button>
                            </aside>
                          )}
                        </article>
                    ))}
                  </div>
                )}
                <article className="nd-analysis-boundary">
                  <strong>使用边界</strong>
                  <p>{String(output?.copyrightBoundary ?? "")}</p>
                </article>
              </>
            )}
          </section>
        )}
        {message && <p className="nd-message">{message}</p>}
      </main>
    </ResearchShell>
  );
}
