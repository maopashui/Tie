use std::path::PathBuf;

#[derive(Clone)]
pub enum AuthMethod {
    Password(String),
    PrivateKey {
        path: PathBuf,
        passphrase: Option<String>,
    },
}

impl std::fmt::Debug for AuthMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Password(_) => f.write_str("Password([redacted])"),
            Self::PrivateKey { path, passphrase } => f
                .debug_struct("PrivateKey")
                .field("path", path)
                .field("passphrase", &passphrase.as_ref().map(|_| "[redacted]"))
                .finish(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConnectRequest {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    /// Application-owned known_hosts file. Tie does not write `~/.ssh/known_hosts`.
    pub known_hosts_path: PathBuf,
}
