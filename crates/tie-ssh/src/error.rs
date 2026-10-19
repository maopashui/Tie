use thiserror::Error;

pub type Result<T> = std::result::Result<T, SshError>;

#[derive(Debug, Error)]
pub enum SshError {
    #[error("ssh error: {0}")]
    Russh(#[from] russh::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("auth failed: {0}")]
    Auth(String),
    #[error("host key rejected: {0}")]
    HostKey(String),
    #[error("sftp error: {0}")]
    Sftp(String),
    #[error("key error: {0}")]
    Key(String),
    #[error("{0}")]
    Other(String),
}
