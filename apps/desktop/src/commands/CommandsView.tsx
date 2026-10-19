import { useState } from "react";
import { useI18n, useT } from "../i18n";
import { commandCatalog, type LocalizedText } from "./catalog";

export function CommandsView() {
  const locale = useI18n((state) => state.locale);
  const t = useT();
  const [categoryId, setCategoryId] = useState(commandCatalog[0]?.id ?? "");
  const [copied, setCopied] = useState<string | null>(null);
  const label = (value: LocalizedText) => (locale === "en" ? value.en : value.zh);
  const category = commandCatalog.find((item) => item.id === categoryId) ?? commandCatalog[0];

  async function copyUsage(name: string, usage: string) {
    try {
      await navigator.clipboard.writeText(usage);
    } catch {
      return;
    }
    setCopied(name);
    window.setTimeout(() => {
      setCopied((current) => (current === name ? null : current));
    }, 1200);
  }

  if (!category) return null;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-36 shrink-0 overflow-auto border-r border-slate-200 bg-tie-subtle py-2">
        {commandCatalog.map((item) => (
          <button
            key={item.id}
            className={`block w-full px-3 py-1.5 text-left ${
              item.id === category.id ? "bg-white font-medium text-slate-900" : "text-slate-600 hover:bg-white"
            }`}
            onClick={() => setCategoryId(item.id)}
            type="button"
          >
            {label(item.title)}
          </button>
        ))}
      </aside>
      <div className="min-w-0 flex-1 overflow-auto p-4">
        <h2 className="mb-3 text-sm font-medium text-slate-800">{label(category.title)}</h2>
        <ul className="space-y-3">
          {category.commands.map((command) => (
            <li key={command.name} className="rounded border border-slate-200 bg-white">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-3 py-2">
                <div className="min-w-0">
                  <div className="font-mono text-[13px] font-semibold text-slate-900">{command.name}</div>
                  <p className="mt-0.5 text-slate-600">{label(command.summary)}</p>
                </div>
                <button
                  className="shrink-0 rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                  onClick={() => void copyUsage(command.name, command.usage)}
                  type="button"
                >
                  {copied === command.name ? t("copied") : t("copy")}
                </button>
              </div>
              <pre className="overflow-auto px-3 py-2 font-mono text-[11px] leading-5 text-slate-800">{command.usage}</pre>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
