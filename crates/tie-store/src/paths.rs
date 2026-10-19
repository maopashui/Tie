use std::path::PathBuf;

use crate::error::{Result, StoreError};

/// Application data directory.
/// macOS: ~/Library/Application Support/Tie
/// Windows: %APPDATA%/Tie
/// Linux: ~/.local/share/Tie
pub fn app_data_dir() -> Result<PathBuf> {
    let base = dirs::data_dir()
        .ok_or_else(|| StoreError::Other("cannot resolve application data directory".into()))?;
    let dir = base.join("Tie");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn database_path() -> Result<PathBuf> {
    Ok(app_data_dir()?.join("sessions.db"))
}

pub fn known_hosts_path() -> Result<PathBuf> {
    Ok(app_data_dir()?.join("known_hosts"))
}
