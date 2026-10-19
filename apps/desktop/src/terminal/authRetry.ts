import { t } from "../i18n";
import { findSession, useWorkspace } from "../stores/workspace";

const failures = new Map<string, number>();
const handled = new Set<string>();

export function isAuthFailure(message: string) {
  return message.includes("auth failed");
}

export function noteAuthFailure(connectionId: string) {
  if (handled.has(connectionId)) return;
  const state = useWorkspace.getState();
  const tab = state.tabs.find((item) => item.connectionId === connectionId && item.kind === "terminal");
  if (!tab) return;
  handled.add(connectionId);
  const session = findSession(tab.sessionId);
  const label = session?.auth_type === "private_key" ? t("passphrase") : t("password");
  const count = (failures.get(tab.sessionId) ?? 0) + 1;
  failures.set(tab.sessionId, count);
  if (count < 3) {
    const hint = t("secretWrong", { label });
    state.updateConnection(connectionId, { message: hint });
    state.setAuthPrompt({ sessionId: tab.sessionId, tabId: tab.id, hint, nonce: Date.now() });
    return;
  }
  const message = t("secretWrongStop", { label });
  state.updateConnection(connectionId, { message });
  state.setAuthPrompt(null);
  state.setBanner(message);
}

export function clearAuthFailure(sessionId: string) {
  failures.delete(sessionId);
}

export function hasAuthFailure(sessionId: string) {
  return failures.has(sessionId);
}

export function resetAuthFailure(sessionId: string) {
  failures.set(sessionId, 0);
}
