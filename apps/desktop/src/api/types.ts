export type SessionKind = "ssh" | "local";
export type AuthType = "password" | "private_key";
export type LocalSubtype = "default_shell" | "wsl" | "powershell";

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  sort: number;
  system_key: string | null;
}

export interface Session {
  id: string;
  folder_id: string | null;
  name: string;
  kind: SessionKind;
  host: string | null;
  port: number | null;
  username: string | null;
  auth_type: AuthType | null;
  key_path: string | null;
  save_password: boolean;
  local_subtype: LocalSubtype | null;
  extra_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  permissions: number | null;
  mtime: number | null;
  owner: string | null;
}

export interface TransferRecord {
  id: string;
  session_id: string | null;
  direction: string;
  local_path: string;
  remote_path: string;
  bytes: number;
  status: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface QuickConnect {
  username: string;
  host: string;
  port: number;
  key_path: string | null;
}

export interface HostKeyEvent {
  connection_id: string;
  host: string;
  port: number;
  status: "new" | "mismatch" | "match";
  fingerprint: string;
}

export interface ConnectionEvent {
  connection_id: string;
  state: "connected" | "failed" | "disconnected";
  message: string;
  host: string;
  port: number;
  username: string;
}

export interface TerminalDataEvent {
  connection_id: string;
  data_base64: string;
}

export interface TransferEvent {
  id: string;
  connection_id: string;
  session_id: string;
  direction: "upload" | "download";
  name: string;
  local_path: string;
  remote_path: string;
  transferred: number;
  total: number;
  bytes_per_sec: number;
  status: "running" | "completed" | "failed" | "cancelled";
  error: string | null;
}

export type ForwardKind = "local" | "remote" | "dynamic";
export type ForwardStatus = "starting" | "active" | "error" | "stopped";

export interface PortForward {
  id: string;
  connection_id: string;
  kind: ForwardKind;
  bind_host: string;
  bind_port: number;
  dest_host: string | null;
  dest_port: number | null;
  status: ForwardStatus;
  error: string | null;
}
