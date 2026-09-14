import type { ApiResponse } from "@ai-novel/shared/types/api";
import type { BookArrangementApplyReceipt, BookArrangementApplyRequest, BookArrangementDraftRecord, BookArrangementPreview, BookArrangementPreviewRequest, BookArrangementSaveDraftRequest, BookArrangementWorkspace } from "@ai-novel/shared/types/bookArrangement";
import { apiClient } from "./client";
import type { BookArrangementVolumePreview, BookArrangementVolumePreviewRequest, BookArrangementVolumeApplyReceipt } from "@ai-novel/shared/types/bookArrangement";
import type { BookArrangementObjectApplyReceipt, BookArrangementObjectDetail, BookArrangementObjectKind, BookArrangementObjectPreview, BookArrangementObjectPreviewRequest } from "@ai-novel/shared/types/bookArrangement";
import type { BookArrangementSceneApplyReceipt, BookArrangementScenePreview, BookArrangementScenePreviewRequest } from "@ai-novel/shared/types/bookArrangement";
import type { SceneExpressionPointSaveReceipt, SceneExpressionPointSaveRequest, SceneExpressionTrackCatalog, SceneExpressionTrackCatalogSaveRequest } from "@ai-novel/shared/types/sceneExpressionTracks";

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
    async sceneExpressionDefinitions(): Promise<SceneExpressionTrackCatalog> {
      const { data } = await apiClient.get<ApiResponse<SceneExpressionTrackCatalog>>(`${base}/scene-expression-definitions`);
      if (!data.data) throw new Error(data.message || "未能读取场景表达字典。");
      return data.data;
    },
    saveSceneExpressionDefinitions: (input: SceneExpressionTrackCatalogSaveRequest, key: string) => write<SceneExpressionTrackCatalog>("put", "/scene-expression-definitions", input, key),
    saveDraft: (input: BookArrangementSaveDraftRequest, key: string) => write<BookArrangementDraftRecord>("put", "/draft", input, key),
    preview: (input: BookArrangementPreviewRequest, key: string) => write<BookArrangementPreview>("post", "/preview", input, key),
    apply: (id: string, input: BookArrangementApplyRequest, key: string) => write<BookArrangementApplyReceipt>("post", `/${encodeURIComponent(id)}/apply`, input, key),
    previewVolumes: (input: BookArrangementVolumePreviewRequest, key: string) => write<BookArrangementVolumePreview>("post", "/volumes/preview", input, key),
    applyVolumes: (id: string, key: string) => write<BookArrangementVolumeApplyReceipt>("post", `/volumes/${encodeURIComponent(id)}/apply`, {}, key),
    async object(kind: BookArrangementObjectKind, objectId: string, chapterId?: string): Promise<BookArrangementObjectDetail> {
      const { data } = await apiClient.get<ApiResponse<BookArrangementObjectDetail>>(`${base}/objects/${encodeURIComponent(kind)}/${encodeURIComponent(objectId || "new")}`, { params: chapterId ? { chapterId } : undefined });
      if (!data.data) throw new Error(data.message || "未能读取对象资料。");
      return data.data;
    },
    previewObject: (input: BookArrangementObjectPreviewRequest, key: string) => write<BookArrangementObjectPreview>("post", "/objects/preview", input, key),
    applyObject: (candidateId: string, key: string) => write<BookArrangementObjectApplyReceipt>("post", `/objects/${encodeURIComponent(candidateId)}/apply`, {}, key),
    previewScenes: (input: BookArrangementScenePreviewRequest, key: string) => write<BookArrangementScenePreview>("post", "/scenes/preview", input, key),
    applyScenes: (candidateId: string, key: string) => write<BookArrangementSceneApplyReceipt>("post", `/scenes/${encodeURIComponent(candidateId)}/apply`, {}, key),
    saveSceneExpressionPoints: (input: SceneExpressionPointSaveRequest, key: string) => write<SceneExpressionPointSaveReceipt>("put", "/scene-expression-points", input, key),
  };
}
