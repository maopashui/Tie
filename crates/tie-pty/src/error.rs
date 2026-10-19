use thiserror::Error;

pub type Result<T> = std::result::Result<T, PtyError>;

#[derive(Debug, Error)]
pub enum PtyError {
    #[error("pty error: {0}")]
    Pty(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("not available on this platform: {0}")]
    Unavailable(String),
    #[error("{0}")]
    Other(String),
}
