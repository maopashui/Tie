mod error;
mod keychain;
mod models;
mod paths;
mod store;

pub use error::{Result, StoreError};
pub use keychain::CredentialStore;
// re-export for app convenience
pub use models::*;
pub use paths::{app_data_dir, known_hosts_path};
pub use store::Store;
