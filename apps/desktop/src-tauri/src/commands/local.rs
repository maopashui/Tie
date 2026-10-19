use tauri::{AppHandle, State};
use tie_pty::LocalShellKind;
use tie_store::{LocalSubtype, SessionKind};
use uuid::Uuid;

use crate::error::AppError;
use crate::local_term::spawn_local_connection;
use crate::state::{lock, SharedState};

#[derive(serde::Deserialize)]
pub struct StartLocalArgs {
    pub session_id: Uuid,
    pub cols: u32,
    pub rows: u32,
}

#[tauri::command]
pub fn start_local(
    app: AppHandle,
    state: State<SharedState>,
    args: StartLocalArgs,
) -> Result<Uuid, AppError> {
    let session = {
        let store = lock(&state.store)?;
        store.get_session(args.session_id)?
    };
    if session.kind != SessionKind::Local {
        return Err(AppError::Message(
            state.text("这不是本地会话", "This is not a local session"),
        ));
    }
    let subtype = session.local_subtype.ok_or_else(|| {
        AppError::Message(state.text("本地会话缺少类型", "The local session is missing a type"))
    })?;
    if !local_shell_allowed(subtype) {
        return Err(AppError::Message(state.text(
            "macOS 仅支持 Local Shell",
            "macOS only supports Local Shell",
        )));
    }
    let kind = match subtype {
        LocalSubtype::DefaultShell => LocalShellKind::DefaultShell,
        LocalSubtype::Powershell => LocalShellKind::Powershell,
        LocalSubtype::Wsl => LocalShellKind::Wsl,
    };
    let connection_id = Uuid::new_v4();
    spawn_local_connection(
        app,
        state.inner().clone(),
        connection_id,
        session.id,
        kind,
        args.cols,
        args.rows,
    )?;
    Ok(connection_id)
}

fn local_shell_allowed(subtype: LocalSubtype) -> bool {
    #[cfg(target_os = "macos")]
    {
        subtype == LocalSubtype::DefaultShell
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = subtype;
        true
    }
}
