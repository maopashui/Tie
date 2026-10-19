use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use tie_store::Store;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::i18n::{text, Locale};
use crate::session::LiveHandle;

pub struct TransferCtrl {
    pub connection_id: Uuid,
    pub cancel: Arc<AtomicBool>,
}

pub struct AppState {
    pub store: Mutex<Store>,
    pub live: Mutex<HashMap<Uuid, LiveHandle>>,
    pub host_keys: Mutex<HashMap<Uuid, oneshot::Sender<tie_ssh::HostKeyDecision>>>,
    pub cancels: Mutex<HashMap<Uuid, oneshot::Sender<()>>>,
    pub transfers: Mutex<HashMap<Uuid, TransferCtrl>>,
    /// Password or key passphrase accepted for a session during this run.
    pub secrets: Mutex<HashMap<Uuid, String>>,
    /// Sessions started from the quick-connect bar. Never written to the host list.
    pub ephemeral: Mutex<HashSet<Uuid>>,
    pub locale: Mutex<Locale>,
}

impl AppState {
    pub fn new(store: Store) -> Self {
        Self {
            store: Mutex::new(store),
            live: Mutex::new(HashMap::new()),
            host_keys: Mutex::new(HashMap::new()),
            cancels: Mutex::new(HashMap::new()),
            transfers: Mutex::new(HashMap::new()),
            secrets: Mutex::new(HashMap::new()),
            ephemeral: Mutex::new(HashSet::new()),
            locale: Mutex::new(Locale::system()),
        }
    }

    pub fn locale(&self) -> Locale {
        match self.locale.lock() {
            Ok(guard) => *guard,
            Err(poisoned) => *poisoned.into_inner(),
        }
    }

    pub fn set_locale(&self, locale: Locale) {
        match self.locale.lock() {
            Ok(mut guard) => *guard = locale,
            Err(poisoned) => *poisoned.into_inner() = locale,
        }
    }

    pub fn text(&self, zh: &str, en: &str) -> String {
        text(self.locale(), zh, en)
    }
}

pub type SharedState = Arc<AppState>;

pub fn lock<'a, T>(
    mutex: &'a Mutex<T>,
) -> Result<std::sync::MutexGuard<'a, T>, crate::error::AppError> {
    mutex
        .lock()
        .map_err(|_| crate::error::AppError::Message("internal lock poisoned".into()))
}
