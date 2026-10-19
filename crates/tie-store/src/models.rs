use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    Ssh,
    Local,
}

impl SessionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ssh => "ssh",
            Self::Local => "local",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "ssh" => Some(Self::Ssh),
            "local" => Some(Self::Local),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    Password,
    PrivateKey,
}

impl AuthType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::PrivateKey => "private_key",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "password" => Some(Self::Password),
            "private_key" => Some(Self::PrivateKey),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalSubtype {
    DefaultShell,
    Wsl,
    Powershell,
}

impl LocalSubtype {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DefaultShell => "default_shell",
            Self::Wsl => "wsl",
            Self::Powershell => "powershell",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "default_shell" => Some(Self::DefaultShell),
            "wsl" => Some(Self::Wsl),
            "powershell" => Some(Self::Powershell),
            _ => None,
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::DefaultShell => "Local Shell",
            Self::Wsl => "WSL",
            Self::Powershell => "PowerShell",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
    pub sort: i64,
    /// `local` marks the fixed local-shell group. SSH sessions cannot use it.
    pub system_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: Uuid,
    pub folder_id: Option<Uuid>,
    pub name: String,
    pub kind: SessionKind,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub auth_type: Option<AuthType>,
    pub key_path: Option<String>,
    pub save_password: bool,
    pub local_subtype: Option<LocalSubtype>,
    pub extra_json: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct NewSshSession {
    pub folder_id: Option<Uuid>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub key_path: Option<String>,
    pub save_password: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRecord {
    pub id: Uuid,
    pub session_id: Option<Uuid>,
    pub direction: String,
    pub local_path: String,
    pub remote_path: String,
    pub bytes: u64,
    pub status: String,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct NewTransfer {
    pub id: Uuid,
    pub session_id: Option<Uuid>,
    pub direction: String,
    pub local_path: String,
    pub remote_path: String,
    pub bytes: u64,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewLocalSession {
    pub folder_id: Option<Uuid>,
    pub name: String,
    pub subtype: LocalSubtype,
    pub extra_json: Option<String>,
}
