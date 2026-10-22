import { useEffect, useState } from "react";
import { homeDir, listLocal } from "../api/commands";
import type { FileEntry } from "../api/types";
import { useT } from "../i18n";
import { useWorkspace } from "../stores/workspace";

export function LogPathDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (path: string) => void;
}) {
  const t = useT();
  const setBanner = useWorkspace((state) => state.setBanner);
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [name, setName] = useState(defaultLogName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void homeDir()
      .then((path) => setDir(path))
      .catch((error: unknown) => setBanner(error instanceof Error ? error.message : String(error)));
  }, [setBanner]);

  useEffect(() => {
    if (!dir) return;
    let cancelled = false;
    setBusy(true);
    void listLocal(dir)
      .then((items) => {
        if (!cancelled) setEntries(items.filter((item) => item.is_dir && !item.name.startsWith(".")));
      })
      .catch((error: unknown) => {
        if (!cancelled) setBanner(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dir, setBanner]);

  function confirm() {
    const file = name.trim();
    if (!dir || !file || file.includes("/") || file.includes("\\") || file === "." || file === "..") {
      setBanner(t("invalidLogName"));
      return;
    }
    const path = dir.endsWith("/") ? `${dir}${file}` : `${dir}/${file}`;
    onConfirm(path);
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-tie-overlay">
      <form
        className="grid w-[460px] gap-2 rounded border border-tie-border bg-tie-card p-3 text-[11px] shadow-lg"
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold text-tie-text">{t("logPathTitle")}</span>
          <button className="text-tie-muted" onClick={onClose} type="button">
            {t("close")}
          </button>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-tie-muted">
          <span className="min-w-0 flex-1 truncate" title={dir}>
            {dir || t("locatingHome")}
          </span>
          <button
            className="shrink-0 rounded border border-tie-border px-2 py-0.5"
            disabled={!dir || dir === "/"}
            onClick={() => setDir(parentDir(dir))}
            type="button"
          >
            {t("parentDir")}
          </button>
        </div>
        <div className="h-40 overflow-auto rounded border border-tie-border bg-tie-surface">
          {busy ? <div className="px-2 py-1 text-tie-muted">{t("readingDir")}</div> : null}
          {!busy && entries.length === 0 ? <div className="px-2 py-1 text-tie-muted">{t("noSubdir")}</div> : null}
          {entries.map((entry) => (
            <button
              key={entry.path}
              className="block w-full truncate px-2 py-1 text-left font-mono hover:bg-tie-card"
              onClick={() => setDir(entry.path)}
              type="button"
            >
              {entry.name}
            </button>
          ))}
        </div>
        <label className="grid gap-1">
          <span className="text-tie-muted">{t("fileName")}</span>
          <input
            className="w-full rounded border border-tie-border bg-tie-surface px-2 py-1 font-mono outline-none focus:border-tie-accent"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className="text-[10px] text-tie-muted">{t("logSplitHint")}</p>
        <div className="flex justify-end gap-2">
          <button className="rounded border border-tie-border px-3 py-1" onClick={onClose} type="button">
            {t("cancel")}
          </button>
          <button className="rounded bg-tie-accent px-3 py-1 text-white" type="submit">
            {t("startRecording")}
          </button>
        </div>
      </form>
    </div>
  );
}

function parentDir(path: string) {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  if (slash <= 0) return "/";
  return trimmed.slice(0, slash);
}

function defaultLogName() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `tie-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.log`;
}
