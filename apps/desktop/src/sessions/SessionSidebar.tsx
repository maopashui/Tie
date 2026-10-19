import { FolderPlus, Pencil, Search, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Folder, Session } from "../api/types";
import { useT } from "../i18n";

export function SessionSidebar({
  folders,
  sessions,
  connectedSessionIds,
  lockedLocalSubtypes,
  search,
  onSearch,
  onOpen,
  onCreateFolder,
  onEditFolder,
  onDeleteFolder,
  onEdit,
  onDelete,
}: {
  folders: Folder[];
  sessions: Session[];
  connectedSessionIds: string[];
  lockedLocalSubtypes: string[];
  search: string;
  onSearch: (value: string) => void;
  onOpen: (session: Session) => void;
  onCreateFolder: () => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onEdit: (session: Session) => void;
  onDelete: (session: Session) => void;
}) {
  const t = useT();
  const connected = new Set(connectedSessionIds);
  const query = search.trim().toLowerCase();
  const visible = sessions.filter((session) => {
    if (!query) return true;
    return [session.name, session.host, session.username].some((value) =>
      (value ?? "").toLowerCase().includes(query),
    );
  });
  const roots = folders.filter((folder) => !folder.parent_id);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-tie-border bg-tie-surface">
      <div className="border-b border-tie-border bg-white p-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-800">{t("sessionManager")}</span>
          <div className="flex text-slate-500">
            <IconButton title={t("newFolder")} onClick={onCreateFolder}>
              <FolderPlus size={14} />
            </IconButton>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1.5 text-slate-400" size={12} />
          <input
            className="w-full rounded border border-slate-200 bg-tie-surface py-1 pl-7 pr-2 text-[11px] outline-none focus:border-slate-400"
            placeholder={t("searchSessions")}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-auto py-1 text-[11px]">
        {roots.map((folder) => (
          <FolderBlock
            key={folder.id}
            folder={folder}
            sessions={sessionsInFolder(folder, visible)}
            connected={connected}
            lockedLocalSubtypes={lockedLocalSubtypes}
            onOpen={onOpen}
            onEditFolder={onEditFolder}
            onDeleteFolder={onDeleteFolder}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
        <FolderBlock
          folder={{ id: "none", name: t("ungrouped"), parent_id: null, sort: 0, system_key: "fixed" }}
          sessions={visible.filter((session) => !session.folder_id)}
          connected={connected}
          lockedLocalSubtypes={lockedLocalSubtypes}
          onOpen={onOpen}
          onEditFolder={onEditFolder}
          onDeleteFolder={onDeleteFolder}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </aside>
  );
}

const LOCAL_ORDER = ["default_shell", "powershell", "wsl"];

function sessionsInFolder(folder: Folder, sessions: Session[]) {
  const matched = sessions.filter((session) => session.folder_id === folder.id);
  if (folder.system_key !== "local") return matched;
  return matched
    .filter((session) => session.kind === "local")
    .sort((a, b) => {
      const left = LOCAL_ORDER.indexOf(a.local_subtype ?? "");
      const right = LOCAL_ORDER.indexOf(b.local_subtype ?? "");
      return left - right;
    });
}

function FolderBlock({
  folder,
  sessions,
  connected,
  lockedLocalSubtypes,
  onOpen,
  onEditFolder,
  onDeleteFolder,
  onEdit,
  onDelete,
}: {
  folder: Folder;
  sessions: Session[];
  connected: Set<string>;
  lockedLocalSubtypes: string[];
  onOpen: (session: Session) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onEdit: (session: Session) => void;
  onDelete: (session: Session) => void;
}) {
  const t = useT();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmFolder, setConfirmFolder] = useState(false);
  const editable = folder.system_key == null;
  if (sessions.length === 0 && folder.id === "none") return null;
  return (
    <div className="px-2 py-1">
      <div className="group/folder mb-0.5 flex items-center justify-between">
        <span className="min-w-0 truncate font-medium text-slate-500">{folderLabel(folder, t)}</span>
        {editable && confirmFolder ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              className="rounded bg-red-600 px-1.5 py-0.5 text-white"
              type="button"
              onClick={() => {
                setConfirmFolder(false);
                onDeleteFolder(folder);
              }}
            >
              {t("confirm")}
            </button>
            <button className="px-1 text-slate-500" type="button" onClick={() => setConfirmFolder(false)}>
              {t("cancel")}
            </button>
          </span>
        ) : null}
        {editable && !confirmFolder ? (
          <span className="flex shrink-0 items-center gap-1 opacity-0 group-hover/folder:opacity-100">
            <button
              className="text-slate-400 hover:text-slate-900"
              title={t("editFolder")}
              type="button"
              onClick={() => onEditFolder(folder)}
            >
              <Pencil size={12} />
            </button>
            <button
              className="text-slate-400 hover:text-red-600"
              title={t("deleteGroupHint")}
              type="button"
              onClick={() => setConfirmFolder(true)}
            >
              <Trash2 size={12} />
            </button>
          </span>
        ) : null}
      </div>
      {sessions.map((session) => {
        const local = session.kind !== "ssh";
        const locked = local && lockedLocalSubtypes.includes(session.local_subtype ?? "");
        return (
          <div
            key={session.id}
            className={`group flex items-center justify-between rounded px-1.5 py-1 ${locked ? "" : "hover:bg-slate-200/60"}`}
          >
            <button
              className={`flex min-w-0 flex-1 items-center text-left ${locked ? "cursor-not-allowed text-slate-400" : "text-slate-700"}`}
              disabled={locked}
              title={
                locked
                  ? t("macosLocalOnly")
                  : local
                    ? t("openLocal")
                    : [session.name, session.host].filter(Boolean).join(" ")
              }
              onDoubleClick={() => {
                if (!locked) onOpen(session);
              }}
              type="button"
            >
              <span
                className={`mr-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${connected.has(session.id) ? "bg-emerald-500" : "bg-slate-400"}`}
              />
              <span className="truncate">{session.name}</span>
              {!local && session.host ? (
                <span className="ml-1.5 shrink-0 font-mono text-[10px] text-slate-400">{session.host}</span>
              ) : null}
            </button>
            {session.kind === "ssh" && pendingId === session.id ? (
              <span className="flex shrink-0 items-center gap-1">
                <button
                  className="rounded bg-red-600 px-1.5 py-0.5 text-white"
                  type="button"
                  onClick={() => {
                    setPendingId(null);
                    onDelete(session);
                  }}
                >
                  {t("confirm")}
                </button>
                <button className="px-1 text-slate-500" type="button" onClick={() => setPendingId(null)}>
                  {t("cancel")}
                </button>
              </span>
            ) : null}
            {session.kind === "ssh" && pendingId !== session.id ? (
              <span className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
                <button
                  className="text-slate-400 hover:text-slate-900"
                  title={t("editSession")}
                  type="button"
                  onClick={() => onEdit(session)}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="text-slate-400 hover:text-red-600"
                  title={t("deleteSession")}
                  type="button"
                  onClick={() => setPendingId(session.id)}
                >
                  <Trash2 size={12} />
                </button>
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function folderLabel(folder: Folder, translate: ReturnType<typeof useT>) {
  if (folder.system_key === "local") return translate("localSessions");
  if (folder.id === "none") return translate("ungrouped");
  return folder.name;
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className="rounded p-0.5 hover:bg-slate-100 hover:text-slate-900" title={title} onClick={onClick} type="button">
      {children}
    </button>
  );
}
