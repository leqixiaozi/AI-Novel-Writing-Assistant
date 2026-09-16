export const THEMES = [
  { key: "system", label: "跟随系统" },
  { key: "default-light", label: "清爽浅色" },
  { key: "default-dark", label: "深蓝深色" },
  { key: "paper-light", label: "纸张浅色" },
  { key: "paper-dark", label: "纸张深色" },
  { key: "night-light", label: "夜读浅色" },
  { key: "night-dark", label: "夜读深色" },
] as const;
export type ThemeKey = (typeof THEMES)[number]["key"];
const storageKey = "new-design.independent-theme";

export function readTheme(): ThemeKey {
  try {
    const saved = localStorage.getItem(storageKey);
    if (THEMES.some(theme => theme.key === saved)) return saved as ThemeKey;
  } catch { /* Browser storage may be disabled; the system preference remains usable. */ }
  return "system";
}

export function applyTheme(key: ThemeKey): void {
  const dark = key === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : key.endsWith("-dark");
  const palette = key === "system" ? "default" : key.split("-")[0];
  document.documentElement.dataset.theme = palette;
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  try { localStorage.setItem(storageKey, key); } catch { /* Theme changes need not require persistent storage. */ }
}
