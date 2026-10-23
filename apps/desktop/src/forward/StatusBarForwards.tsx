import { useEffect, useMemo, useState } from "react";
import type { PortForward } from "../api/types";
import { formatForwardSummary, forwardStatusClass, usePortForwards } from "./store";

const ROTATE_MS = 3500;

export function StatusBarForwards({ connectionId }: { connectionId: string | null }) {
  const byId = usePortForwards((state) => state.byId);
  const forwards = useMemo(() => {
    if (!connectionId) return [];
    return Object.values(byId).filter(
      (item) =>
        item.connection_id === connectionId &&
        (item.status === "active" || item.status === "starting" || item.status === "error"),
    );
  }, [byId, connectionId]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [connectionId, forwards.length]);

  useEffect(() => {
    if (forwards.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % forwards.length);
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [forwards.length, connectionId]);

  if (!connectionId || forwards.length === 0) return null;

  const current: PortForward = forwards[index % forwards.length]!;

  return (
    <span className="inline-flex max-w-[28rem] items-center gap-1.5 truncate" title={formatForwardSummary(current)}>
      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${forwardStatusClass(current.status)}`} />
      <span className="truncate">{formatForwardSummary(current)}</span>
      {forwards.length > 1 ? (
        <span className="shrink-0 text-tie-muted">
          {index + 1}/{forwards.length}
        </span>
      ) : null}
    </span>
  );
}
