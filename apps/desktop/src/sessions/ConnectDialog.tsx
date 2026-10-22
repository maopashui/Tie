import { useEffect, useState, type ReactNode } from "react";
import { createSshSession, updateSshSession } from "../api/commands";
import type { Folder, Session } from "../api/types";
import { useT } from "../i18n";
import { useWorkspace } from "../stores/workspace";

export function ConnectDialog({
  folders,
  initial,
  session,
  onClose,
  onCreated,
}: {
  folders: Folder[];
  initial?: { name?: string; host?: string; port?: number; username?: string; keyPath?: string };
  session?: Session;
  onClose: () => void;
  onCreated: (sessionId: string, secret: string | null, connect: boolean) => void;
}) {
  const t = useT();
  const setBanner = useWorkspace((state) => state.setBanner);
  const sessions = useWorkspace((state) => state.sessions);
  const [name, setName] = useState(session?.name ?? initial?.name ?? "");
  const [host, setHost] = useState(session?.host ?? initial?.host ?? "");
  const [port, setPort] = useState(
    session?.port != null ? String(session.port) : initial?.port != null ? String(initial.port) : "",
  );
  const [username, setUsername] = useState(session?.username ?? initial?.username ?? "");
  const [authType, setAuthType] = useState<"password" | "private_key">(
    session?.auth_type ?? (initial?.keyPath ? "private_key" : "password"),
  );
  const [keyPath, setKeyPath] = useState(session?.key_path ?? initial?.keyPath ?? "");
  const [secret, setSecret] = useState("");
  const [savePassword, setSavePassword] = useState(session?.save_password ?? false);
  const groupChoices = folders.filter((folder) => folder.system_key !== "local");
  const [folderId, setFolderId] = useState(session?.folder_id ?? "");
  useEffect(() => {
    const choices = folders.filter((folder) => folder.system_key !== "local");
    if (session) {
      if (folderId && !choices.some((folder) => folder.id === folderId)) setFolderId("");
      return;
    }
    if (!choices.some((folder) => folder.id === folderId)) {
      setFolderId(choices[0]?.id ?? "");
    }
  }, [folders, folderId, session]);
  const [busy, setBusy] = useState(false);

  function validate(connect: boolean) {
    const portNumber = Number(port);
    if (!name.trim() || !host.trim() || !username.trim()) {
      return t("fillRequired");
    }
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      return t("portRange");
    }
    if (authType === "private_key" && !keyPath.trim()) {
      return t("fillKeyPath");
    }
    const keepsStoredPassword = Boolean(session?.save_password) && savePassword && !secret;
    if (connect && authType === "password" && !secret && !keepsStoredPassword) {
      return t("passwordRequiredToConnect");
    }
    const trimmedName = name.trim();
    const trimmedHost = host.trim();
    const trimmedUser = username.trim();
    const duplicate = sessions.some(
      (item) =>
        item.id !== session?.id &&
        item.kind === "ssh" &&
        item.name === trimmedName &&
        item.host === trimmedHost &&
        item.port === portNumber &&
        item.username === trimmedUser,
    );
    if (duplicate) return t("duplicateSession");
    return null;
  }

  async function submit(connect: boolean) {
    const message = validate(connect);
    if (message) {
      setBanner(message);
      return;
    }
    setBusy(true);
    try {
      const keepSaved = savePassword && (secret.length > 0 || Boolean(session?.save_password));
      const fields = {
        folder_id: folderId || null,
        name: name.trim(),
        host: host.trim(),
        port: Number(port),
        username: username.trim(),
        auth_type: authType,
        key_path: authType === "private_key" ? keyPath.trim() : null,
        save_password: keepSaved,
        secret: secret || null,
      };
      const saved = session
        ? await updateSshSession({ id: session.id, ...fields })
        : await createSshSession(fields);
      onCreated(saved.id, connect && !keepSaved ? secret || null : null, connect);
    } catch (caught) {
      setBanner(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={session ? t("editSession") : t("newSession")} onClose={onClose}>
      <label className="grid gap-1">
        {t("name")}
        <input
          autoCapitalize="off"
          autoComplete="off"
          className={fieldClass}
          spellCheck={false}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_4.5rem] gap-2">
        <label className="grid min-w-0 gap-1">
          {t("host")}
          <input
            autoCapitalize="off"
            autoComplete="off"
            className={fieldClass}
            placeholder={t("hostPlaceholder")}
            spellCheck={false}
            value={host}
            onChange={(event) => setHost(event.target.value)}
          />
        </label>
        <label className="grid min-w-0 gap-1">
          {t("port")}
          <input
            className={fieldClass}
            placeholder="22"
            value={port}
            onChange={(event) => setPort(event.target.value)}
          />
        </label>
      </div>
      <label className="grid gap-1">
        {t("username")}
        <input
          autoCapitalize="off"
          autoComplete="off"
          className={fieldClass}
          placeholder={t("username")}
          spellCheck={false}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label className="grid gap-1">
        {t("group")}
        <select className={fieldClass} value={folderId} onChange={(event) => setFolderId(event.target.value)}>
          <option value="">{t("ungrouped")}</option>
          {groupChoices.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        {t("auth")}
        <select
          className={fieldClass}
          value={authType}
          onChange={(event) => setAuthType(event.target.value as "password" | "private_key")}
        >
          <option value="password">{t("password")}</option>
          <option value="private_key">{t("privateKey")}</option>
        </select>
      </label>
      {authType === "private_key" ? (
        <label className="grid gap-1">
          {t("keyPath")}
          <input className={fieldClass} value={keyPath} onChange={(event) => setKeyPath(event.target.value)} />
        </label>
      ) : null}
      <label className="grid gap-1">
        {authType === "password" ? t("password") : t("passphrase")}
        <input
          className={fieldClass}
          placeholder={session?.save_password ? t("keepSavedSecret") : undefined}
          type="password"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={savePassword}
          onChange={(event) => setSavePassword(event.target.checked)}
        />
        {t("saveToKeychain")}
      </label>
      <div className="flex justify-end gap-2">
        <button className="rounded border border-tie-border px-3 py-1" onClick={onClose} type="button">
          {t("cancel")}
        </button>
        <button
          className="rounded border border-tie-border px-3 py-1 disabled:opacity-50"
          disabled={busy}
          onClick={() => void submit(false)}
          type="button"
        >
          {t("save")}
        </button>
        <button
          className="rounded bg-tie-accent px-3 py-1 text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => void submit(true)}
          type="button"
        >
          {t("saveAndConnect")}
        </button>
      </div>
    </Modal>
  );
}

export function SecretDialog({
  title,
  hint,
  onClose,
  onSubmit,
}: {
  title: string;
  hint?: string | null;
  onClose: () => void;
  onSubmit: (secret: string) => void;
}) {
  const t = useT();
  const [secret, setSecret] = useState("");
  return (
    <Modal title={title} onClose={onClose} onSubmit={() => onSubmit(secret)}>
      {hint ? <p className="text-red-600">{hint}</p> : null}
      <input
        autoFocus
        className={fieldClass}
        type="password"
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        <button className="rounded border border-tie-border px-3 py-1" onClick={onClose} type="button">
          {t("cancel")}
        </button>
        <button className="rounded bg-tie-accent px-3 py-1 text-white" type="submit">
          {t("connect")}
        </button>
      </div>
    </Modal>
  );
}

export function NameDialog({
  title,
  initial = "",
  confirmLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: string;
  confirmLabel?: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial);
  return (
    <Modal title={title} onClose={onClose} onSubmit={() => onSubmit(name.trim())}>
      <input
        autoFocus
        className={fieldClass}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="flex justify-end">
        <button className="rounded bg-tie-accent px-3 py-1 text-white" type="submit">
          {confirmLabel ?? t("create")}
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit?: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-tie-overlay">
      <form
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="grid w-[380px] gap-2 rounded border border-tie-border bg-tie-card p-3 text-[11px] shadow-lg"
        spellCheck={false}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.();
        }}
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold text-tie-text">{title}</span>
          <button className="text-tie-muted" onClick={onClose} type="button">
            {t("close")}
          </button>
        </div>
        {children}
      </form>
    </div>
  );
}

const fieldClass =
  "w-full min-w-0 rounded border border-tie-border bg-tie-surface px-2 py-1 font-mono text-[11px] outline-none focus:border-tie-accent";
