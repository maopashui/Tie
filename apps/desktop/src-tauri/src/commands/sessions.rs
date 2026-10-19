use serde::Deserialize;
use tauri::State;
use tie_store::{AuthType, CredentialStore, Folder, NewSshSession, Session, SessionKind};
use uuid::Uuid;

use crate::error::AppError;
use crate::parse::{parse_quick_connect, QuickConnect};
use crate::state::{lock, SharedState};

#[derive(Deserialize)]
pub struct CreateFolderArgs {
    pub name: String,
    pub parent_id: Option<Uuid>,
}

#[derive(Deserialize)]
pub struct CreateSshArgs {
    pub folder_id: Option<Uuid>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub key_path: Option<String>,
    pub save_password: bool,
    pub secret: Option<String>,
}

#[tauri::command]
pub fn list_workspace(state: State<SharedState>) -> Result<(Vec<Folder>, Vec<Session>), AppError> {
    let store = lock(&state.store)?;
    Ok((store.list_folders()?, store.list_sessions()?))
}

#[tauri::command]
pub fn create_folder(
    state: State<SharedState>,
    args: CreateFolderArgs,
) -> Result<Folder, AppError> {
    let name = args.name.trim();
    if name.is_empty() {
        return Err(AppError::Message(
            state.text("分组名称不能为空", "Folder name cannot be empty"),
        ));
    }
    let store = lock(&state.store)?;
    Ok(store.create_folder(name, args.parent_id)?)
}

#[derive(Deserialize)]
pub struct UpdateFolderArgs {
    pub id: Uuid,
    pub name: String,
}

#[tauri::command]
pub fn update_folder(state: State<SharedState>, args: UpdateFolderArgs) -> Result<(), AppError> {
    let name = args.name.trim();
    if name.is_empty() {
        return Err(AppError::Message(
            state.text("分组名称不能为空", "Folder name cannot be empty"),
        ));
    }
    let store = lock(&state.store)?;
    store.rename_folder(args.id, name)?;
    Ok(())
}

#[tauri::command]
pub fn delete_folder(state: State<SharedState>, id: Uuid) -> Result<(), AppError> {
    let store = lock(&state.store)?;
    store.delete_folder(id)?;
    Ok(())
}

#[tauri::command]
pub fn create_ssh_session(
    state: State<SharedState>,
    args: CreateSshArgs,
) -> Result<Session, AppError> {
    let name = args.name.trim();
    let host = args.host.trim();
    let username = args.username.trim();
    if name.is_empty() || host.is_empty() || username.is_empty() {
        return Err(AppError::Message(state.text(
            "名称、主机和用户名不能为空",
            "Name, host, and username cannot be empty",
        )));
    }
    if args.port == 0 {
        return Err(AppError::Message(state.text("端口无效", "Invalid port")));
    }
    if args.auth_type == AuthType::PrivateKey
        && args.key_path.as_deref().unwrap_or("").trim().is_empty()
    {
        return Err(AppError::Message(
            state.text("私钥路径不能为空", "Private key path cannot be empty"),
        ));
    }
    let session = {
        let store = lock(&state.store)?;
        store.create_ssh_session(NewSshSession {
            folder_id: args.folder_id,
            name: name.to_string(),
            host: host.to_string(),
            port: args.port,
            username: username.to_string(),
            auth_type: args.auth_type,
            key_path: args
                .key_path
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty()),
            save_password: args.save_password,
        })?
    };
    if args.save_password {
        if let Some(secret) = args.secret.filter(|s| !s.is_empty()) {
            CredentialStore::save_password(&session.id, &secret)?;
        }
    }
    Ok(session)
}

#[derive(Deserialize)]
pub struct UpdateSshArgs {
    pub id: Uuid,
    pub folder_id: Option<Uuid>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub key_path: Option<String>,
    pub save_password: bool,
    pub secret: Option<String>,
}

#[tauri::command]
pub fn update_ssh_session(
    state: State<SharedState>,
    args: UpdateSshArgs,
) -> Result<Session, AppError> {
    let name = args.name.trim();
    let host = args.host.trim();
    let username = args.username.trim();
    if name.is_empty() || host.is_empty() || username.is_empty() {
        return Err(AppError::Message(state.text(
            "名称、主机和用户名不能为空",
            "Name, host, and username cannot be empty",
        )));
    }
    if args.port == 0 {
        return Err(AppError::Message(state.text("端口无效", "Invalid port")));
    }
    if args.auth_type == AuthType::PrivateKey
        && args.key_path.as_deref().unwrap_or("").trim().is_empty()
    {
        return Err(AppError::Message(
            state.text("私钥路径不能为空", "Private key path cannot be empty"),
        ));
    }
    let session = {
        let store = lock(&state.store)?;
        let mut session = store.get_session(args.id)?;
        if session.kind != SessionKind::Ssh {
            return Err(AppError::Message(
                state.text("只能编辑远程主机", "Only remote hosts can be edited"),
            ));
        }
        if store.ssh_identity_exists(name, host, args.port, username, Some(session.id))? {
            return Err(AppError::Message(
                state.text("已存在该连接信息", "This connection already exists"),
            ));
        }
        session.folder_id = args.folder_id;
        session.name = name.to_string();
        session.host = Some(host.to_string());
        session.port = Some(args.port);
        session.username = Some(username.to_string());
        session.auth_type = Some(args.auth_type);
        session.key_path = args
            .key_path
            .map(|path| path.trim().to_string())
            .filter(|path| !path.is_empty());
        session.save_password = args.save_password;
        store.update_session(&session)?;
        session
    };
    if args.save_password {
        if let Some(secret) = args.secret.filter(|secret| !secret.is_empty()) {
            CredentialStore::save_password(&session.id, &secret)?;
        }
    } else {
        let _ = CredentialStore::delete_password(&session.id);
    }
    Ok(session)
}

#[tauri::command]
pub fn delete_session(state: State<SharedState>, id: Uuid) -> Result<(), AppError> {
    let kind = {
        let store = lock(&state.store)?;
        let session = store.get_session(id)?;
        store.delete_session(id)?;
        session.kind
    };
    if kind == SessionKind::Ssh {
        let _ = CredentialStore::delete_password(&id);
        if let Ok(mut secrets) = lock(&state.secrets) {
            secrets.remove(&id);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn parse_quick(state: State<SharedState>, input: String) -> Result<QuickConnect, AppError> {
    parse_quick_connect(input.trim()).map_err(|err| AppError::Message(err.localize(state.locale())))
}
