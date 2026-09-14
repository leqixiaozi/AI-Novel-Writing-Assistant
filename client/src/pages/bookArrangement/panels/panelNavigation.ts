export type ArrangementPanel =
  | "book"
  | "relations"
  | "tracks"
  | "hooks"
  | "chapter"
  | "volume"
  | "controls"
  | "expression-point"
  | "planning"
  | "requirements"
  | "volume-preview"
  | null;

export interface ArrangementPanelLayers {
  base: ArrangementPanel;
  objectOpen: boolean;
}

export function openObjectLayer(current: ArrangementPanelLayers): ArrangementPanelLayers {
  return { ...current, objectOpen: true };
}

export function closeObjectLayer(current: ArrangementPanelLayers): ArrangementPanelLayers {
  return { ...current, objectOpen: false };
}

export function closeBaseLayer(current: ArrangementPanelLayers): ArrangementPanelLayers {
  return { ...current, base: null };
}

export function panelScopeLabel(panel: ArrangementPanel, chapterOrder: number, selectedChapterCount: number): string {
  if (panel === "book" || panel === "relations" || panel === "hooks" || panel === "tracks") return "全书";
  if (panel === "expression-point") return "单个场景";
  if (panel === "volume" || panel === "volume-preview") return "卷段";
  if ((panel === "planning" || panel === "requirements" || panel === "controls") && selectedChapterCount > 1) return `批量 · ${selectedChapterCount} 章`;
  return `第 ${chapterOrder} 章`;
}
