import type { ApiResponse } from "@ai-novel/shared/types/api";
import type { BookArrangementApplyReceipt, BookArrangementApplyRequest, BookArrangementDraftRecord, BookArrangementPreview, BookArrangementPreviewRequest, BookArrangementSaveDraftRequest, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { apiClient } from "./client";

export function createBookArrangementApi(novelId: string) {
  const base = `/novels/${encodeURIComponent(novelId)}/book-arrangement`;
  async function write<T>(method: "put" | "post", path: string, input: unknown, key: string): Promise<T> {
    const { data } = await apiClient.request<ApiResponse<T>>({ method, url: `${base}${path}`, data: input, timeout: 300000, headers: { "Idempotency-Key": key } });
    if (data.data == null) throw new Error(data.message || "未能确认操作结果，请重试。");
    return data.data;
  }
  return {
    async workspace(): Promise<BookArrangementWorkspace> {
      const { data } = await apiClient.get<ApiResponse<BookArrangementWorkspace>>(base);
      if (!data.data) throw new Error(data.message || "未能读取编排资料。");
      return data.data;
    },
    saveDraft: (input: BookArrangementSaveDraftRequest, key: string) => write<BookArrangementDraftRecord>("put", "/draft", input, key),
    preview: (input: BookArrangementPreviewRequest, key: string) => write<BookArrangementPreview>("post", "/preview", input, key),
    apply: (id: string, input: BookArrangementApplyRequest, key: string) => write<BookArrangementApplyReceipt>("post", `/${encodeURIComponent(id)}/apply`, input, key),
  };
}
