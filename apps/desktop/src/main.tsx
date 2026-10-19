import { listen } from "@tauri-apps/api/event";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { ConnectionEvent, HostKeyEvent, TerminalDataEvent, TransferEvent } from "./api/types";
import "./index.css";
import { bootLocale } from "./i18n";
import { useWorkspace } from "./stores/workspace";
import { clearAuthFailure, isAuthFailure, noteAuthFailure } from "./terminal/authRetry";
import { decodeBase64, pushTerminalData, releaseTerminal } from "./terminal/buffer";
import { stopSessionLog } from "./terminal/sessionLog";
import "@xterm/xterm/css/xterm.css";

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

void bootLocale().finally(() => startApp(root));

function startApp(container: HTMLElement) {
  void listen<TerminalDataEvent>("terminal-data", (event) => {
    pushTerminalData(event.payload.connection_id, decodeBase64(event.payload.data_base64));
  });

  void listen<ConnectionEvent>("connection-status", (event) => {
    const payload = event.payload;
    useWorkspace.getState().updateConnection(payload.connection_id, {
      status: payload.state,
      message: payload.message,
      host: payload.host,
      port: payload.port,
      username: payload.username,
      connectedAt: payload.state === "connected" ? Date.now() : undefined,
    });
    if (payload.state === "connected") {
      const tab = useWorkspace.getState().tabs.find((item) => item.connectionId === payload.connection_id);
      if (tab) {
        clearAuthFailure(tab.sessionId);
        const prompt = useWorkspace.getState().authPrompt;
        if (prompt?.sessionId === tab.sessionId) useWorkspace.getState().setAuthPrompt(null);
      }
    }
    if (payload.state === "failed" || payload.state === "disconnected") {
      releaseTerminal(payload.connection_id);
      void stopSessionLog(payload.connection_id, "exit");
    }
    if (payload.state === "disconnected" || (payload.state === "failed" && !isAuthFailure(payload.message))) {
      const state = useWorkspace.getState();
      const tab = state.tabs.find((item) => item.connectionId === payload.connection_id);
      if (tab && state.ephemeral[tab.sessionId]) {
        const stillLive = state.tabs.some(
          (item) =>
            item.sessionId === tab.sessionId &&
            item.connectionId !== payload.connection_id &&
            (item.status === "connected" || item.status === "connecting"),
        );
        if (!stillLive) state.dropEphemeral(tab.sessionId);
      }
    }
    if (payload.state === "failed") {
      if (isAuthFailure(payload.message)) noteAuthFailure(payload.connection_id);
      else useWorkspace.getState().setBanner(payload.message);
      useWorkspace.getState().setHostKey(null);
    }
  });

  void listen<HostKeyEvent>("host-key", (event) => {
    useWorkspace.getState().setHostKey(event.payload);
  });

  void listen<TransferEvent>("transfer-progress", (event) => {
    useWorkspace.getState().upsertTransfer(event.payload);
  });

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
