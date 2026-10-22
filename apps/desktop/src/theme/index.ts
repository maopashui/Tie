import { create } from "zustand";

export type Theme = "light" | "dark";
export type ThemePreference = "system" | Theme;

const STORAGE_KEY = "tie.theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === "system" ? systemTheme() : preference;
}

function readPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "system" || stored === "light" || stored === "dark") return stored;
  return "system";
}

export function applyDocumentTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  preference: ThemePreference;
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
}

export const useTheme = create<ThemeState>((set) => {
  const preference = readPreference();
  const theme = resolveTheme(preference);
  applyDocumentTheme(theme);
  return {
    preference,
    theme,
    setPreference: (next) => {
      localStorage.setItem(STORAGE_KEY, next);
      const resolved = resolveTheme(next);
      applyDocumentTheme(resolved);
      set({ preference: next, theme: resolved });
    },
  };
});

export function bootTheme() {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    const { preference } = useTheme.getState();
    if (preference !== "system") return;
    const resolved = resolveTheme("system");
    applyDocumentTheme(resolved);
    useTheme.setState({ theme: resolved });
  };
  media.addEventListener("change", onChange);
}
