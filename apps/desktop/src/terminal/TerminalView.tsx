import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { resizeTerminal, writeTerminal } from "../api/commands";
import { useWorkspace } from "../stores/workspace";
import { useTheme, type Theme } from "../theme";
import { attachTerminal } from "./buffer";
import { noteTerminalInput } from "./sessionLog";

const mac = navigator.userAgent.includes("Mac");

const themes: Record<Theme, ITheme> = {
  light: {
    background: "#ffffff",
    foreground: "#1e293b",
    cursor: "#0f172a",
    selectionBackground: "#1e293b",
    selectionForeground: "#ffffff",
  },
  dark: {
    background: "#1f1f1f",
    foreground: "#cccccc",
    cursor: "#aeafad",
    selectionBackground: "#264f78",
    selectionForeground: "#ffffff",
  },
};

export function TerminalView({ connectionId }: { connectionId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const setCursor = useWorkspace((state) => state.setCursor);
  const theme = useTheme((state) => state.theme);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.4,
      cursorBlink: true,
      theme: themes[useTheme.getState().theme],
    });
    termRef.current = term;
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
      termRef.current = null;
    };
  }, [connectionId, setCursor]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = themes[theme];
    term.refresh(0, term.rows - 1);
  }, [theme]);

  return <div ref={host} className="h-full w-full bg-tie-bg p-2" />;
}
