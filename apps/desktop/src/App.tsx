import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeftRight,
  FolderInput,
  Plus,
  Power,
  RefreshCw,
  ScrollText,
  Settings,
  SquareTerminal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { displayMessage, needsPassword, useT } from "./i18n";
import {
  createFolder,
  deleteFolder,
  deleteSession,
  updateFolder,
  disconnect,
  homeDir,
  listWorkspace,
  parseQuick,
  startEphemeralSsh,
  startLocal,
  startSsh,
} from "./api/commands";
import type { Folder, Session } from "./api/types";
import { ConnectDialog, NameDialog, SecretDialog } from "./sessions/ConnectDialog";
import { SessionSidebar } from "./sessions/SessionSidebar";
import { CommandsView } from "./commands/CommandsView";
import { PortForwardDrawer } from "./forward/PortForwardDrawer";
import { StatusBarForwards } from "./forward/StatusBarForwards";
import { SettingsDialog } from "./settings/SettingsDialog";
import { SftpView } from "./sftp/SftpView";
import { findSession, useWorkspace, type WorkspaceTab } from "./stores/workspace";
import { hasAuthFailure, resetAuthFailure } from "./terminal/authRetry";
import { HostKeyDialog } from "./terminal/HostKeyDialog";
import { LogPathDialog } from "./terminal/LogPathDialog";
import { startSessionLog, stopSessionLog, useSessionLog } from "./terminal/sessionLog";
import { TerminalView } from "./terminal/TerminalView";

const mac = navigator.userAgent.includes("Mac");
const lockedLocalSubtypes = mac ? ["powershell", "wsl"] : [];
let startupLocalStarted = false;
let lastCloseTabAt = 0;

function dismissTab(tab: WorkspaceTab) {
  if (tab.kind === "terminal") void stopSessionLog(tab.connectionId, "exit");
  const connectionId = useWorkspace.getState().closeTab(tab.id);
  if (connectionId && tab.status !== "disconnected") void disconnect(connectionId);
  const state = useWorkspace.getState();
  if (
    tab.sessionId &&
    state.ephemeral[tab.sessionId] &&
    !state.tabs.some((item) => item.sessionId === tab.sessionId)
  ) {
    state.dropEphemeral(tab.sessionId);
  }
}

function closeActiveTab() {
  const now = performance.now();
  if (now - lastCloseTabAt < 80) return;
  lastCloseTabAt = now;
  const state = useWorkspace.getState();
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (tab) dismissTab(tab);
}

export function App() {
  const t = useT();
  const folders = useWorkspace((state) => state.folders);
  const sessions = useWorkspace((state) => state.sessions);
  const search = useWorkspace((state) => state.search);
  const tabs = useWorkspace((state) => state.tabs);
  const activeTabId = useWorkspace((state) => state.activeTabId);
  const banner = useWorkspace((state) => state.banner);
  const notice = useWorkspace((state) => state.notice);
  const hostKey = useWorkspace((state) => state.hostKey);
  const authPrompt = useWorkspace((state) => state.authPrompt);
  const setAuthPrompt = useWorkspace((state) => state.setAuthPrompt);
  const cursor = useWorkspace((state) => state.cursor);
  const setSearch = useWorkspace((state) => state.setSearch);
  const setCatalog = useWorkspace((state) => state.setCatalog);
  const rememberEphemeral = useWorkspace((state) => state.rememberEphemeral);
  const dropEphemeral = useWorkspace((state) => state.dropEphemeral);
  const setBanner = useWorkspace((state) => state.setBanner);
  const openTab = useWorkspace((state) => state.openTab);
  const attachConnection = useWorkspace((state) => state.attachConnection);
  const setActiveTab = useWorkspace((state) => state.setActiveTab);
  const [connectOpen, setConnectOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [quick, setQuick] = useState("");
  const [connectKey, setConnectKey] = useState(0);
  const [secretFor, setSecretFor] = useState<Session | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const [editing, setEditing] = useState<Session | null>(null);
  const [folderEdit, setFolderEdit] = useState<Folder | null>(null);
  const [logConnectionId, setLogConnectionId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const recording = useSessionLog();
  const active = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeSession = active ? findSession(active.sessionId) : undefined;
  const sshConnected =
    !!active &&
    active.status === "connected" &&
    (active.kind === "terminal" || active.kind === "sftp") &&
    activeSession?.kind === "ssh";
  const prompted = authPrompt ? (findSession(authPrompt.sessionId) ?? null) : secretFor;

  useEffect(() => {
    if (forwardOpen && !sshConnected) {
      setForwardOpen(false);
    }
  }, [forwardOpen, sshConnected]);

  async function reload() {
    const [nextFolders, nextSessions] = await listWorkspace();
    setCatalog(nextFolders, nextSessions);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextFolders, nextSessions] = await listWorkspace();
        if (cancelled) return;
        setCatalog(nextFolders, nextSessions);
        if (startupLocalStarted || useWorkspace.getState().tabs.length > 0) return;
        startupLocalStarted = true;
        const shell = nextSessions.find(
          (session) => session.kind === "local" && session.local_subtype === "default_shell",
        );
        if (shell) await begin(shell, null);
      } catch (error: unknown) {
        if (!cancelled) setBanner(String(error));
      }
    })();
    void homeDir()
      .then((path) => {
        if (!path) return;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setBanner, setCatalog]);

  function loginInProgress() {
    return Boolean(secretFor || authPrompt || tabs.some((tab) => tab.status === "connecting"));
  }

  async function begin(session: Session, secret: string | null, reuseTabId?: string | null) {
    const submittingCurrent =
      secret !== null && (session.id === secretFor?.id || session.id === authPrompt?.sessionId);
    if (loginInProgress() && !submittingCurrent) {
      setBanner(t("loginInProgress"));
      return;
    }
    if (session.kind === "local") {
      if (lockedLocalSubtypes.includes(session.local_subtype ?? "")) {
        setBanner(t("macosLocalOnly"));
        return;
      }
      try {
        const connectionId = await startLocal(session.id, 80, 24);
        const patch = {
          status: "connected" as const,
          message: t("localConnected"),
          title: session.name,
          host: "local",
          port: 0,
          username: "",
        };
        if (reuseTabId && useWorkspace.getState().tabs.some((tab) => tab.id === reuseTabId)) {
          attachConnection(reuseTabId, connectionId, patch);
        } else {
          openTab({
            id: crypto.randomUUID(),
            connectionId,
            sessionId: session.id,
            kind: "terminal",
            ...patch,
          });
        }
      } catch (error) {
        setBanner(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (session.kind !== "ssh") {
      setBanner(t("localNotReady"));
      return;
    }
    const signedIn = tabs.some((tab) => tab.sessionId === session.id && tab.status === "connected");
    if (session.auth_type === "password" && !session.save_password && !secret && !signedIn) {
      setSecretFor(session);
      return;
    }
    try {
      const ephemeral = Boolean(useWorkspace.getState().ephemeral[session.id]);
      const connectionId = ephemeral
        ? await startEphemeralSsh({
            session_id: session.id,
            host: session.host ?? "",
            port: session.port ?? 22,
            username: session.username ?? "",
            auth_type: session.auth_type ?? "password",
            key_path: session.key_path,
            secret,
            cols: 80,
            rows: 24,
          })
        : await startSsh(session.id, secret, 80, 24);
      const patch = {
        status: "connecting" as const,
        message: t("connecting"),
        title: session.name,
        host: session.host ?? "",
        port: session.port ?? 22,
        username: session.username ?? "",
      };
      if (reuseTabId && useWorkspace.getState().tabs.some((tab) => tab.id === reuseTabId)) {
        attachConnection(reuseTabId, connectionId, patch);
      } else {
        const tab: WorkspaceTab = {
          id: crypto.randomUUID(),
          connectionId,
          sessionId: session.id,
          kind: "terminal",
          ...patch,
        };
        openTab(tab);
      }
      setConnectOpen(false);
      setSecretFor(null);
      setAuthPrompt(null);
      if (ephemeral) setQuick("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (needsPassword(message)) setSecretFor(session);
      else setBanner(message);
    }
  }

  useEffect(() => {
    const onCloseTab = () => closeActiveTab();
    const unlisten = listen("close-tab", onCloseTab);
    function onKey(event: KeyboardEvent) {
      const primary = mac ? event.metaKey : event.ctrlKey;
      if (!primary || event.altKey || event.shiftKey || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "w") {
        event.preventDefault();
        event.stopPropagation();
        closeActiveTab();
        return;
      }
      if (!mac && key === "q") {
        event.preventDefault();
        event.stopPropagation();
        void getCurrentWindow().close();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      void unlisten.then((stop) => stop());
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "r" && event.key !== "R") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (authPrompt || secretFor) return;
      if (!active || active.kind !== "terminal" || active.status === "connected" || active.status === "connecting") return;
      const session = findSession(active.sessionId);
      if (!session || session.kind !== "ssh" || !hasAuthFailure(session.id)) return;
      event.preventDefault();
      resetAuthFailure(session.id);
      setAuthPrompt({ sessionId: session.id, tabId: active.id, hint: null, nonce: Date.now() });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, authPrompt, secretFor, setAuthPrompt]);

  function cloneTab(tabId: string) {
    setTabMenu(null);
    const tab = tabs.find((item) => item.id === tabId);
    const session = tab ? findSession(tab.sessionId) : undefined;
    if (!session) {
      setBanner(t("unsavedConnection"));
      return;
    }
    void begin(session, null);
  }

  useEffect(() => {
    if (!tabMenu) return;
    function closeMenu() {
      setTabMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", onKey);
    };
  }, [tabMenu]);

  function openCommands() {
    const existing = tabs.find((tab) => tab.kind === "commands");
    if (existing) {
      setActiveTab(existing.id);
      return;
    }
    openTab({
      id: crypto.randomUUID(),
      connectionId: "",
      sessionId: "",
      title: t("commands"),
      kind: "commands",
      status: "connected",
      message: t("commandReference"),
      host: "",
      port: 0,
      username: "",
    });
  }

  function openSftp() {
    if (!sshConnected || !active) {
      if (activeSession?.kind === "local") {
        setBanner(t("localNoSftp"));
        return;
      }
      setBanner(t("connectSshFirst"));
      return;
    }
    openTab({
      ...active,
      id: crypto.randomUUID(),
      kind: "sftp",
      title: `SFTP - ${active.title}`,
    });
  }

  return (
    <div className="flex h-full flex-col bg-tie-surface font-sans text-xs text-tie-text antialiased">
      <header
        className={`flex h-8 items-center justify-between border-b border-tie-border bg-tie-titlebar ${mac ? "pl-20" : "px-2"}`}
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <span className="rounded border border-tie-border bg-tie-card px-1.5 font-mono font-bold">&gt;_ T</span>
          <span className="font-semibold text-tie-text">{t("appTitle")}</span>
        </div>
        <div className="font-mono text-[11px] text-tie-muted" data-tauri-drag-region>
          {active
            ? active.kind === "commands"
              ? t("commands")
              : active.port === 0
                ? `${active.title} · ${displayMessage(active.message)}`
                : `${active.username}@${active.host}:${active.port} · ${displayMessage(active.message)}`
            : t("notConnected")}
        </div>
        {mac ? <div className="w-16" /> : <WindowControls />}
      </header>
      <div className="flex items-center justify-between gap-2 border-b border-tie-border bg-tie-card px-2 py-1">
        <div className="flex items-center gap-1.5">
          <button
            className="flex items-center gap-1 rounded bg-tie-accent px-2.5 py-1 text-[11px] text-white"
            onClick={() => {
              setConnectKey((key) => key + 1);
              setConnectOpen(true);
            }}
            type="button"
          >
            <Plus size={12} /> {t("newSession")}
          </button>
          <button
            className="rounded p-1.5 text-tie-muted hover:bg-tie-subtle"
            title={t("reconnect")}
            onClick={() => {
              if (!active || active.kind === "commands") return;
              const session = findSession(active.sessionId);
              if (session) void begin(session, null);
              else setBanner(t("unsavedConnection"));
            }}
            type="button"
          >
            <RefreshCw size={12} />
          </button>
          <button
            className="rounded p-1.5 text-tie-muted hover:bg-tie-subtle"
            title={t("disconnect")}
            onClick={() => {
              if (active && active.kind !== "commands" && active.connectionId) void disconnect(active.connectionId);
            }}
            type="button"
          >
            <Power size={12} />
          </button>
          <form
            className="relative"
            onSubmit={(event) => {
              event.preventDefault();
              if (loginInProgress()) {
                setBanner(t("loginInProgress"));
                return;
              }
              void parseQuick(quick)
                .then((parsed) => {
                  const session: Session = {
                    id: crypto.randomUUID(),
                    folder_id: null,
                    name: `${parsed.username}@${parsed.host}`,
                    kind: "ssh",
                    host: parsed.host,
                    port: parsed.port,
                    username: parsed.username,
                    auth_type: parsed.key_path ? "private_key" : "password",
                    key_path: parsed.key_path,
                    save_password: false,
                    local_subtype: null,
                    extra_json: null,
                    created_at: "",
                    updated_at: "",
                  };
                  rememberEphemeral(session);
                  setSecretFor(session);
                })
                .catch((error: unknown) => setBanner(String(error)));
            }}
          >
            <SquareTerminal className="absolute left-2 top-1.5 text-tie-muted" size={12} />
            <input
              autoCapitalize="off"
              autoComplete="off"
              className="w-72 rounded border border-tie-border bg-tie-surface py-1 pl-7 pr-[4.75rem] font-mono text-[11px] outline-none focus:border-tie-accent"
              placeholder="user@host:22"
              spellCheck={false}
              value={quick}
              onChange={(event) => setQuick(event.target.value)}
            />
            <button
              className="absolute right-1 top-0.5 rounded bg-tie-hover px-2 py-0.5 text-[10px]"
              title={t("quickConnectHint")}
              type="submit"
            >
              {t("quickConnect")}
            </button>
          </form>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="flex items-center gap-1 rounded border border-tie-border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!sshConnected}
            title={
              activeSession?.kind === "local"
                ? t("localNoSftp")
                : !sshConnected
                  ? t("connectSshFirst")
                  : t("sftpTransfer")
            }
            onClick={openSftp}
            type="button"
          >
            <FolderInput size={12} /> {t("sftpTransfer")}
          </button>
          <button
            className="rounded border border-tie-border p-1.5"
            title={t("commands")}
            onClick={openCommands}
            type="button"
          >
            <SquareTerminal size={12} />
          </button>
          <button
            className={`rounded border p-1.5 disabled:cursor-not-allowed disabled:opacity-40 ${forwardOpen ? "border-tie-accent bg-tie-accent/10 text-tie-accent" : "border-tie-border"}`}
            disabled={!sshConnected}
            title={
              activeSession?.kind === "local"
                ? t("localNoForward")
                : !sshConnected
                  ? t("connectSshFirst")
                  : t("portForward")
            }
            onClick={() => {
              if (!sshConnected) {
                if (activeSession?.kind === "local") {
                  setBanner(t("localNoForward"));
                  return;
                }
                setBanner(t("connectSshFirst"));
                return;
              }
              setForwardOpen(true);
            }}
            type="button"
          >
            <ArrowLeftRight size={12} />
          </button>
          <button
            className={`rounded border p-1.5 ${recording ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "border-tie-border"}`}
            title={recording ? t("stopLog") : t("recordLog")}
            onClick={() => {
              if (recording) {
                void stopSessionLog(null, "manual");
                return;
              }
              if (!active || active.kind !== "terminal" || active.status !== "connected") {
                setBanner(t("openConnectedTerminal"));
                return;
              }
              setLogConnectionId(active.connectionId);
            }}
            type="button"
          >
            <ScrollText size={12} />
          </button>
          <button
            className="rounded border border-tie-border p-1.5"
            title={t("settings")}
            onClick={() => setSettingsOpen(true)}
            type="button"
          >
            <Settings size={12} />
          </button>
        </div>
      </div>
      <main className="relative flex min-h-0 flex-1">
        <SessionSidebar
          folders={folders}
          sessions={sessions}
          connectedSessionIds={tabs.filter((tab) => tab.status === "connected").map((tab) => tab.sessionId)}
          lockedLocalSubtypes={lockedLocalSubtypes}
          search={search}
          onSearch={setSearch}
          onOpen={(session) => void begin(session, null)}
          onCreateFolder={() => setFolderOpen(true)}
          onEditFolder={setFolderEdit}
          onDeleteFolder={(folder) => {
            void deleteFolder(folder.id)
              .then(reload)
              .catch((error: unknown) => setBanner(String(error)));
          }}
          onEdit={setEditing}
          onDelete={(session) => {
            void deleteSession(session.id)
              .then(reload)
              .catch((error: unknown) => setBanner(String(error)));
          }}
        />
        <section className="flex min-w-0 flex-1 flex-col bg-tie-card">
          <nav className="flex h-8 items-end gap-1 border-b border-tie-border bg-tie-subtle px-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`mb-0 flex h-7 items-center gap-2 rounded-t border px-3 font-mono ${
                  tab.id === activeTabId
                    ? "border-tie-border border-t-tie-accent bg-tie-card"
                    : "border-transparent text-tie-muted"
                }`}
                onClick={() => setActiveTab(tab.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (tab.kind === "commands" || tab.status !== "connected") return;
                  setTabMenu({ x: event.clientX, y: event.clientY, tabId: tab.id });
                }}
                type="button"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${tab.status === "connected" ? "bg-emerald-500" : "bg-tie-hover"}`} />
                {tab.kind === "commands" ? t("commands") : tab.title}
                <span
                  className="text-tie-muted"
                  onClick={(event) => {
                    event.stopPropagation();
                    dismissTab(tab);
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </nav>
          {tabMenu ? (
            <div
              className="fixed z-50 min-w-28 rounded border border-tie-border bg-tie-card py-1 shadow-lg"
              style={{ left: tabMenu.x, top: tabMenu.y }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                className="block w-full px-3 py-1 text-left hover:bg-tie-subtle"
                onClick={() => cloneTab(tabMenu.tabId)}
                type="button"
              >
                {t("cloneSession")}
              </button>
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col">
            {active?.kind === "terminal" && active.status === "connected" ? (
              <TerminalView connectionId={active.connectionId} />
            ) : null}
            {active?.kind === "sftp" && active.status === "connected" ? (
              <SftpView connectionId={active.connectionId} />
            ) : null}
            {active?.kind === "commands" ? <CommandsView /> : null}
            {active && active.status !== "connected" ? (
              <div className="p-4 font-mono text-tie-muted">
                {active.title}: {displayMessage(active.message)}
              </div>
            ) : null}
            {!active ? <div className="p-4 text-tie-muted">{t("emptyHint")}</div> : null}
          </div>
        </section>
        {connectOpen ? (
          <ConnectDialog
            key={connectKey}
            folders={folders}
            onClose={() => setConnectOpen(false)}
            onCreated={(sessionId, secret, connect) => {
              void reload().then(() => {
                if (!connect) {
                  setConnectOpen(false);
                  return;
                }
                const session = useWorkspace.getState().sessions.find((item) => item.id === sessionId);
                if (session) void begin(session, secret);
              });
            }}
          />
        ) : null}
        {editing ? (
          <ConnectDialog
            key={editing.id}
            folders={folders}
            session={editing}
            onClose={() => setEditing(null)}
            onCreated={(sessionId, secret, connect) => {
              void reload().then(() => {
                if (!connect) {
                  setEditing(null);
                  return;
                }
                const session = useWorkspace.getState().sessions.find((item) => item.id === sessionId);
                if (session) void begin(session, secret);
                setEditing(null);
              });
            }}
          />
        ) : null}
        {folderOpen ? (
          <NameDialog
            title={t("newFolder")}
            onClose={() => setFolderOpen(false)}
            onSubmit={(name) => {
              void createFolder(name, null)
                .then(() => reload())
                .then(() => setFolderOpen(false))
                .catch((error: unknown) => setBanner(String(error)));
            }}
          />
        ) : null}
        {folderEdit ? (
          <NameDialog
            key={folderEdit.id}
            title={t("editFolder")}
            initial={folderEdit.name}
            confirmLabel={t("save")}
            onClose={() => setFolderEdit(null)}
            onSubmit={(name) => {
              void updateFolder(folderEdit.id, name)
                .then(() => reload())
                .then(() => setFolderEdit(null))
                .catch((error: unknown) => setBanner(String(error)));
            }}
          />
        ) : null}
        {prompted ? (
          <SecretDialog
            key={authPrompt ? `${authPrompt.sessionId}:${authPrompt.nonce}` : prompted.id}
            title={t("enterSecret", { label: prompted.auth_type === "private_key" ? t("passphrase") : t("password") })}
            hint={authPrompt?.hint}
            onClose={() => {
              if (secretFor && useWorkspace.getState().ephemeral[secretFor.id]) {
                const open = useWorkspace.getState().tabs.some((tab) => tab.sessionId === secretFor.id);
                if (!open) dropEphemeral(secretFor.id);
              }
              setSecretFor(null);
              setAuthPrompt(null);
            }}
            onSubmit={(secret) => void begin(prompted, secret, authPrompt?.tabId)}
          />
        ) : null}
        {hostKey ? <HostKeyDialog prompt={hostKey} /> : null}
        {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
        {logConnectionId ? (
          <LogPathDialog
            onClose={() => setLogConnectionId(null)}
            onConfirm={(path) => {
              const still = useWorkspace.getState().tabs.some(
                (tab) => tab.connectionId === logConnectionId && tab.kind === "terminal" && tab.status === "connected",
              );
              if (!still) {
                setBanner(t("terminalExited"));
                setLogConnectionId(null);
                return;
              }
              startSessionLog(logConnectionId, path);
              setLogConnectionId(null);
            }}
          />
        ) : null}
        {forwardOpen && sshConnected && active ? (
          <PortForwardDrawer
            connectionId={active.connectionId}
            open={forwardOpen}
            onClose={() => setForwardOpen(false)}
            onError={(message) => setBanner(message)}
          />
        ) : null}
      </main>
      <footer className="flex h-6 items-center justify-between border-t border-tie-border bg-tie-subtle px-3 font-mono text-[10px] text-tie-muted">
        <div className="flex items-center gap-3">
          <span>{t("hosts", { count: sessions.filter((session) => session.kind === "ssh").length })}</span>
          <span className="text-emerald-700 dark:text-emerald-400">
            {t("online", { count: tabs.filter((tab) => tab.kind === "terminal" && tab.status === "connected").length })}
          </span>
          <span>{statusLabel(active?.status, t)}</span>
          <span title={t("latencyHint")}>{t("latency")}</span>
          <StatusBarForwards
            connectionId={
              active && (active.kind === "terminal" || active.kind === "sftp") && active.connectionId
                ? active.connectionId
                : null
            }
          />
        </div>
        <div className="flex items-center gap-3">
          <span>{cursor}</span>
          <span>UTF-8</span>
        </div>
      </footer>
      {notice ? (
        <div className="fixed bottom-8 right-3 z-50 max-w-sm break-words rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800 shadow-lg dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          {notice}
        </div>
      ) : null}
      {banner ? (
        <div
          className={`fixed right-3 z-50 flex max-w-sm items-start gap-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 shadow-lg dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 ${notice ? "bottom-20" : "bottom-8"}`}
        >
          <span className="min-w-0 flex-1 break-words">{banner}</span>
          <button className="shrink-0 text-amber-700 dark:text-amber-300" onClick={() => setBanner(null)} type="button">
            {t("close")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function statusLabel(status: string | undefined, translate: ReturnType<typeof useT>) {
  if (status === "connected") return translate("statusConnected");
  if (status === "connecting") return translate("statusConnecting");
  if (status === "failed") return translate("statusFailed");
  if (status === "disconnected") return translate("statusDisconnected");
  return translate("statusReady");
}

function WindowControls() {
  const window = getCurrentWindow();
  return (
    <div className="flex">
      <button className="h-8 w-9 hover:bg-tie-hover" onClick={() => void window.minimize()} type="button">
        –
      </button>
      <button className="h-8 w-9 hover:bg-tie-hover" onClick={() => void window.toggleMaximize()} type="button">
        □
      </button>
      <button className="h-8 w-9 hover:bg-red-500 hover:text-white" onClick={() => void window.close()} type="button">
        ×
      </button>
    </div>
  );
}
