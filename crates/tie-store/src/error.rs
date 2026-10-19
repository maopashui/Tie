use thiserror::Error;

pub type Result<T> = std::result::Result<T, StoreError>;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("keychain error: {0}")]
    Keychain(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid data: {0}")]
    Invalid(String),
    #[error("{0}")]
    Other(String),
}
