import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listPortForwards, startPortForward, stopPortForward } from "../api/commands";
import type { ForwardKind, PortForward } from "../api/types";
import { useT } from "../i18n";
import {
  formatForwardSummary,
  forwardStatusClass,
  usePortForwards,
} from "./store";

type Props = {
  connectionId: string;
  open: boolean;
  onClose: () => void;
  onError: (message: string) => void;
};

export function PortForwardDrawer({ connectionId, open, onClose, onError }: Props) {
  const t = useT();
  const upsert = usePortForwards((state) => state.upsert);
  const remove = usePortForwards((state) => state.remove);
  const byId = usePortForwards((state) => state.byId);
  const forwards = useMemo(
    () =>
      Object.values(byId)
        .filter((item) => item.connection_id === connectionId)
        .sort((a, b) => a.bind_port - b.bind_port),
    [byId, connectionId],
  );

  const [kind, setKind] = useState<ForwardKind>("local");
  const [bindHost, setBindHost] = useState("127.0.0.1");
  const [bindPort, setBindPort] = useState("1080");
  const [destHost, setDestHost] = useState("127.0.0.1");
  const [destPort, setDestPort] = useState("80");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !connectionId) return;
    let cancelled = false;
    void listPortForwards(connectionId)
      .then((list) => {
        if (cancelled) return;
        for (const item of list) upsert(normalizeForward(item));
      })
      .catch((error: unknown) => {
        if (!cancelled) onError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [open, connectionId, upsert, onError]);

  if (!open) return null;

  async function onAdd() {
    const bind = Number(bindPort);
    if (!bindHost.trim() || !Number.isInteger(bind) || bind < 1 || bind > 65535) {
      onError(t("forwardPortInvalid"));
      return;
    }
    let dest_host: string | null = null;
    let dest_port: number | null = null;
    if (kind !== "dynamic") {
      const port = Number(destPort);
      if (!destHost.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
        onError(t("forwardDestInvalid"));
        return;
      }
      dest_host = destHost.trim();
      dest_port = port;
    }
    setBusy(true);
    try {
      await startPortForward({
        connection_id: connectionId,
        kind,
        bind_host: bindHost.trim(),
        bind_port: bind,
        dest_host,
        dest_port,
      });
    } catch (error: unknown) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function onStop(forward: PortForward) {
    setBusy(true);
    try {
      await stopPortForward(connectionId, forward.id);
      remove(forward.id);
    } catch (error: unknown) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }

  const kinds: { id: ForwardKind; label: string }[] = [
    { id: "dynamic", label: t("forwardDynamic") },
    { id: "local", label: t("forwardLocal") },
    { id: "remote", label: t("forwardRemote") },
  ];

  return (
    <div className="absolute inset-0 z-40 flex justify-end">
      <button
        aria-label={t("close")}
        className="absolute inset-0 bg-tie-overlay"
        onClick={onClose}
        type="button"
      />
      <aside className="relative flex h-full w-[min(100%,22rem)] flex-col border-l border-tie-border bg-tie-card shadow-xl">
        <header className="flex items-center justify-between border-b border-tie-border px-3 py-2">
          <h2 className="text-sm font-medium text-tie-text">{t("portForward")}</h2>
          <button
            className="rounded border border-tie-border p-1 text-tie-muted hover:text-tie-text"
            onClick={onClose}
            type="button"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex flex-col gap-3 overflow-y-auto p-3 text-[12px]">
          <div className="flex gap-1">
            {kinds.map((item) => (
              <button
                key={item.id}
                className={`flex-1 rounded border px-2 py-1.5 ${
                  kind === item.id
                    ? "border-tie-accent bg-tie-accent/10 text-tie-accent"
                    : "border-tie-border text-tie-muted"
                }`}
                onClick={() => {
                  setKind(item.id);
                  if (item.id === "dynamic") setBindPort((prev) => (prev === "80" ? "1080" : prev));
                  if (item.id === "remote") setBindHost((prev) => (prev === "127.0.0.1" ? "0.0.0.0" : prev));
                  if (item.id === "local") setBindHost((prev) => (prev === "0.0.0.0" ? "127.0.0.1" : prev));
                }}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-tie-muted">{t("forwardBindHost")}</span>
            <input
              className="rounded border border-tie-border bg-tie-bg px-2 py-1.5 font-mono"
              onChange={(event) => setBindHost(event.target.value)}
              value={bindHost}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-tie-muted">{t("forwardBindPort")}</span>
            <input
              className="rounded border border-tie-border bg-tie-bg px-2 py-1.5 font-mono"
              onChange={(event) => setBindPort(event.target.value)}
              value={bindPort}
            />
          </label>

          {kind !== "dynamic" ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-tie-muted">
                  {kind === "remote" ? t("forwardLocalHost") : t("forwardDestHost")}
                </span>
                <input
                  className="rounded border border-tie-border bg-tie-bg px-2 py-1.5 font-mono"
                  onChange={(event) => setDestHost(event.target.value)}
                  value={destHost}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-tie-muted">
                  {kind === "remote" ? t("forwardLocalPort") : t("forwardDestPort")}
                </span>
                <input
                  className="rounded border border-tie-border bg-tie-bg px-2 py-1.5 font-mono"
                  onChange={(event) => setDestPort(event.target.value)}
                  value={destPort}
                />
              </label>
            </>
          ) : (
            <p className="text-[11px] text-tie-muted">{t("forwardDynamicHint")}</p>
          )}

          <button
            className="rounded bg-tie-accent px-3 py-1.5 text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void onAdd()}
            type="button"
          >
            {t("forwardStart")}
          </button>

          <div className="mt-2 border-t border-tie-border pt-3">
            <div className="mb-2 text-tie-muted">{t("forwardActiveList")}</div>
            {forwards.length === 0 ? (
              <p className="text-tie-muted">{t("forwardEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {forwards.map((forward) => (
                  <li
                    key={forward.id}
                    className="flex items-start justify-between gap-2 rounded border border-tie-border px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-mono text-[11px]">
                        <span
                          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${forwardStatusClass(forward.status)}`}
                          title={forward.status}
                        />
                        <span className="truncate">{formatForwardSummary(forward)}</span>
                      </div>
                      {forward.error ? (
                        <p className="mt-0.5 truncate text-[10px] text-red-600 dark:text-red-400">
                          {forward.error}
                        </p>
                      ) : null}
                    </div>
                    <button
                      className="shrink-0 rounded border border-tie-border px-1.5 py-0.5 text-[11px] text-tie-muted hover:text-tie-text"
                      disabled={busy}
                      onClick={() => void onStop(forward)}
                      type="button"
                    >
                      {t("forwardStop")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function normalizeForward(item: PortForward): PortForward {
  return {
    ...item,
    kind: item.kind as ForwardKind,
    status: item.status as PortForward["status"],
  };
}
