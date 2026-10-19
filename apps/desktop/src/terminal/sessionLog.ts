import { useSyncExternalStore } from "react";
import { appendSessionLog } from "../api/commands";
import { t } from "../i18n";
import { useWorkspace } from "../stores/workspace";

const ALT_SCREEN = new Set([47, 1047, 1049]);
const EDITORS = new Set(["vi", "vim", "nvim", "view", "vimdiff"]);

interface ActiveLog {
  connectionId: string;
  basePath: string;
  index: number;
  latestPath: string;
  stopping: boolean;
  transcript: Transcript;
  input: string;
  skipInputEsc: boolean;
}

let active: ActiveLog | null = null;
let pending = "";
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let chain: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function useSessionLog() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => active !== null && !active.stopping,
  );
}

export function sessionLogConnectionId() {
  return active && !active.stopping ? active.connectionId : null;
}

export function startSessionLog(connectionId: string, basePath: string) {
  if (active && !active.stopping) return;
  active = {
    connectionId,
    basePath,
    index: 1,
    latestPath: segmentPath(basePath, 1),
    stopping: false,
    transcript: new Transcript(),
    input: "",
    skipInputEsc: false,
  };
  pending = "";
  emit();
  useWorkspace.getState().setNotice(t("logStarted"));
}

export function ingestSessionLog(connectionId: string, chunk: Uint8Array) {
  if (!active || active.stopping || active.connectionId !== connectionId) return;
  const text = active.transcript.push(chunk);
  if (text) queueWrite(text);
}

export function noteTerminalInput(connectionId: string, data: string) {
  if (!active || active.stopping || active.connectionId !== connectionId) return;
  for (const char of data) {
    if (active.skipInputEsc) {
      if (char >= "@" && char <= "~") active.skipInputEsc = false;
      continue;
    }
    if (char === "\u001b") {
      active.skipInputEsc = true;
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (isEditorCommand(active.input)) active.transcript.armEditor();
      active.input = "";
      continue;
    }
    if (char === "\u007f" || char === "\b") {
      active.input = active.input.slice(0, -1);
      continue;
    }
    if (char >= " ") active.input += char;
  }
}

export async function stopSessionLog(connectionId: string | null, reason: "manual" | "exit") {
  const current = active;
  if (!current || current.stopping) return;
  if (connectionId && current.connectionId !== connectionId) return;
  current.stopping = true;
  emit();
  const tail = current.transcript.finish();
  if (tail) queueWrite(tail);
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  const data = pending;
  pending = "";
  if (data) enqueue(current, data);
  try {
    await chain;
  } catch {
    // enqueue already surfaces the error
  }
  if (active === current) {
    active = null;
    emit();
  }
  const where =
    current.index > 1
      ? t("logSegments", { first: segmentPath(current.basePath, 1), count: current.index })
      : current.latestPath;
  const text = reason === "exit" ? t("logStoppedExit", { where }) : t("logStopped", { where });
  useWorkspace.getState().setNotice(text);
}

function queueWrite(text: string) {
  const current = active;
  if (!current || !text) return;
  pending += text;
  if (pending.length >= 32 * 1024) {
    const data = pending;
    pending = "";
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    enqueue(current, data);
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      const data = pending;
      pending = "";
      if (data && active) enqueue(active, data);
    }, 200);
  }
}

function enqueue(current: ActiveLog, data: string) {
  chain = chain
    .then(async () => {
      const result = await appendSessionLog(current.basePath, current.index, data);
      current.index = result.index;
      current.latestPath = result.path;
    })
    .catch((error: unknown) => {
      useWorkspace.getState().setBanner(error instanceof Error ? error.message : String(error));
    });
}

export function segmentPath(base: string, index: number) {
  const slash = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
  const dir = slash >= 0 ? base.slice(0, slash + 1) : "";
  const name = slash >= 0 ? base.slice(slash + 1) : base;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${dir}${stem}-${String(index).padStart(3, "0")}${ext}`;
}

function isEditorCommand(line: string) {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  let index = 0;
  if (parts[0] === "sudo") {
    index = 1;
    while (index < parts.length && parts[index].startsWith("-")) index += 1;
  }
  while (index < parts.length && /^[\w.-]+=\S+$/.test(parts[index])) index += 1;
  const command = parts[index]?.split("/").pop() ?? "";
  return EDITORS.has(command);
}

class Transcript {
  private line = "";
  private column = 0;
  private mode: "text" | "esc" | "csi" | "osc" | "osc-esc" | "charset" = "text";
  private csi = "";
  private utf8: number[] = [];
  private drop = false;
  private editorArmed = false;
  private armedNewlines = 0;

  armEditor() {
    this.editorArmed = true;
    this.armedNewlines = 0;
  }

  push(bytes: Uint8Array) {
    let out = "";
    for (const byte of bytes) out += this.feed(byte);
    return out;
  }

  finish() {
    this.utf8 = [];
    this.mode = "text";
    this.csi = "";
    if (this.drop || !this.line) {
      this.line = "";
      this.column = 0;
      return "";
    }
    const text = `${this.line}\n`;
    this.line = "";
    this.column = 0;
    return text;
  }

  private feed(byte: number) {
    if (this.utf8.length > 0 && this.mode === "text") {
      this.utf8.push(byte);
      if (this.utf8.length >= utf8Length(this.utf8[0])) {
        const bytes = Uint8Array.from(this.utf8);
        this.utf8 = [];
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        if (text && text !== "\uFFFD") this.put(text);
      }
      return "";
    }
    switch (this.mode) {
      case "text":
        if (byte === 0x1b) {
          this.mode = "esc";
          return "";
        }
        if (byte === 0x0d) {
          this.column = 0;
          return "";
        }
        if (byte === 0x0a) return this.commit();
        if (byte === 0x08 || byte === 0x7f) {
          this.backspace();
          return "";
        }
        if (byte === 0x09) {
          this.put("\t");
          return "";
        }
        if (byte < 0x20) return "";
        if (byte < 0x80) {
          this.put(String.fromCharCode(byte));
          return "";
        }
        this.utf8 = [byte];
        return "";
      case "esc":
        if (byte === 0x5b) {
          this.mode = "csi";
          this.csi = "";
          return "";
        }
        if (byte === 0x5d) {
          this.mode = "osc";
          return "";
        }
        if (byte === 0x28 || byte === 0x29 || byte === 0x2a || byte === 0x2b) {
          this.mode = "charset";
          return "";
        }
        this.mode = "text";
        return "";
      case "charset":
        this.mode = "text";
        return "";
      case "csi":
        if (this.csi.length > 64) {
          this.mode = "text";
          this.csi = "";
          return "";
        }
        this.csi += String.fromCharCode(byte);
        if (byte >= 0x40 && byte <= 0x7e) {
          this.finishCsi();
          this.mode = "text";
          this.csi = "";
        }
        return "";
      case "osc":
        if (byte === 0x07) this.mode = "text";
        else if (byte === 0x1b) this.mode = "osc-esc";
        return "";
      case "osc-esc":
        this.mode = byte === 0x5c ? "text" : "osc";
        return "";
      default:
        return "";
    }
  }

  private finishCsi() {
    const final = this.csi.slice(-1);
    const body = this.csi.slice(0, -1);
    if ((final !== "h" && final !== "l") || !body.startsWith("?")) return;
    const modes = body
      .slice(1)
      .split(";")
      .map((item) => Number(item))
      .filter((item) => ALT_SCREEN.has(item));
    if (modes.length === 0) return;
    if (final === "h") {
      if (this.editorArmed) this.drop = true;
      return;
    }
    this.drop = false;
    this.editorArmed = false;
    this.armedNewlines = 0;
  }

  private put(text: string) {
    if (this.drop) return;
    if (this.column < this.line.length) {
      this.line = this.line.slice(0, this.column) + text + this.line.slice(this.column + text.length);
    } else {
      this.line += text;
    }
    this.column += text.length;
  }

  private backspace() {
    if (this.drop || this.column === 0) return;
    this.line = this.line.slice(0, this.column - 1) + this.line.slice(this.column);
    this.column -= 1;
  }

  private commit() {
    if (this.drop) {
      this.line = "";
      this.column = 0;
      return "";
    }
    if (this.editorArmed) {
      this.armedNewlines += 1;
      if (this.armedNewlines >= 2) this.editorArmed = false;
    }
    const text = `${this.line}\n`;
    this.line = "";
    this.column = 0;
    return text;
  }
}

function utf8Length(byte: number) {
  if ((byte & 0xf8) === 0xf0) return 4;
  if ((byte & 0xf0) === 0xe0) return 3;
  if ((byte & 0xe0) === 0xc0) return 2;
  return 1;
}
