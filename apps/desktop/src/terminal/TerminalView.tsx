import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { resizeTerminal, writeTerminal } from "../api/commands";
import { useWorkspace } from "../stores/workspace";
import { attachTerminal } from "./buffer";
import { noteTerminalInput } from "./sessionLog";

const mac = navigator.userAgent.includes("Mac");

export function TerminalView({ connectionId }: { connectionId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const setCursor = useWorkspace((state) => state.setCursor);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.4,
      cursorBlink: true,
      theme: {
        background: "#ffffff",
        foreground: "#1e293b",
        cursor: "#0f172a",
        selectionBackground: "#1e293b",
        selectionForeground: "#ffffff",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.attachCustomKeyEventHandler((event) => {
      const primary = mac ? event.metaKey : event.ctrlKey;
      if (!primary || event.altKey || event.shiftKey) return true;
      const key = event.key.toLowerCase();
      if (key === "w" || (!mac && key === "q")) return false;
      return true;
    });
    term.open(element);
    fit.fit();
    const reportCursor = () => {
      const buffer = term.buffer.active;
      setCursor(`Ln ${buffer.cursorY + 1}, Col ${buffer.cursorX + 1}`);
    };
    const detach = attachTerminal(connectionId, (chunk) => {
      term.write(chunk);
      reportCursor();
    });
    const input = term.onData((data) => {
      noteTerminalInput(connectionId, data);
      const bytes = Array.from(new TextEncoder().encode(data));
      void writeTerminal(connectionId, bytes).catch((error: unknown) => {
        useWorkspace.getState().setBanner(error instanceof Error ? error.message : String(error));
      });
      reportCursor();
    });
    const resize = () => {
      fit.fit();
      void resizeTerminal(connectionId, term.cols, term.rows).catch(() => undefined);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => {
      detach();
      input.dispose();
      observer.disconnect();
      term.dispose();
    };
  }, [connectionId, setCursor]);

  return <div ref={host} className="h-full w-full bg-white p-2" />;
}
