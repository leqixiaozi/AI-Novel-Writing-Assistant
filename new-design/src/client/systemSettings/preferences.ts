export type UiDensity = "comfortable" | "compact";

export interface UiPreferences {
  density: UiDensity;
  reduceMotion: boolean;
}

const STORAGE_KEY = "new-design:ui-preferences:v1";
const DEFAULTS: UiPreferences = { density: "comfortable", reduceMotion: false };

function normalize(value: unknown): UiPreferences {
  if (!value || typeof value !== "object") return DEFAULTS;
  const input = value as Partial<UiPreferences>;
  return {
    density: input.density === "compact" ? "compact" : "comfortable",
    reduceMotion: input.reduceMotion === true,
  };
}

export function loadUiPreferences(): UiPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function applyUiPreferences(value: UiPreferences): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.ndDensity = value.density;
  document.documentElement.dataset.ndMotion = value.reduceMotion ? "reduced" : "full";
}

export function saveUiPreferences(value: UiPreferences): boolean {
  applyUiPreferences(value);
  if (typeof window === "undefined") return true;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function applyStoredUiPreferences(): void {
  applyUiPreferences(loadUiPreferences());
}
