import { Folder } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  cancelTransfer,
  homeDir,
  listLocal,
  listTransferHistory,
  makeLocalDir,
  removeLocal,
  sftpList,
  sftpMkdir,
  sftpRemove,
  startDownload,
  startUpload,
} from "../api/commands";
import type { FileEntry } from "../api/types";
import { listSeparator, t as translate, useT } from "../i18n";
import { NameDialog } from "../sessions/ConnectDialog";
import { useWorkspace } from "../stores/workspace";

export function SftpView({ connectionId }: { connectionId: string }) {
  const t = useT();
  const setBanner = useWorkspace((state) => state.setBanner);
  const transfers = useWorkspace((state) => state.transfers);
  const history = useWorkspace((state) => state.history);
  const setHistory = useWorkspace((state) => state.setHistory);
  const [localPath, setLocalPath] = useState("");
  const [remotePath, setRemotePath] = useState("/");
  const [localEntries, setLocalEntries] = useState<FileEntry[]>([]);
  const [remoteEntries, setRemoteEntries] = useState<FileEntry[]>([]);
  const [localSelected, setLocalSelected] = useState<FileEntry | null>(null);
  const [remoteSelected, setRemoteSelected] = useState<FileEntry | null>(null);
  const [localChecked, setLocalChecked] = useState<Set<string>>(() => new Set());
  const [remoteChecked, setRemoteChecked] = useState<Set<string>>(() => new Set());
  const [activePane, setActivePane] = useState<"local" | "remote">("local");
  const [filter, setFilter] = useState("");
  const [hideLocalDot, setHideLocalDot] = useState(true);
  const [hideRemoteDot, setHideRemoteDot] = useState(true);
  const [tab, setTab] = useState<"running" | "done" | "failed">("running");
  const [namePrompt, setNamePrompt] = useState<"local" | "remote" | null>(null);
  const [replacePrompt, setReplacePrompt] = useState<{
    title: string;
    message: string;
    blocked: boolean;
    confirmLabel?: string;
    confirmDanger?: boolean;
    run: () => Promise<void>;
  } | null>(null);
  const finishedTransfers = useRef(new Set<string>());

  async function refreshLocal(path = localPath) {
    const entries = await listLocal(path);
    setLocalEntries(entries);
    setLocalPath(path);
    setLocalSelected(null);
    setLocalChecked(new Set());
  }

  async function refreshRemote(path = remotePath) {
    const entries = await sftpList(connectionId, path);
    setRemoteEntries(entries);
    setRemotePath(path);
    setRemoteSelected(null);
    setRemoteChecked(new Set());
  }

  useEffect(() => {
    void homeDir()
      .then((path) => refreshLocal(path))
      .catch((error: unknown) => setBanner(String(error)));
    void refreshRemote("/").catch((error: unknown) => setBanner(String(error)));
    void listTransferHistory().then(setHistory).catch((error: unknown) => setBanner(String(error)));
    // initial listing only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  useEffect(() => {
    void listTransferHistory().then(setHistory).catch(() => undefined);
    for (const item of transfers) {
      if (item.connection_id !== connectionId || item.status === "running") continue;
      if (finishedTransfers.current.has(item.id)) continue;
      finishedTransfers.current.add(item.id);
      if (item.status === "failed") {
        setBanner(item.error || t("transferFailed"));
      }
      if (item.status !== "completed") continue;
      const report = (error: unknown) => setBanner(error instanceof Error ? error.message : String(error));
      if (item.direction === "download") void refreshLocal(localPath).catch(report);
      if (item.direction === "upload") void refreshRemote(remotePath).catch(report);
    }
  }, [transfers, connectionId, localPath, remotePath, setBanner, setHistory]);

  function showError(error: unknown) {
    setBanner(error instanceof Error ? error.message : String(error));
  }

  async function upload() {
    const items = pickedEntries(localChecked, localEntries, localSelected);
    if (!items.length) {
      setBanner(t("pickLocalFile"));
      return;
    }
    // Folders: refuse if any remote entry with the same name already exists.
    // Files: refuse only when the remote name is a directory.
    const blockedDirs = items.filter(
      (item) => item.is_dir && remoteEntries.some((entry) => entry.name === item.name),
    );
    const blockedFiles = items.filter(
      (item) => !item.is_dir && remoteEntries.some((entry) => entry.name === item.name && entry.is_dir),
    );
    const blocked = [...blockedDirs, ...blockedFiles];
    const ready = items.filter((item) => !blocked.includes(item));
    if (!ready.length) {
      if (blockedDirs.length) {
        setBanner(t("remoteNameExists", { names: blockedDirs.map((item) => item.name).join(listSeparator()) }));
      } else {
        setBanner(t("remoteDirExists", { names: blockedFiles.map((item) => item.name).join(listSeparator()) }));
      }
      return;
    }
    const start = async () => {
      setTab("running");
      if (blocked.length) {
        setBanner(t("skippedConflicts", { names: blocked.map((item) => item.name).join(listSeparator()) }));
      }
      for (const item of ready) {
        const remote = joinRemote(remotePath, item.name);
        if (item.is_dir) {
          const plan = await collectDirUpload(item.path, remote);
          for (const step of plan) {
            if (step.kind === "mkdir") await sftpMkdir(connectionId, step.remote);
            else await startUpload(connectionId, step.local, step.remote);
          }
        } else {
          await startUpload(connectionId, item.path, remote);
        }
      }
    };
    const duplicates = ready.filter(
      (item) => !item.is_dir && remoteEntries.some((entry) => entry.name === item.name && !entry.is_dir),
    );
    if (!duplicates.length) {
      await start();
      return;
    }
    setReplacePrompt({
      title: t("sameName"),
      message: t("remoteExistsOverwrite", { names: duplicates.map((item) => item.name).join(listSeparator()) }),
      blocked: false,
      run: start,
    });
  }

  async function download() {
    if (!localPath) {
      setBanner(t("localDirNotReady"));
      return;
    }
    const files = pickedFiles(remoteChecked, remoteEntries, remoteSelected);
    if (!files.length) {
      setBanner(remoteChecked.size ? t("pickFilesNotDirs") : t("pickRemoteFile"));
      return;
    }
    const blocked = files.filter((file) => localEntries.some((entry) => entry.name === file.name && entry.is_dir));
    const ready = files.filter((file) => !blocked.includes(file));
    if (!ready.length) {
      setBanner(t("localDirExists", { names: blocked.map((file) => file.name).join(listSeparator()) }));
      return;
    }
    const start = async () => {
      setTab("running");
      if (blocked.length) setBanner(t("skippedDirs", { names: blocked.map((file) => file.name).join(listSeparator()) }));
      for (const file of ready) {
        await startDownload(connectionId, `${localPath.replace(/\/$/, "")}/${file.name}`, file.path);
      }
    };
    const duplicates = ready.filter((file) => localEntries.some((entry) => entry.name === file.name));
    if (!duplicates.length) {
      await start();
      return;
    }
    setReplacePrompt({
      title: t("sameName"),
      message: t("localExistsOverwrite", { names: duplicates.map((file) => file.name).join(listSeparator()) }),
      blocked: false,
      run: start,
    });
  }

  const visibleLocal = withParent(filterEntries(localEntries, filter, hideLocalDot), localPath, parentLocal(localPath));
  const visibleRemote = withParent(filterEntries(remoteEntries, filter, hideRemoteDot), remotePath, parentRemote(remotePath));

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "a" && event.key !== "A") return;
      if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (replacePrompt || namePrompt) return;
      event.preventDefault();
      const entries = (activePane === "remote" ? visibleRemote : visibleLocal).filter((entry) => entry.name !== "..");
      const paths = new Set(entries.map((entry) => entry.path));
      if (activePane === "remote") setRemoteChecked(paths);
      else setLocalChecked(paths);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePane, namePrompt, replacePrompt, visibleLocal, visibleRemote]);
  const running = transfers.filter((item) => item.status === "running");
  const done = history.filter((item) => item.status === "completed");
  const failed = history.filter((item) => item.status === "failed" || item.status === "cancelled");

  async function createFolder(side: "local" | "remote", rawName: string) {
    const name = rawName.trim();
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) {
      setBanner(t("invalidFolderName"));
      return;
    }
    if (side === "local") {
      if (!localPath) {
        setBanner(t("localDirNotReady"));
        return;
      }
      await makeLocalDir(`${localPath.replace(/\/$/, "")}/${name}`);
      await refreshLocal();
      return;
    }
    await sftpMkdir(connectionId, joinRemote(remotePath, name));
    await refreshRemote();
  }

  function deleteTargets(checked: Set<string>, entries: FileEntry[], selected: FileEntry | null) {
    const fromChecked = entries.filter((entry) => checked.has(entry.path) && entry.name !== "..");
    if (fromChecked.length) return fromChecked;
    if (selected && selected.name !== "..") return [selected];
    return [];
  }

  async function dirHasContents(side: "local" | "remote", dir: FileEntry) {
    const entries = side === "local" ? await listLocal(dir.path) : await sftpList(connectionId, dir.path);
    return entries.some((entry) => entry.name !== "." && entry.name !== "..");
  }

  function showConfirmStep(
    message: string,
    next: () => void | Promise<void>,
    options?: { confirmDanger?: boolean },
  ) {
    setReplacePrompt({
      title: t("delete"),
      message,
      blocked: false,
      confirmLabel: t("delete"),
      confirmDanger: options?.confirmDanger,
      run: async () => {
        await next();
      },
    });
  }

  async function confirmDelete(
    side: "local" | "remote",
    targets: FileEntry[],
    run: (items: FileEntry[]) => Promise<void>,
  ) {
    if (!targets.length) return;
    const dirs = targets.filter((item) => item.is_dir);
    let hasNonEmptyDir = false;
    for (const dir of dirs) {
      if (await dirHasContents(side, dir)) {
        hasNonEmptyDir = true;
        break;
      }
    }
    // files / empty dirs → 1 confirm; any non-empty dir → 2 (extra red confirm)
    const single = targets.length === 1;
    const firstMessage = single
      ? t(side === "local" ? "deleteLocalConfirm" : "deleteRemoteConfirm", { name: targets[0].name })
      : t(side === "local" ? "deleteLocalConfirmMany" : "deleteRemoteConfirmMany", {
          count: targets.length,
        });

    const finish = () => run(targets);
    if (!hasNonEmptyDir) {
      showConfirmStep(firstMessage, finish);
      return;
    }
    showConfirmStep(firstMessage, () => {
      showConfirmStep(t("deleteNonEmptyConfirm"), finish, { confirmDanger: true });
    });
  }

  const localDeleteTargets = deleteTargets(localChecked, localEntries, localSelected);
  const remoteDeleteTargets = deleteTargets(remoteChecked, remoteEntries, remoteSelected);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-tie-card">
      <div className="flex min-h-0 flex-1">
        <FileColumn
          label={t("local")}
          path={localPath}
          entries={visibleLocal}
          selected={localSelected}
          checked={localChecked}
          onActivate={() => setActivePane("local")}
          onToggle={(entry) => toggleChecked(setLocalChecked, entry.path)}
          onToggleAll={(paths) => setLocalChecked(new Set(paths))}
          onSelect={setLocalSelected}
          onOpen={(entry) => {
            if (entry.is_dir) void refreshLocal(entry.path).catch(showError);
          }}
          onUp={() => void refreshLocal(parentLocal(localPath)).catch(showError)}
          onRefresh={() => void refreshLocal().catch(showError)}
          dotsHidden={hideLocalDot}
          canToggleDot={hasDotEntries(localEntries)}
          onToggleDot={() => setHideLocalDot((value) => !value)}
          actionLabel={t("uploadToRemote")}
          onAction={() => void upload().catch(showError)}
          onMkdir={() => setNamePrompt("local")}
          onDelete={
            localDeleteTargets.length
              ? () => {
                  void confirmDelete("local", localDeleteTargets, async (items) => {
                    for (const item of items) {
                      await removeLocal(item.path, item.is_dir);
                    }
                    await refreshLocal();
                  }).catch(showError);
                }
              : undefined
          }
        />
        <div className="flex w-10 flex-col items-center justify-center gap-2 border-r border-tie-border bg-tie-surface">
          <button className="rounded border border-tie-border bg-tie-card px-2 py-1" title={t("upload")} onClick={() => void upload().catch(showError)} type="button">
            →
          </button>
          <button className="rounded border border-tie-border bg-tie-card px-2 py-1" title={t("download")} onClick={() => void download().catch(showError)} type="button">
            ←
          </button>
        </div>
        <FileColumn
          label={t("remote")}
          path={remotePath}
          entries={visibleRemote}
          selected={remoteSelected}
          checked={remoteChecked}
          onActivate={() => setActivePane("remote")}
          onToggle={(entry) => toggleChecked(setRemoteChecked, entry.path)}
          onToggleAll={(paths) => setRemoteChecked(new Set(paths))}
          onSelect={setRemoteSelected}
          onOpen={(entry) => {
            if (entry.is_dir) void refreshRemote(entry.path).catch(showError);
          }}
          onUp={() => void refreshRemote(parentRemote(remotePath)).catch(showError)}
          onRefresh={() => void refreshRemote().catch(showError)}
          dotsHidden={hideRemoteDot}
          canToggleDot={hasDotEntries(remoteEntries)}
          onToggleDot={() => setHideRemoteDot((value) => !value)}
          actionLabel={t("downloadSelected")}
          onAction={() => void download().catch(showError)}
          onMkdir={() => setNamePrompt("remote")}
          onDelete={
            remoteDeleteTargets.length
              ? () => {
                  void confirmDelete("remote", remoteDeleteTargets, async (items) => {
                    for (const item of items) {
                      await sftpRemove(connectionId, item.path, item.is_dir);
                    }
                    await refreshRemote();
                  }).catch(showError);
                }
              : undefined
          }
          remote
        />
      </div>
      <footer className="flex h-44 flex-col border-t border-tie-border">
        <div className="flex items-center justify-between border-b border-tie-border bg-tie-surface px-2 py-1">
          <div className="flex gap-1">
            <QueueTab active={tab === "running"} label={t("transferring", { count: running.length })} onClick={() => setTab("running")} />
            <QueueTab active={tab === "done"} label={t("completedCount", { count: done.length })} onClick={() => setTab("done")} />
            <QueueTab active={tab === "failed"} label={t("failedCancelled", { count: failed.length })} onClick={() => setTab("failed")} />
          </div>
          <div className="flex gap-1">
            <button className="rounded border border-tie-border px-2 py-0.5" disabled title={t("rateLimitHint")} type="button">
              {t("rateLimit")}
            </button>
            <button className="rounded border border-tie-border px-2 py-0.5" disabled title={t("pauseHint")} type="button">
              {t("pauseAll")}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-tie-card p-2">
          {tab === "running"
            ? running.map((item) => (
                <div key={item.id} className="mb-2 rounded border border-tie-border p-2">
                  <div className="flex items-center justify-between">
                    <span>
                      <b className="mr-2">{item.direction === "upload" ? t("upload") : t("download")}</b>
                      {item.name}
                    </span>
                    <span>
                      {formatSize(item.transferred)} / {formatSize(item.total)} · {formatSize(item.bytes_per_sec)}/s
                      <button className="ml-2" onClick={() => void cancelTransfer(item.id).catch(showError)} type="button">
                        {t("cancel")}
                      </button>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-tie-subtle">
                    <div
                      className="h-full rounded bg-emerald-500"
                      style={{ width: `${item.total ? Math.min(100, (item.transferred / item.total) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))
            : (tab === "done" ? done : failed).map((item) => (
                <div key={item.id} className="border-b border-tie-border py-1 font-mono">
                  {item.direction === "upload" ? t("upload") : t("download")} {transferRoute(item)} {transferStatus(item.status)}
                  {item.error ? ` ${item.error}` : ""}
                </div>
              ))}
        </div>
      </footer>
      <div className="border-t border-tie-border px-2 py-1">
        <input
          className="w-64 rounded border border-tie-border px-2 py-0.5"
          placeholder={t("filterDir")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      {namePrompt ? (
        <NameDialog
          title={namePrompt === "local" ? t("newLocalFolder") : t("newRemoteFolder")}
          onClose={() => setNamePrompt(null)}
          onSubmit={(name) => {
            const side = namePrompt;
            setNamePrompt(null);
            void createFolder(side, name).catch(showError);
          }}
        />
      ) : null}
      {replacePrompt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-tie-overlay">
          <div className="w-[360px] rounded border border-tie-border bg-tie-card p-3 shadow-lg">
            <div className="font-semibold text-tie-text">{replacePrompt.title}</div>
            <p className="mt-2 break-words text-tie-text">{replacePrompt.message}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button className="rounded border border-tie-border px-3 py-1" onClick={() => setReplacePrompt(null)} type="button">
                {replacePrompt.blocked ? t("gotIt") : t("cancel")}
              </button>
              {replacePrompt.blocked ? null : (
                <button
                  className={
                    replacePrompt.confirmDanger
                      ? "rounded border border-red-600 bg-tie-card px-3 py-1 font-semibold text-red-600"
                      : "rounded bg-tie-accent px-3 py-1 text-white"
                  }
                  onClick={() => {
                    const run = replacePrompt.run;
                    setReplacePrompt(null);
                    void run().catch(showError);
                  }}
                  type="button"
                >
                  {replacePrompt.confirmLabel ?? t("overwrite")}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FileColumn({
  label,
  path,
  entries,
  selected,
  checked,
  onActivate,
  onToggle,
  onToggleAll,
  onSelect,
  onOpen,
  onUp,
  onRefresh,
  dotsHidden,
  canToggleDot,
  onToggleDot,
  actionLabel,
  onAction,
  onMkdir,
  onDelete,
  remote,
}: {
  label: string;
  path: string;
  entries: FileEntry[];
  selected: FileEntry | null;
  checked: Set<string>;
  onActivate: () => void;
  onToggle: (entry: FileEntry) => void;
  onToggleAll: (paths: string[]) => void;
  onSelect: (entry: FileEntry) => void;
  onOpen: (entry: FileEntry) => void;
  onUp: () => void;
  onRefresh: () => void;
  dotsHidden: boolean;
  canToggleDot: boolean;
  onToggleDot: () => void;
  actionLabel: string;
  onAction: () => void;
  onMkdir: () => void;
  onDelete?: () => void;
  remote?: boolean;
}) {
  const t = useT();
  const selectable = entries.filter((entry) => entry.name !== "..");
  const selectedCount = selectable.filter((entry) => checked.has(entry.path)).length;
  const allChecked = selectable.length > 0 && selectedCount === selectable.length;
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-tie-border" onMouseDown={onActivate}>
      <div className="flex items-center gap-1 border-b border-tie-border bg-tie-surface px-2 py-1">
        <span className={`shrink-0 rounded px-1.5 py-0.5 font-bold ${remote ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-tie-hover"}`}>
          {label}
        </span>
        <button className="shrink-0" onClick={onUp} type="button">
          {t("parentDir")}
        </button>
        <button className="shrink-0" onClick={onRefresh} type="button">
          {t("refresh")}
        </button>
        <button
          className="shrink-0"
          disabled={!canToggleDot}
          title={canToggleDot ? undefined : t("noHidden")}
          onClick={onToggleDot}
          type="button"
        >
          {dotsHidden ? t("showHidden") : t("hideHidden")}
        </button>
        <span className="mx-1 h-3 w-px shrink-0 bg-tie-hover" aria-hidden="true" />
        <span className="min-w-0 truncate font-mono">{path}</span>
      </div>
      <div className="flex items-center justify-between border-b border-tie-border px-2 py-1">
        <button className="rounded bg-tie-accent px-2 py-0.5 text-white" onClick={onAction} type="button">
          {actionLabel}
        </button>
        <button onClick={onMkdir} type="button">
          {t("newFolderBtn")}
        </button>
        {onDelete ? (
          <button className="text-red-600" onClick={onDelete} type="button">
            {t("delete")}
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-left font-mono">
          <thead className="sticky top-0 bg-tie-surface">
            <tr>
              <th className="w-8 px-2 py-1">
                <input
                  aria-label={t("selectAll")}
                  checked={allChecked}
                  ref={(node) => {
                    if (node) node.indeterminate = selectedCount > 0 && !allChecked;
                  }}
                  type="checkbox"
                  onChange={() => onToggleAll(allChecked ? [] : selectable.map((entry) => entry.path))}
                />
              </th>
              <th className="px-2 py-1">{t("name")}</th>
              <th className="px-2 py-1">{t("size")}</th>
              <th className="px-2 py-1">{t("mtime")}</th>
              {remote ? <th className="px-2 py-1">{t("perms")}</th> : null}
              {remote ? <th className="px-2 py-1">{t("owner")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.path}
                className={checked.has(entry.path) || selected?.path === entry.path ? "bg-tie-subtle" : "hover:bg-tie-surface"}
                onClick={() => onSelect(entry)}
                onDoubleClick={() => onOpen(entry)}
              >
                <td className="px-2 py-0.5">
                  {entry.name === ".." ? null : (
                    <input
                      aria-label={t("selectItem", { name: entry.name })}
                      checked={checked.has(entry.path)}
                      type="checkbox"
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => onToggle(entry)}
                    />
                  )}
                </td>
                <td className="px-2 py-0.5">
                  {entry.is_dir ? <Folder className="mr-1 inline-block text-tie-muted" size={12} /> : null}
                  {entry.name}
                </td>
                <td className="px-2 py-0.5">{entry.is_dir ? "-" : formatSize(entry.size)}</td>
                <td className="whitespace-nowrap px-2 py-0.5">{entry.name === ".." ? "-" : formatMtime(entry.mtime)}</td>
                {remote ? <td className="px-2 py-0.5">{entry.permissions?.toString(8) ?? ""}</td> : null}
                {remote ? <td className="px-2 py-0.5">{entry.owner ?? ""}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-tie-border bg-tie-surface px-2 py-1 text-tie-muted">
        {t("itemCount", { count: entries.length })}
        {selectedCount ? t("checkedCount", { count: selectedCount }) : ""}
        {selected ? ` · ${selected.name}` : ""}
      </div>
    </section>
  );
}

function QueueTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`rounded px-2 py-0.5 ${active ? "border border-tie-border bg-tie-card font-semibold" : ""}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function toggleChecked(setChecked: (update: (current: Set<string>) => Set<string>) => void, path: string) {
  setChecked((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
}

function pickedEntries(checked: Set<string>, entries: FileEntry[], fallback: FileEntry | null) {
  if (checked.size > 0) {
    return entries.filter((entry) => checked.has(entry.path) && entry.name !== "..");
  }
  if (fallback && fallback.name !== "..") return [fallback];
  return [];
}

function pickedFiles(checked: Set<string>, entries: FileEntry[], fallback: FileEntry | null) {
  return pickedEntries(checked, entries, fallback).filter((entry) => !entry.is_dir);
}

type UploadStep =
  | { kind: "mkdir"; remote: string }
  | { kind: "file"; local: string; remote: string };

async function collectDirUpload(localDir: string, remoteDir: string): Promise<UploadStep[]> {
  const steps: UploadStep[] = [{ kind: "mkdir", remote: remoteDir }];
  const entries = await listLocal(localDir);
  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") continue;
    const remoteChild = joinRemote(remoteDir, entry.name);
    if (entry.is_dir) {
      steps.push(...(await collectDirUpload(entry.path, remoteChild)));
    } else {
      steps.push({ kind: "file", local: entry.path, remote: remoteChild });
    }
  }
  return steps;
}

function hasDotEntries(entries: FileEntry[]) {
  return entries.some((entry) => entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..");
}

function withParent(entries: FileEntry[], path: string, parent: string) {
  if (!path || path === "/" || parent === path) return entries;
  const up: FileEntry = {
    name: "..",
    path: parent,
    is_dir: true,
    size: 0,
    permissions: null,
    mtime: null,
    owner: null,
  };
  return [up, ...entries];
}

function filterEntries(entries: FileEntry[], filter: string, hideDot: boolean) {
  const query = filter.trim().toLowerCase();
  return entries.filter((entry) => {
    if (hideDot && entry.name.startsWith(".")) return false;
    if (!query) return true;
    return entry.name.toLowerCase().includes(query);
  });
}

function parentRemote(path: string) {
  if (path === "/") return "/";
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return `/${parts.join("/")}`;
}

function parentLocal(path: string) {
  const parts = path.split("/").filter((part, index) => part || index === 0);
  if (parts.length <= 1) return "/";
  parts.pop();
  const next = parts.join("/");
  return next.startsWith("/") ? next : `/${next}`;
}

function joinRemote(dir: string, name: string) {
  if (dir.endsWith("/")) return `${dir}${name}`;
  return `${dir}/${name}`;
}

function transferRoute(item: { direction: string; local_path: string; remote_path: string }) {
  if (item.direction === "download") return `${item.remote_path} → ${item.local_path}`;
  return `${item.local_path} → ${item.remote_path}`;
}

function transferStatus(status: string) {
  if (status === "completed") return translate("completed");
  if (status === "failed") return translate("failed");
  if (status === "cancelled") return translate("cancelled");
  return status;
}

function formatMtime(value: number | null) {
  if (value == null || value <= 0) return "-";
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return "-";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
