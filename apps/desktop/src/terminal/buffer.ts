import { ingestSessionLog } from "./sessionLog";

const listeners = new Map<string, (chunk: Uint8Array) => void>();
const history = new Map<string, Uint8Array[]>();

export function pushTerminalData(connectionId: string, chunk: Uint8Array) {
  const log = history.get(connectionId) ?? [];
  log.push(chunk);
  history.set(connectionId, log);
  listeners.get(connectionId)?.(chunk);
  ingestSessionLog(connectionId, chunk);
}

export function attachTerminal(connectionId: string, listener: (chunk: Uint8Array) => void) {
  const log = history.get(connectionId) ?? [];
  for (const chunk of log) listener(chunk);
  listeners.set(connectionId, listener);
  return () => {
    if (listeners.get(connectionId) === listener) listeners.delete(connectionId);
  };
}

export function releaseTerminal(connectionId: string) {
  listeners.delete(connectionId);
  history.delete(connectionId);
}

export function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
