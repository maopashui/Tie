import { ingestSessionLog } from "./sessionLog";

const listeners = new Map<string, (chunk: Uint8Array) => void>();
const history = new Map<string, Uint8Array[]>();
const connectionToTab = new Map<string, string>();
const tabToConnection = new Map<string, string>();

export function bindConnection(tabId: string, connectionId: string) {
  const prev = tabToConnection.get(tabId);
  if (prev && prev !== connectionId) connectionToTab.delete(prev);
  connectionToTab.set(connectionId, tabId);
  tabToConnection.set(tabId, connectionId);
}

export function pushTerminalData(connectionId: string, chunk: Uint8Array) {
  const tabId = connectionToTab.get(connectionId);
  if (!tabId) return;
  const log = history.get(tabId) ?? [];
  log.push(chunk);
  history.set(tabId, log);
  listeners.get(tabId)?.(chunk);
  ingestSessionLog(connectionId, chunk);
}

export function attachTerminal(tabId: string, listener: (chunk: Uint8Array) => void) {
  const log = history.get(tabId) ?? [];
  for (const chunk of log) listener(chunk);
  listeners.set(tabId, listener);
  return () => {
    if (listeners.get(tabId) === listener) listeners.delete(tabId);
  };
}

export function releaseTerminal(tabId: string) {
  listeners.delete(tabId);
  history.delete(tabId);
  const connectionId = tabToConnection.get(tabId);
  tabToConnection.delete(tabId);
  if (connectionId) connectionToTab.delete(connectionId);
}

export function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
