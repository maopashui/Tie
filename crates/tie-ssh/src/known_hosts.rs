use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use russh::keys::{PublicKey, PublicKeyBase64};

use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostKeyStatus {
    Match,
    New,
    Mismatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostKeyDecision {
    AcceptAndSave,
    AcceptOnce,
    Reject,
}

#[derive(Debug, Clone)]
pub struct KnownHosts {
    path: PathBuf,
    entries: Vec<KnownHostEntry>,
}

#[derive(Debug, Clone)]
struct KnownHostEntry {
    host_pattern: String,
    key_type: String,
    key_data: String,
}

impl KnownHosts {
    pub fn default_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".ssh")
            .join("known_hosts")
    }

    pub fn load_default() -> Result<Self> {
        Self::load(Self::default_path())
    }

    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let entries = if path.exists() {
            let text = fs::read_to_string(&path)?;
            parse_known_hosts(&text)
        } else {
            Vec::new()
        };
        Ok(Self { path, entries })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn check(&self, host: &str, port: u16, key: &PublicKey) -> HostKeyStatus {
        let key_type = key.algorithm().to_string();
        let key_data = key.public_key_base64();

        let mut found_host = false;
        let mut matched = false;

        for entry in &self.entries {
            if !entry_matches_host(&entry.host_pattern, host, port) {
                continue;
            }
            found_host = true;
            if entry.key_type == key_type && entry.key_data == key_data {
                matched = true;
                break;
            }
        }

        if matched {
            HostKeyStatus::Match
        } else if found_host {
            HostKeyStatus::Mismatch
        } else {
            HostKeyStatus::New
        }
    }

    pub fn fingerprint(key: &PublicKey) -> String {
        format!("{}", key.fingerprint(russh::keys::HashAlg::Sha256))
    }

    pub fn append(&mut self, host: &str, port: u16, key: &PublicKey) -> Result<()> {
        let pattern = if port == 22 {
            host.to_string()
        } else {
            format!("[{host}]:{port}")
        };
        let entry = KnownHostEntry {
            host_pattern: pattern,
            key_type: key.algorithm().to_string(),
            key_data: key.public_key_base64(),
        };

        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        let line = format!(
            "{} {} {}\n",
            entry.host_pattern, entry.key_type, entry.key_data
        );
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        file.write_all(line.as_bytes())?;
        self.entries.push(entry);
        Ok(())
    }
}

fn parse_known_hosts(text: &str) -> Vec<KnownHostEntry> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line
            .strip_prefix("@cert-authority ")
            .or_else(|| line.strip_prefix("@revoked "))
            .unwrap_or(line);
        let mut parts = line.split_whitespace();
        let Some(host_pattern) = parts.next() else {
            continue;
        };
        // Skip hashed host entries (|1|...) for now
        if host_pattern.starts_with('|') {
            continue;
        }
        let Some(key_type) = parts.next() else {
            continue;
        };
        let Some(key_data) = parts.next() else {
            continue;
        };
        out.push(KnownHostEntry {
            host_pattern: host_pattern.to_string(),
            key_type: key_type.to_string(),
            key_data: key_data.to_string(),
        });
    }
    out
}

fn entry_matches_host(pattern: &str, host: &str, port: u16) -> bool {
    for part in pattern.split(',') {
        if part == host && port == 22 {
            return true;
        }
        if part == format!("[{host}]:{port}") {
            return true;
        }
        if let Some(suffix) = part.strip_prefix("*.") {
            if port == 22
                && host.ends_with(suffix)
                && host.len() > suffix.len()
                && host.as_bytes().get(host.len() - suffix.len() - 1) == Some(&b'.')
            {
                return true;
            }
        }
    }
    false
}
