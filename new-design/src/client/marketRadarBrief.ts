import type { ResearchRecordDetail } from "../common/contracts";

export type MarketInfluenceMode = "follow_hot" | "differentiate" | "light";
export const marketInfluenceLabels: Record<MarketInfluenceMode, string> = {
  follow_hot: "跟随热门",
  differentiate: "热门中求差异",
  light: "弱化市场",
};

export interface MarketBriefSelection {
  recordId: string;
  versionId: string;
  candidateIds: string[];
  influenceMode: MarketInfluenceMode;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readMarketBriefSelection(search: string): MarketBriefSelection | null {
  const query = new URLSearchParams(search);
  if (!query.has("marketRecordId")) return null;
  const one = (key: string) => query.getAll(key).length === 1 ? query.get(key) : null;
  const recordId = one("marketRecordId");
  const versionId = one("marketVersionId");
  const rawIds = one("marketSignalIds");
  const influenceMode = one("marketInfluenceMode");
  const candidateIds = rawIds?.split(",") ?? [];
  if (!recordId || !uuid.test(recordId) || !versionId || !uuid.test(versionId) ||
    candidateIds.length < 1 || candidateIds.length > 5 ||
    candidateIds.some(id => !uuid.test(id)) || new Set(candidateIds).size !== candidateIds.length ||
    !influenceMode || !(influenceMode in marketInfluenceLabels)) {
    throw new Error("市场方向链接不完整，请从原分析页重新选择信号。");
  }
  return { recordId, versionId, candidateIds, influenceMode: influenceMode as MarketInfluenceMode };
}

export function marketBriefUrl(selection: MarketBriefSelection): string {
  const query = new URLSearchParams({
    method: "market",
    mode: "automatic",
    marketRecordId: selection.recordId,
    marketVersionId: selection.versionId,
    marketSignalIds: selection.candidateIds.join(","),
    marketInfluenceMode: selection.influenceMode,
  });
  return `/new-design/books/new?${query}`;
}

export function buildMarketBrief(record: ResearchRecordDetail, selection: MarketBriefSelection) {
  if (record.id !== selection.recordId || record.type !== "market_analysis") throw new Error("市场分析记录与所选来源不一致。");
  const version = record.versions.find(item => item.id === selection.versionId);
  if (!version || version.runStatus !== "completed") throw new Error("所选市场分析版本尚无完整报告。");
  const candidates = selection.candidateIds.map(id => record.candidates.find(item => item.id === id && item.researchVersionId === version.id && item.targetTypeKey === "market_signal"));
  if (candidates.some(item => !item)) throw new Error("所选市场信号不属于这份分析版本，请返回原页重新选择。");
  const lines = candidates.map((candidate, index) => {
    const values = candidate!.values;
    const text = (key: string) => typeof values[key] === "string" ? String(values[key]).trim() : "";
    return `${index + 1}. ${candidate!.title}\n判断：${text("summary") || "见原研究记录"}${text("audience") ? `\n读者：${text("audience")}` : ""}${text("differentiation") ? `\n差异化：${text("differentiation")}` : ""}`;
  });
  const boundary = version.structuredResult?.evidenceBoundary;
  return {
    sourceText: `市场方向：${marketInfluenceLabels[selection.influenceMode]}\n以下信号来自“${record.title}”第 ${version.version} 版，供开书审阅，不自动采用。\n\n${lines.join("\n\n")}${typeof boundary === "string" && boundary.trim() ? `\n\n证据边界：${boundary.trim()}` : ""}`,
    sourceReference: `${record.title} · 第 ${version.version} 版 · ${version.id}`,
    researchVersionId: version.id,
  };
}
