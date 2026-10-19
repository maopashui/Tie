import { invoke } from "@tauri-apps/api/core";
import type {
  FileEntry,
  Folder,
  QuickConnect,
  Session,
  TransferRecord,
} from "./types";

export function listWorkspace() {
  return invoke<[Folder[], Session[]]>("list_workspace");
}

export function createFolder(name: string, parentId: string | null) {
  return invoke<Folder>("create_folder", { args: { name, parent_id: parentId } });
}

export function updateFolder(id: string, name: string) {
  return invoke<void>("update_folder", { args: { id, name } });
}

export function deleteFolder(id: string) {
  return invoke<void>("delete_folder", { id });
}

export function createSshSession(args: {
  folder_id: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "private_key";
  key_path: string | null;
  save_password: boolean;
  secret: string | null;
}) {
  return invoke<Session>("create_ssh_session", { args });
}

export function updateSshSession(args: {
  id: string;
  folder_id: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "private_key";
  key_path: string | null;
  save_password: boolean;
  secret: string | null;
}) {
  return invoke<Session>("update_ssh_session", { args });
}

export function deleteSession(id: string) {
  return invoke<void>("delete_session", { id });
}

export function parseQuick(input: string) {
  return invoke<QuickConnect>("parse_quick", { input });
}

export function startLocal(sessionId: string, cols: number, rows: number) {
  return invoke<string>("start_local", {
    args: { session_id: sessionId, cols, rows },
  });
}

export function startSsh(sessionId: string, secret: string | null, cols: number, rows: number) {
  return invoke<string>("start_ssh", {
    args: { session_id: sessionId, secret, cols, rows },
  });
}

export function startEphemeralSsh(args: {
  session_id: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "private_key";
  key_path: string | null;
  secret: string | null;
  cols: number;
  rows: number;
}) {
  return invoke<string>("start_ephemeral_ssh", { args });
}

export function respondHostKey(connectionId: string, decision: string) {
  return invoke<void>("respond_host_key", {
    args: { connection_id: connectionId, decision },
  });
}

export function writeTerminal(connectionId: string, data: number[]) {
  return invoke<void>("write_terminal", { connectionId, data });
}

export function resizeTerminal(connectionId: string, cols: number, rows: number) {
  return invoke<void>("resize_terminal", { connectionId, cols, rows });
}

export function disconnect(connectionId: string) {
  return invoke<void>("disconnect", { connectionId });
}

export function sftpList(connectionId: string, path: string) {
  return invoke<FileEntry[]>("sftp_list", { args: { connection_id: connectionId, path } });
}

export function sftpMkdir(connectionId: string, path: string) {
  return invoke<void>("sftp_mkdir", { args: { connection_id: connectionId, path } });
}

export function sftpRemove(connectionId: string, path: string, isDir: boolean) {
  return invoke<void>("sftp_remove", {
    args: { connection_id: connectionId, path, is_dir: isDir },
  });
}

export function startUpload(connectionId: string, localPath: string, remotePath: string) {
  return invoke<string>("start_upload", {
    args: { connection_id: connectionId, local_path: localPath, remote_path: remotePath },
  });
}

export function startDownload(connectionId: string, localPath: string, remotePath: string) {
  return invoke<string>("start_download", {
    args: { connection_id: connectionId, local_path: localPath, remote_path: remotePath },
  });
}

export function cancelTransfer(id: string) {
  return invoke<void>("cancel_transfer", { id });
}

export function listTransferHistory() {
  return invoke<TransferRecord[]>("list_transfer_history");
}

export function listLocal(path: string) {
  return invoke<FileEntry[]>("list_local", { args: { path } });
}

export function makeLocalDir(path: string) {
  return invoke<void>("make_local_dir", { args: { path } });
}

export function removeLocal(path: string, isDir: boolean) {
  return invoke<void>("remove_local", { args: { path, is_dir: isDir } });
}

export function homeDir() {
  return invoke<string>("home_dir");
}

export function setLocale(locale: "zh-CN" | "en") {
  return invoke<void>("set_locale", { locale });
}

export function appendSessionLog(path: string, index: number, data: string) {
  return invoke<{ index: number; path: string }>("append_session_log", {
    args: { path, index, data },
  });
}
