import { create } from "zustand";
import type { PortForward } from "../api/types";

interface PortForwardState {
  byId: Record<string, PortForward>;
  upsert: (forward: PortForward) => void;
  remove: (id: string) => void;
  clearConnection: (connectionId: string) => void;
  forConnection: (connectionId: string) => PortForward[];
}

export const usePortForwards = create<PortForwardState>((set, get) => ({
  byId: {},
  upsert: (forward) => {
    if (forward.status === "stopped") {
      set((state) => {
        const next = { ...state.byId };
        delete next[forward.id];
        return { byId: next };
      });
      return;
    }
    set((state) => ({
      byId: { ...state.byId, [forward.id]: forward },
    }));
  },
  remove: (id) =>
    set((state) => {
      const next = { ...state.byId };
      delete next[id];
      return { byId: next };
    }),
  clearConnection: (connectionId) =>
    set((state) => {
      const next: Record<string, PortForward> = {};
      for (const [id, forward] of Object.entries(state.byId)) {
        if (forward.connection_id !== connectionId) next[id] = forward;
      }
      return { byId: next };
    }),
  forConnection: (connectionId) =>
    Object.values(get().byId)
      .filter((item) => item.connection_id === connectionId)
      .sort((a, b) => a.bind_port - b.bind_port),
}));

export function formatForwardSummary(forward: PortForward): string {
  const kindLabel =
    forward.kind === "local" ? "L" : forward.kind === "remote" ? "R" : "D";
  if (forward.kind === "dynamic") {
    return `${kindLabel} ${forward.bind_host}:${forward.bind_port}`;
  }
  const dest = `${forward.dest_host ?? "?"}:${forward.dest_port ?? "?"}`;
  if (forward.kind === "remote") {
    return `${kindLabel} ${forward.bind_host}:${forward.bind_port} ← ${dest}`;
  }
  return `${kindLabel} ${forward.bind_host}:${forward.bind_port} → ${dest}`;
}

export function forwardStatusClass(status: PortForward["status"]): string {
  switch (status) {
    case "active":
      return "bg-emerald-500";
    case "starting":
      return "bg-amber-400";
    case "error":
      return "bg-red-500";
    default:
      return "bg-tie-muted";
  }
}
