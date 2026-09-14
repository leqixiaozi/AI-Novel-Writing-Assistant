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
