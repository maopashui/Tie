import { create } from "zustand";
import type { Folder, HostKeyEvent, Session, TransferEvent, TransferRecord } from "../api/types";

export interface AuthPrompt {
  sessionId: string;
  tabId: string;
  hint: string | null;
  nonce: number;
}

export interface WorkspaceTab {
  id: string;
  connectionId: string;
  sessionId: string;
  title: string;
  kind: "terminal" | "sftp" | "commands";
  status: "connecting" | "connected" | "failed" | "disconnected";
  message: string;
  host: string;
  port: number;
  username: string;
  connectedAt?: number;
}

interface WorkspaceState {
  folders: Folder[];
  sessions: Session[];
  ephemeral: Record<string, Session>;
  search: string;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  banner: string | null;
  notice: string | null;
  hostKey: HostKeyEvent | null;
  authPrompt: AuthPrompt | null;
  transfers: TransferEvent[];
  history: TransferRecord[];
  cursor: string;
  setSearch: (search: string) => void;
  setBanner: (banner: string | null) => void;
  setNotice: (notice: string | null) => void;
  setCatalog: (folders: Folder[], sessions: Session[]) => void;
  rememberEphemeral: (session: Session) => void;
  dropEphemeral: (sessionId: string) => void;
  setHostKey: (hostKey: HostKeyEvent | null) => void;
  setAuthPrompt: (authPrompt: AuthPrompt | null) => void;
  setCursor: (cursor: string) => void;
  setHistory: (history: TransferRecord[]) => void;
  upsertTransfer: (event: TransferEvent) => void;
  openTab: (tab: WorkspaceTab) => void;
  attachConnection: (
    tabId: string,
    connectionId: string,
    patch: Partial<Pick<WorkspaceTab, "status" | "message" | "title" | "host" | "port" | "username">>,
  ) => void;
  updateConnection: (
    connectionId: string,
    patch: Partial<Pick<WorkspaceTab, "status" | "message" | "connectedAt" | "host" | "port" | "username">>,
  ) => void;
  closeTab: (tabId: string) => string | null;
  setActiveTab: (tabId: string) => void;
}

let bannerTimer: ReturnType<typeof setTimeout> | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  folders: [],
  sessions: [],
  ephemeral: {},
  search: "",
  tabs: [],
  activeTabId: null,
  banner: null,
  notice: null,
  hostKey: null,
  authPrompt: null,
  transfers: [],
  history: [],
  cursor: "Ln 1, Col 1",
  setSearch: (search) => set({ search }),
  setBanner: (banner) => {
    if (bannerTimer) clearTimeout(bannerTimer);
    set({ banner });
    if (!banner) return;
    bannerTimer = setTimeout(() => {
      bannerTimer = undefined;
      set({ banner: null });
    }, 3500);
  },
  setNotice: (notice) => {
    if (noticeTimer) clearTimeout(noticeTimer);
    set({ notice });
    if (!notice) return;
    noticeTimer = setTimeout(() => {
      noticeTimer = undefined;
      set({ notice: null });
    }, 3500);
  },
  setCatalog: (folders, sessions) => set({ folders, sessions }),
  rememberEphemeral: (session) =>
    set((state) => ({ ephemeral: { ...state.ephemeral, [session.id]: session } })),
  dropEphemeral: (sessionId) =>
    set((state) => {
      if (!state.ephemeral[sessionId]) return state;
      const ephemeral = { ...state.ephemeral };
      delete ephemeral[sessionId];
      return { ephemeral };
    }),
  setHostKey: (hostKey) => set({ hostKey }),
  setAuthPrompt: (authPrompt) => set({ authPrompt }),
  setCursor: (cursor) => set({ cursor }),
  setHistory: (history) => set({ history }),
  upsertTransfer: (event) =>
    set((state) => {
      const rest = state.transfers.filter((item) => item.id !== event.id);
      return { transfers: [event, ...rest].slice(0, 50) };
    }),
  openTab: (tab) =>
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    })),
  attachConnection: (tabId, connectionId, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, connectionId, ...patch } : tab)),
      activeTabId: tabId,
    })),
  updateConnection: (connectionId, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.connectionId === connectionId ? { ...tab, ...patch } : tab)),
    })),
  closeTab: (tabId) => {
    const current = get();
    const tab = current.tabs.find((item) => item.id === tabId);
    const tabs = current.tabs.filter((item) => item.id !== tabId);
    const activeTabId =
      current.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : current.activeTabId;
    set({ tabs, activeTabId });
    if (!tab) return null;
    const stillOpen = tabs.some((item) => item.connectionId === tab.connectionId);
    return stillOpen ? null : tab.connectionId;
  },
  setActiveTab: (tabId) => set({ activeTabId: tabId }),
}));

export function findSession(id: string) {
  const state = useWorkspace.getState();
  return state.sessions.find((item) => item.id === id) ?? state.ephemeral[id];
}
