import { useEffect, useMemo, useState } from "react";
import type {
  BookAnalysisPlan,
  BookAnalysisPreset,
  BookAnalysisPurpose,
  BookAnalysisResult,
  BookSummary,
  CardSummary,
  CardTypeSummary,
  ResearchDocument,
  ResearchDocumentVersion,
  ResearchRecordDetail,
  ResearchRecordSummary,
} from "../common/contracts";
import { newDesignApi } from "./api";
import ResearchShell from "./ResearchShell";

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

export default function BookAnalysisPage() {
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
    [bookTypes, setBookTypes] = useState<CardTypeSummary[]>([]),
    [bookCards, setBookCards] = useState<CardSummary[]>([]),
    [mergeTargets, setMergeTargets] = useState<Record<string, string>>({}),
    [selectedCandidates, setSelectedCandidates] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
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
        setBookId(nextBooks[0]?.id ?? "");
        if (docs[0]) {
          setDocumentId(docs[0].id);
          setDocumentVersionId(docs[0].currentVersion.id);
          setEndOffset(docs[0].currentVersion.characterCount);
        }
        if (nextRecords[0])
          void newDesignApi
            .getResearchRecord(nextRecords[0].id)
            .then(setResult);
      })
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : "拆书页面加载失败。",
        ),
      );
  }, []);
  useEffect(() => {
    if (!documentId) return;
    void newDesignApi.listResearchDocumentVersions(documentId).then((items) => {
      setVersions(items);
      setDocumentVersionId((current) =>
        items.some((item) => item.id === current)
          ? current
          : (items[0]?.id ?? ""),
      );
      const selected =
        items.find((item) => item.id === documentVersionId) ?? items[0];
      if (selected) setEndOffset(selected.characterCount);
    });
  }, [documentId]);
  useEffect(() => {
    void newDesignApi
      .getBookAnalysisPlan(purpose, preset)
      .then(setPlan)
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : "分析计划读取失败。",
        ),
      );
  }, [purpose, preset]);
  useEffect(() => {
    const book = books.find((item) => item.id === bookId);
    if (!book) {
      setBookTypes([]);
      setBookCards([]);
      return;
    }
    void newDesignApi.listCardTypes(book.spaceId).then(async (types) => {
      const cards = (
        await Promise.all(
          types
            .filter((item) => item.currentVersionId)
            .map((item) =>
              newDesignApi.listCards(item.id, false, book.spaceId),
            ),
        )
      ).flat();
      setBookTypes(types);
      setBookCards(cards);
    });
  }, [bookId, books]);
  const running =
    result && ["queued", "running"].includes(result.currentVersion.runStatus);
  useEffect(() => {
    if (!running || !result) return;
    const timer = window.setInterval(
      () => void newDesignApi.getResearchRecord(result.id).then(setResult),
      1200,
    );
    return () => window.clearInterval(timer);
  }, [running, result?.id]);
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
  const begin = async () => {
    setBusy(true);
    setMessage("");
    try {
      const run = await newDesignApi.startBookAnalysis({
        documentVersionId,
        purpose,
        preset,
        rangeMode,
        startOffset: rangeMode === "range" ? startOffset : undefined,
        endOffset: rangeMode === "range" ? endOffset : undefined,
        focus,
        budgetTokens: budget,
      });
      setResult(await newDesignApi.getResearchRecord(run.recordId));
      await loadRecords();
      setMessage(
        "分析已开始；报告、证据和候选都会保存，候选不会自动写入书籍。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "拆书启动失败。");
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const run = await newDesignApi.retryBookAnalysis(result.id);
      setResult(await newDesignApi.getResearchRecord(run.recordId));
      setMessage(`已新增运行 v${run.version}，旧报告保持不变。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "拆书重试失败。");
    } finally {
      setBusy(false);
    }
  };
  const apply = async (
    decisions: Array<{
      candidateId: string;
      action:
        | "create_card"
        | "merge_card"
        | "save_resource"
        | "reference_only"
        | "ignore";
      targetSpaceId?: string;
      targetCardId?: string;
      expectedRevision?: number;
    }>,
  ) => {
    if (!result) return;
    setBusy(true);
    try {
      await newDesignApi.applyResearchCandidates(result.id, decisions);
      setResult(await newDesignApi.getResearchRecord(result.id));
      setSelectedCandidates([]);
      if (bookId) {
        const book = books.find((item) => item.id === bookId);
        if (book)
          setBookCards(
            (
              await Promise.all(
                bookTypes
                  .filter((item) => item.currentVersionId)
                  .map((item) =>
                    newDesignApi.listCards(item.id, false, book.spaceId),
                  ),
              )
            ).flat(),
          );
      }
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
  return (
    <ResearchShell active="analysis">
      <main className="nd-book-analysis">
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
                disabled={busy || !documentVersionId || Boolean(running)}
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
              onClick={() =>
                void newDesignApi.getResearchRecord(item.id).then(setResult)
              }
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
                          onChange={(event) => setBookId(event.target.value)}
                        >
                          <option value="">选择书籍</option>
                          {books.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="nd-candidate-batch">
                      <label>
                        <input
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
                          void apply(
                            selectedCandidates.map((candidateId) => ({
                              candidateId,
                              action: "create_card",
                              targetSpaceId: targetBook!.spaceId,
                            })),
                          )
                        }
                        type="button"
                      >
                        批量新建到本书
                      </button>
                    </div>
                    {currentCandidates.map((candidate) => {
                      const targetTypeId = bookTypes.find(
                          (item) => item.key === candidate.targetTypeKey,
                        )?.id,
                        targets = bookCards.filter(
                          (item) => item.cardTypeId === targetTypeId,
                        );
                      const mergeTarget = targets.find(
                        (item) => item.id === mergeTargets[candidate.id],
                      );
                      return (
                        <article
                          className={`nd-candidate-card is-${candidate.status}`}
                          key={candidate.id}
                        >
                          <label>
                            <input
                              checked={selectedCandidates.includes(
                                candidate.id,
                              )}
                              disabled={candidate.status !== "candidate"}
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
                              {candidate.targetTypeKey} ·{" "}
                              {candidate.confidence === null
                                ? "置信度未给出"
                                : `${Math.round(candidate.confidence * 100)}%`}
                            </span>
                            <h4>{candidate.title}</h4>
                            <dl>
                              {Object.entries(candidate.values).map(
                                ([key, value]) => (
                                  <div key={key}>
                                    <dt>{key}</dt>
                                    <dd>
                                      {Array.isArray(value)
                                        ? value.join("、")
                                        : String(value ?? "")}
                                    </dd>
                                  </div>
                                ),
                              )}
                            </dl>
                            <small>
                              {candidate.evidenceIds.length} 条证据 · 状态{" "}
                              {candidate.status}
                            </small>
                          </div>
                          {candidate.status === "candidate" && (
                            <aside>
                              <button
                                disabled={busy || !targetBook}
                                onClick={() =>
                                  targetBook &&
                                  void apply([
                                    {
                                      candidateId: candidate.id,
                                      action: "create_card",
                                      targetSpaceId: targetBook.spaceId,
                                    },
                                  ])
                                }
                                type="button"
                              >
                                新建到本书
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
                              <select
                                aria-label={`${candidate.title} 合并目标`}
                                value={mergeTargets[candidate.id] ?? ""}
                                onChange={(event) =>
                                  setMergeTargets((current) => ({
                                    ...current,
                                    [candidate.id]: event.target.value,
                                  }))
                                }
                              >
                                <option value="">选择同类资料合并</option>
                                {targets.map((item) => (
                                  <option value={item.id} key={item.id}>
                                    {item.title} · r{item.revision}
                                  </option>
                                ))}
                              </select>
                              <button
                                disabled={busy || !mergeTarget}
                                onClick={() =>
                                  mergeTarget &&
                                  void apply([
                                    {
                                      candidateId: candidate.id,
                                      action: "merge_card",
                                      targetCardId: mergeTarget.id,
                                      expectedRevision: mergeTarget.revision,
                                    },
                                  ])
                                }
                                type="button"
                              >
                                合并
                              </button>
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
                      );
                    })}
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
