use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use serde::Deserialize;
use tauri::{AppHandle, State};
use tie_store::{AuthType, Session, SessionKind};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::error::AppError;
use crate::session::{
    expand_path, sftp_call, spawn_connection, FileEntry, SftpCommand, ShellCommand, StartArgs,
    TransferJob,
};
use crate::state::{lock, SharedState, TransferCtrl};

#[derive(Deserialize)]
pub struct StartSshArgs {
    pub session_id: Uuid,
    pub secret: Option<String>,
    pub cols: u32,
    pub rows: u32,
}

#[derive(Deserialize)]
pub struct HostKeyArgs {
    pub connection_id: Uuid,
    pub decision: String,
}

#[tauri::command]
pub fn start_ssh(
    app: AppHandle,
    state: State<SharedState>,
    args: StartSshArgs,
) -> Result<Uuid, AppError> {
    let session = {
        let store = lock(&state.store)?;
        store.get_session(args.session_id)?
    };
    if session.kind != SessionKind::Ssh {
        return Err(AppError::Message(
            state.text("本地终端尚未接入", "Local terminal is not available yet"),
        ));
    }
    let connection_id = Uuid::new_v4();
    spawn_connection(
        app,
        state.inner().clone(),
        StartArgs {
            connection_id,
            session,
            secret: args.secret,
            cols: args.cols,
            rows: args.rows,
            ephemeral: false,
        },
    )?;
    Ok(connection_id)
}

#[derive(Deserialize)]
pub struct StartEphemeralArgs {
    pub session_id: Uuid,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub key_path: Option<String>,
    pub secret: Option<String>,
    pub cols: u32,
    pub rows: u32,
}

#[tauri::command]
pub fn start_ephemeral_ssh(
    app: AppHandle,
    state: State<SharedState>,
    args: StartEphemeralArgs,
) -> Result<Uuid, AppError> {
    let host = args.host.trim();
    let username = args.username.trim();
    if host.is_empty() || username.is_empty() {
        return Err(AppError::Message(state.text(
            "请输入 user@host 或 user@host:port",
            "Enter user@host or user@host:port",
        )));
    }
    if args.port == 0 {
        return Err(AppError::Message(state.text(
            "端口必须是 1 到 65535 的整数",
            "Port must be an integer from 1 to 65535",
        )));
    }
    let key_path = args
        .key_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());
    if args.auth_type == AuthType::PrivateKey && key_path.is_none() {
        return Err(AppError::Message(
            state.text("需要私钥路径", "A private key path is required"),
        ));
    }
    let now = chrono::Utc::now();
    let session = Session {
        id: args.session_id,
        folder_id: None,
        name: format!("{username}@{host}"),
        kind: SessionKind::Ssh,
        host: Some(host.to_string()),
        port: Some(args.port),
        username: Some(username.to_string()),
        auth_type: Some(args.auth_type),
        key_path,
        save_password: false,
        local_subtype: None,
        extra_json: None,
        created_at: now,
        updated_at: now,
    };
    let connection_id = Uuid::new_v4();
    spawn_connection(
        app,
        state.inner().clone(),
        StartArgs {
            connection_id,
            session,
            secret: args.secret,
            cols: args.cols,
            rows: args.rows,
            ephemeral: true,
        },
    )?;
    Ok(connection_id)
}

#[tauri::command]
pub fn respond_host_key(state: State<SharedState>, args: HostKeyArgs) -> Result<(), AppError> {
    let decision = match args.decision.as_str() {
        "accept_and_save" => tie_ssh::HostKeyDecision::AcceptAndSave,
        "accept_once" => tie_ssh::HostKeyDecision::AcceptOnce,
        "reject" => tie_ssh::HostKeyDecision::Reject,
        _ => {
            return Err(AppError::Message(
                state.text("无效的主机密钥决定", "Invalid host key decision"),
            ))
        }
    };
    let tx = lock(&state.host_keys)?
        .remove(&args.connection_id)
        .ok_or_else(|| {
            AppError::Message(
                state.text("没有等待中的主机密钥确认", "No host key prompt is waiting"),
            )
        })?;
    tx.send(decision)
        .map_err(|_| AppError::Message(state.text("连接已结束", "The connection has ended")))?;
    Ok(())
}

#[tauri::command]
pub fn write_terminal(
    state: State<SharedState>,
    connection_id: Uuid,
    data: Vec<u8>,
) -> Result<(), AppError> {
    if data.len() > 1024 * 1024 {
        return Err(AppError::Message(
            state.text("单次输入超过 1MiB", "A single input exceeds 1MiB"),
        ));
    }
    let live = lock(&state.live)?;
    let handle = live
        .get(&connection_id)
        .ok_or_else(|| AppError::Message(state.text("连接不存在", "Connection not found")))?;
    handle
        .shell_tx
        .send(ShellCommand::Write(data))
        .map_err(|_| {
            AppError::Message(state.text("终端通道已关闭", "The terminal channel is closed"))
        })?;
    Ok(())
}

#[tauri::command]
pub fn resize_terminal(
    state: State<SharedState>,
    connection_id: Uuid,
    cols: u32,
    rows: u32,
) -> Result<(), AppError> {
    if cols == 0 || rows == 0 || cols > 1000 || rows > 1000 {
        return Err(AppError::Message(
            state.text("终端尺寸无效", "Invalid terminal size"),
        ));
    }
    let live = lock(&state.live)?;
    let handle = live
        .get(&connection_id)
        .ok_or_else(|| AppError::Message(state.text("连接不存在", "Connection not found")))?;
    handle
        .shell_tx
        .send(ShellCommand::Resize { cols, rows })
        .map_err(|_| {
            AppError::Message(state.text("终端通道已关闭", "The terminal channel is closed"))
        })?;
    Ok(())
}

#[tauri::command]
pub fn disconnect(state: State<SharedState>, connection_id: Uuid) -> Result<(), AppError> {
    if let Some(tx) = lock(&state.cancels)?.remove(&connection_id) {
        let _ = tx.send(());
    }
    if let Some(tx) = lock(&state.host_keys)?.remove(&connection_id) {
        let _ = tx.send(tie_ssh::HostKeyDecision::Reject);
    }
    if let Some(handle) = lock(&state.live)?.get(&connection_id) {
        let _ = handle.shell_tx.send(ShellCommand::Close);
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct PathArgs {
    pub connection_id: Uuid,
    pub path: String,
}

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, SharedState>,
    args: PathArgs,
) -> Result<Vec<FileEntry>, AppError> {
    let path = validate_remote(&args.path, state.locale())?;
    let tx = {
        let live = lock(&state.live)?;
        live.get(&args.connection_id)
            .ok_or_else(|| AppError::Message(state.text("连接不存在", "Connection not found")))?
            .sftp_tx
            .clone()
    };
    let (reply, rx) = oneshot::channel();
    sftp_call(state.locale(), &tx, SftpCommand::List { path, reply }, rx).await
}

#[tauri::command]
pub async fn sftp_mkdir(state: State<'_, SharedState>, args: PathArgs) -> Result<(), AppError> {
    let path = validate_remote(&args.path, state.locale())?;
    let tx = sftp_tx(&state, args.connection_id)?;
    let (reply, rx) = oneshot::channel();
    sftp_call(state.locale(), &tx, SftpCommand::Mkdir { path, reply }, rx).await
}

#[derive(Deserialize)]
pub struct RemoveArgs {
    pub connection_id: Uuid,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub async fn sftp_remove(state: State<'_, SharedState>, args: RemoveArgs) -> Result<(), AppError> {
    let path = validate_remote(&args.path, state.locale())?;
    if path == "/" {
        return Err(AppError::Message(
            state.text("不能删除根目录", "The root directory cannot be deleted"),
        ));
    }
    let tx = sftp_tx(&state, args.connection_id)?;
    let (reply, rx) = oneshot::channel();
    sftp_call(
        state.locale(),
        &tx,
        SftpCommand::Remove {
            path,
            is_dir: args.is_dir,
            reply,
        },
        rx,
    )
    .await
}

#[derive(Deserialize)]
pub struct TransferArgs {
    pub connection_id: Uuid,
    pub local_path: String,
    pub remote_path: String,
}

#[tauri::command]
pub fn start_upload(state: State<SharedState>, args: TransferArgs) -> Result<Uuid, AppError> {
    let local = expand_path(&args.local_path);
    if !local.is_file() {
        return Err(AppError::Message(
            state.text("本地文件不存在", "The local file does not exist"),
        ));
    }
    let remote = validate_remote(&args.remote_path, state.locale())?;
    queue_transfer(&state, args.connection_id, "upload", local, remote)
}

#[tauri::command]
pub fn start_download(state: State<SharedState>, args: TransferArgs) -> Result<Uuid, AppError> {
    let remote = validate_remote(&args.remote_path, state.locale())?;
    let local = expand_path(&args.local_path);
    if local.as_os_str().is_empty() {
        return Err(AppError::Message(
            state.text("本地路径无效", "The local path is invalid"),
        ));
    }
    queue_transfer(&state, args.connection_id, "download", local, remote)
}

#[tauri::command]
pub fn cancel_transfer(state: State<SharedState>, id: Uuid) -> Result<(), AppError> {
    let guard = lock(&state.transfers)?;
    let ctrl = guard.get(&id).ok_or_else(|| {
        AppError::Message(state.text("传输任务不存在", "Transfer task not found"))
    })?;
    ctrl.cancel
        .store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn list_transfer_history(
    state: State<SharedState>,
) -> Result<Vec<tie_store::TransferRecord>, AppError> {
    let store = lock(&state.store)?;
    Ok(store.list_transfers()?)
}

fn queue_transfer(
    state: &SharedState,
    connection_id: Uuid,
    direction: &'static str,
    local: std::path::PathBuf,
    remote: String,
) -> Result<Uuid, AppError> {
    let (session_id, tx) = {
        let live = lock(&state.live)?;
        let handle = live
            .get(&connection_id)
            .ok_or_else(|| AppError::Message(state.text("连接不存在", "Connection not found")))?;
        (handle.session_id, handle.sftp_tx.clone())
    };
    let id = Uuid::new_v4();
    let cancel = Arc::new(AtomicBool::new(false));
    lock(&state.transfers)?.insert(
        id,
        TransferCtrl {
            connection_id,
            cancel: cancel.clone(),
        },
    );
    tx.send(SftpCommand::Transfer(TransferJob {
        id,
        connection_id,
        session_id,
        direction,
        local,
        remote,
        cancel,
    }))
    .map_err(|_| AppError::Message(state.text("SFTP 通道已关闭", "SFTP channel is closed")))?;
    Ok(id)
}

fn sftp_tx(
    state: &SharedState,
    connection_id: Uuid,
) -> Result<tokio::sync::mpsc::UnboundedSender<SftpCommand>, AppError> {
    let live = lock(&state.live)?;
    Ok(live
        .get(&connection_id)
        .ok_or_else(|| AppError::Message(state.text("连接不存在", "Connection not found")))?
        .sftp_tx
        .clone())
}

fn validate_remote(path: &str, locale: crate::i18n::Locale) -> Result<String, AppError> {
    if path.is_empty() || path.contains('\0') || !path.starts_with('/') || path.contains("//") {
        return Err(AppError::Message(crate::i18n::text(
            locale,
            "远程路径必须是绝对路径",
            "The remote path must be absolute",
        )));
    }
    Ok(path.to_string())
}
