import { create } from "zustand";
import { setLocale as setBackendLocale } from "../api/commands";
import { en } from "./en";
import { zh, type MessageKey } from "./zh";

export type Locale = "zh-CN" | "en";
export type LocalePreference = "system" | Locale;

const STORAGE_KEY = "tie.locale";

const catalogs = { "zh-CN": zh, en } as const;

const knownStatus: Record<string, MessageKey> = {};
for (const key of [
  "localConnected",
  "connecting",
  "commands",
  "commandReference",
  "sshConnected",
  "remoteClosed",
  "disconnected",
  "localExited",
  "localReadFailed",
  "localWriteFailed",
  "localNoSftp",
  "localNoForward",
  "statusConnected",
  "statusDisconnected",
] as const) {
  knownStatus[zh[key]] = key;
  knownStatus[en[key]] = key;
}

export function systemLocale(): Locale {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  return tags.some((tag) => tag.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}

export function resolveLocale(preference: LocalePreference): Locale {
  return preference === "system" ? systemLocale() : preference;
}

function readPreference(): LocalePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "system" || stored === "zh-CN" || stored === "en") return stored;
  return "system";
}

function applyDocumentLang(locale: Locale) {
  document.documentElement.lang = locale;
}

export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>) {
  const template = catalogs[locale][key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = vars[name];
    return value == null ? `{${name}}` : String(value);
  });
}

export function t(key: MessageKey, vars?: Record<string, string | number>) {
  return translate(useI18n.getState().locale, key, vars);
}

export function displayMessage(message: string) {
  const key = knownStatus[message];
  return key ? t(key) : message;
}

export function needsPassword(message: string) {
  return message.includes("需要密码") || message.includes("Password required");
}

export function listSeparator() {
  return useI18n.getState().locale === "en" ? ", " : "、";
}

interface I18nState {
  preference: LocalePreference;
  locale: Locale;
  setPreference: (preference: LocalePreference) => void;
}

export const useI18n = create<I18nState>((set) => {
  const preference = readPreference();
  const locale = resolveLocale(preference);
  applyDocumentLang(locale);
  return {
    preference,
    locale,
    setPreference: (next) => {
      localStorage.setItem(STORAGE_KEY, next);
      const resolved = resolveLocale(next);
      applyDocumentLang(resolved);
      set({ preference: next, locale: resolved });
      void setBackendLocale(resolved).catch(() => undefined);
    },
  };
});

export function useT() {
  const locale = useI18n((state) => state.locale);
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

export async function bootLocale() {
  const { locale } = useI18n.getState();
  try {
    await setBackendLocale(locale);
  } catch {
    // The webview can render before the Tauri bridge is ready.
  }
}
