import { respondHostKey } from "../api/commands";
import type { HostKeyEvent } from "../api/types";
import { useT } from "../i18n";
import { useWorkspace } from "../stores/workspace";

export function HostKeyDialog({ prompt }: { prompt: HostKeyEvent }) {
  const setHostKey = useWorkspace((state) => state.setHostKey);
  const t = useT();
  const setBanner = useWorkspace((state) => state.setBanner);
  const mismatch = prompt.status === "mismatch";

  async function choose(decision: "accept_and_save" | "accept_once" | "reject") {
    try {
      await respondHostKey(prompt.connection_id, decision);
      setHostKey(null);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/40">
      <div className="w-[440px] rounded border border-slate-200 bg-white p-3 text-[11px] shadow-lg">
        <div className={`font-semibold ${mismatch ? "text-red-600" : "text-amber-700"}`}>
          {mismatch ? t("hostKeyMismatch") : t("hostKeyNew")}
        </div>
        <p className="mt-2 text-slate-600">
          {prompt.host}:{prompt.port}
        </p>
        <p className="mt-1 break-all font-mono text-slate-800">{prompt.fingerprint}</p>
        <p className="mt-2 text-slate-500">{t("hostKeyHint")}</p>
        <div className="mt-3 flex justify-end gap-2">
          <button className="rounded border border-slate-300 px-2 py-1" onClick={() => void choose("reject")} type="button">
            {t("reject")}
          </button>
          <button className="rounded border border-slate-300 px-2 py-1" onClick={() => void choose("accept_once")} type="button">
            {t("acceptOnce")}
          </button>
          <button className="rounded bg-slate-900 px-2 py-1 text-white" onClick={() => void choose("accept_and_save")} type="button">
            {t("acceptAndSave")}
          </button>
        </div>
      </div>
    </div>
  );
}
