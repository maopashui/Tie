use keyring::Entry;

use crate::error::{Result, StoreError};

const SERVICE: &str = "Tie SSH Client";

pub struct CredentialStore;

impl CredentialStore {
    fn entry(session_id: &str) -> Result<Entry> {
        Entry::new(SERVICE, &format!("tie/{session_id}"))
            .map_err(|e| StoreError::Keychain(e.to_string()))
    }

    pub fn save_password(session_id: &uuid::Uuid, password: &str) -> Result<()> {
        Self::entry(&session_id.to_string())?
            .set_password(password)
            .map_err(|e| StoreError::Keychain(e.to_string()))
    }

    pub fn load_password(session_id: &uuid::Uuid) -> Result<Option<String>> {
        match Self::entry(&session_id.to_string())?.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(StoreError::Keychain(e.to_string())),
        }
    }

    pub fn delete_password(session_id: &uuid::Uuid) -> Result<()> {
        match Self::entry(&session_id.to_string())?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(StoreError::Keychain(e.to_string())),
        }
    }
}
