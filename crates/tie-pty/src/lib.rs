mod caps;
mod error;
mod local;

pub use caps::{LocalShellKind, PlatformCaps};
pub use error::{PtyError, Result};
pub use local::{LocalPty, PtyReader, PtyWriter};
