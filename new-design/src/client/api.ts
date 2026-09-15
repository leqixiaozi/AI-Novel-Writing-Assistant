import type { ApiEnvelope, CardSummary, CardTypeSummary, CardTypeVersion, CardVersion } from "../common/contracts";

const API_ROOT = "/api/new-design";

export class ApiError extends Error {
  constructor(message: string, public readonly issues: Record<string, string> = {}) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const envelope = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !envelope.success || envelope.data === undefined) {
    throw new ApiError(envelope.error ?? "请求失败，请稍后重试。", envelope.issues);
  }
  return envelope.data;
}

export const newDesignApi = {
  health: () => request<{ mode: "bundled" | "external"; postgresVersion: string; port: number }>("/health"),
  listCardTypes: () => request<CardTypeSummary[]>("/card-types"),
  createCardType: (input: Pick<CardTypeSummary, "key" | "name" | "description" | "semanticCapabilities" | "draftFields">) => request<CardTypeSummary>("/card-types", {
    method: "POST",
    body: JSON.stringify({ key: input.key, name: input.name, description: input.description, semanticCapabilities: input.semanticCapabilities, fields: input.draftFields }),
  }),
  updateCardType: (input: CardTypeSummary) => request<CardTypeSummary>(`/card-types/${input.id}`, {
    method: "PATCH",
    body: JSON.stringify({ name: input.name, description: input.description, semanticCapabilities: input.semanticCapabilities, fields: input.draftFields, revision: input.revision }),
  }),
  publishCardType: (id: string, revision: number) => request<CardTypeSummary>(`/card-types/${id}/publish`, {
    method: "POST",
    body: JSON.stringify({ revision }),
  }),
  listCardTypeVersions: (id: string) => request<CardTypeVersion[]>(`/card-types/${id}/versions`),
  listCards: (cardTypeId: string, archived: boolean) => request<CardSummary[]>(`/cards?cardTypeId=${encodeURIComponent(cardTypeId)}&archived=${archived}`),
  createCard: (input: { cardTypeId: string; title: string; values: Record<string, unknown> }) => request<CardSummary>("/cards", {
    method: "POST", body: JSON.stringify(input),
  }),
  updateCard: (input: CardSummary) => request<CardSummary>(`/cards/${input.id}`, {
    method: "PATCH", body: JSON.stringify({ title: input.title, values: input.values, revision: input.revision }),
  }),
  archiveCard: (id: string, revision: number) => request<CardSummary>(`/cards/${id}/archive`, {
    method: "POST", body: JSON.stringify({ revision }),
  }),
  restoreCard: (id: string, revision: number) => request<CardSummary>(`/cards/${id}/restore`, {
    method: "POST", body: JSON.stringify({ revision }),
  }),
  listCardVersions: (id: string) => request<CardVersion[]>(`/cards/${id}/versions`),
};
