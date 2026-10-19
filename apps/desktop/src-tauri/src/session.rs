use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tie_ssh::{
    read_half, AuthMethod, ConnectRequest, HostKeyDecision, HostKeyStatus, RemoteEntry, SftpClient,
    SshClient, SshError,
};
use tie_store::{known_hosts_path, CredentialStore, NewTransfer, Session};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

use crate::error::AppError;
use crate::i18n::{text, Locale};
use crate::state::{lock, SharedState};

const FLUSH_EVERY: Duration = Duration::from_millis(20);
const FLUSH_BYTES: usize = 32 * 1024;
const MAX_PENDING: usize = 1024 * 1024;

pub struct LiveHandle {
    pub session_id: Uuid,
    pub shell_tx: mpsc::UnboundedSender<ShellCommand>,
    pub sftp_tx: mpsc::UnboundedSender<SftpCommand>,
}

pub enum ShellCommand {
    Write(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

pub enum SftpCommand {
    List {
        path: String,
        reply: oneshot::Sender<Result<Vec<FileEntry>, String>>,
    },
    Mkdir {
        path: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Remove {
        path: String,
        is_dir: bool,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Transfer(TransferJob),
}

pub struct TransferJob {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub session_id: Uuid,
    pub direction: &'static str,
    pub local: PathBuf,
    pub remote: String,
    pub cancel: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub permissions: Option<u32>,
    pub mtime: Option<i64>,
    pub owner: Option<String>,
}

#[derive(Clone, Serialize)]
struct HostKeyEvent {
    connection_id: Uuid,
    host: String,
    port: u16,
    status: String,
    fingerprint: String,
}

#[derive(Clone, Serialize)]
struct ConnectionEvent {
    connection_id: Uuid,
    state: String,
    message: String,
    host: String,
    port: u16,
    username: String,
}

#[derive(Clone, Serialize)]
struct TerminalDataEvent {
    connection_id: Uuid,
    data_base64: String,
}

#[derive(Clone, Serialize)]
struct TransferEvent {
    id: Uuid,
    connection_id: Uuid,
    session_id: Uuid,
    direction: String,
    name: String,
    local_path: String,
    remote_path: String,
    transferred: u64,
    total: u64,
    bytes_per_sec: u64,
    status: String,
    error: Option<String>,
}

pub struct StartArgs {
    pub connection_id: Uuid,
    pub session: Session,
    pub secret: Option<String>,
    pub cols: u32,
    pub rows: u32,
    /// Quick connect: do not persist the session, and drop its secret when the last connection ends.
    pub ephemeral: bool,
}

pub fn spawn_connection(
    app: AppHandle,
    state: SharedState,
    args: StartArgs,
) -> Result<(), AppError> {
    let locale = state.locale();
    let session = args.session;
    let host = session.host.clone().ok_or_else(|| {
        AppError::Message(text(locale, "会话缺少主机", "Session is missing a host"))
    })?;
    let port = session.port.unwrap_or(22);
    let username = session.username.clone().ok_or_else(|| {
        AppError::Message(text(
            locale,
            "会话缺少用户名",
            "Session is missing a username",
        ))
    })?;
    let secret = args
        .secret
        .filter(|value| !value.is_empty())
        .or_else(|| {
            lock(&state.secrets)
                .ok()
                .and_then(|guard| guard.get(&session.id).cloned())
        })
        .or_else(|| {
            if session.save_password {
                CredentialStore::load_password(&session.id).ok().flatten()
            } else {
                None
            }
        });
    let remembered_secret = secret.clone();
    let auth = match session.auth_type {
        Some(tie_store::AuthType::Password) => AuthMethod::Password(
            secret
                .ok_or_else(|| AppError::Message(text(locale, "需要密码", "Password required")))?,
        ),
        Some(tie_store::AuthType::PrivateKey) => {
            let path = session.key_path.clone().ok_or_else(|| {
                AppError::Message(text(
                    locale,
                    "需要私钥路径",
                    "A private key path is required",
                ))
            })?;
            let path = expand_path(&path);
            if !path.is_file() {
                return Err(AppError::Message(match locale {
                    Locale::Zh => format!("私钥不存在: {}", path.display()),
                    Locale::En => format!("Private key does not exist: {}", path.display()),
                }));
            }
            AuthMethod::PrivateKey {
                path,
                passphrase: secret.filter(|s| !s.is_empty()),
            }
        }
        None => {
            return Err(AppError::Message(text(
                locale,
                "会话缺少认证方式",
                "Session is missing an authentication method",
            )))
        }
    };
    let known_hosts_path = known_hosts_path()?;
    let req = ConnectRequest {
        host: host.clone(),
        port,
        username: username.clone(),
        auth,
        known_hosts_path,
    };
    let (prompt_tx, prompt_rx) = oneshot::channel();
    let (decision_tx, decision_rx) = oneshot::channel();
    let (cancel_tx, cancel_rx) = oneshot::channel();
    lock(&state.host_keys)?.insert(args.connection_id, decision_tx);
    lock(&state.cancels)?.insert(args.connection_id, cancel_tx);

    let connection_id = args.connection_id;
    let session_id = session.id;
    let ephemeral = args.ephemeral;
    if ephemeral {
        lock(&state.ephemeral)?.insert(session_id);
    }
    let cols = if args.cols == 0 { 80 } else { args.cols };
    let rows = if args.rows == 0 { 24 } else { args.rows };
    tracing::info!(%connection_id, %host, port, %username, "starting ssh connection");

    tauri::async_runtime::spawn(async move {
        let outcome = connect_and_serve(
            app.clone(),
            state.clone(),
            connection_id,
            session_id,
            ephemeral,
            req,
            prompt_tx,
            prompt_rx,
            decision_rx,
            cancel_rx,
            cols,
            rows,
            remembered_secret,
            locale,
        )
        .await;
        if let Err(err) = outcome {
            tracing::warn!(%connection_id, error = %err, "ssh connection ended with error");
            emit_status(
                &app,
                &ConnectionEvent {
                    connection_id,
                    state: "failed".into(),
                    message: err.to_string(),
                    host,
                    port,
                    username,
                },
            );
        }
        let _ = lock(&state.host_keys).map(|mut g| g.remove(&connection_id));
        let _ = lock(&state.cancels).map(|mut g| g.remove(&connection_id));
        let _ = lock(&state.live).map(|mut g| g.remove(&connection_id));
        if ephemeral {
            let still_live = lock(&state.live)
                .map(|guard| guard.values().any(|handle| handle.session_id == session_id))
                .unwrap_or(false);
            if !still_live {
                let _ = lock(&state.secrets).map(|mut guard| {
                    guard.remove(&session_id);
                });
                let _ = lock(&state.ephemeral).map(|mut guard| {
                    guard.remove(&session_id);
                });
            }
        }
    });
    Ok(())
}

async fn connect_and_serve(
    app: AppHandle,
    state: SharedState,
    connection_id: Uuid,
    session_id: Uuid,
    ephemeral: bool,
    req: ConnectRequest,
    prompt_tx: oneshot::Sender<(HostKeyStatus, String)>,
    mut prompt_rx: oneshot::Receiver<(HostKeyStatus, String)>,
    decision_rx: oneshot::Receiver<HostKeyDecision>,
    mut cancel_rx: oneshot::Receiver<()>,
    cols: u32,
    rows: u32,
    remembered_secret: Option<String>,
    locale: Locale,
) -> Result<(), AppError> {
    let host = req.host.clone();
    let port = req.port;
    let username = req.username.clone();
    let connect_fut = SshClient::connect(req, Some((prompt_tx, decision_rx)));
    tokio::pin!(connect_fut);
    let mut prompted = false;
    let client = loop {
        tokio::select! {
            result = &mut connect_fut => break result?,
            prompt = &mut prompt_rx, if !prompted => {
                prompted = true;
                if let Ok((status, fingerprint)) = prompt {
                    emit(
                        &app,
                        "host-key",
                        &HostKeyEvent {
                            connection_id,
                            host: host.clone(),
                            port,
                            status: match status {
                                HostKeyStatus::New => "new",
                                HostKeyStatus::Mismatch => "mismatch",
                                HostKeyStatus::Match => "match",
                            }
                            .to_string(),
                            fingerprint,
                        },
                    );
                }
            }
            _ = &mut cancel_rx => {
                return Err(AppError::Message(text(locale, "连接已取消", "Connection cancelled")));
            }
        }
    };
    let _ = lock(&state.cancels).map(|mut g| g.remove(&connection_id));
    if !ephemeral {
        if let Some(secret) = remembered_secret.filter(|value| !value.is_empty()) {
            if let Ok(mut guard) = lock(&state.secrets) {
                guard.insert(session_id, secret);
            }
        }
    }

    let shell = client.open_shell(cols, rows).await?;
    let (mut reader, writer) = shell.into_split();
    let sftp = match client.open_sftp().await {
        Ok(sftp) => Some(sftp),
        Err(err) => {
            tracing::warn!(%connection_id, error = %err, "sftp subsystem unavailable");
            None
        }
    };
    let (shell_tx, mut shell_rx) = mpsc::unbounded_channel();
    let (sftp_tx, sftp_rx) = mpsc::unbounded_channel();
    lock(&state.live)?.insert(
        connection_id,
        LiveHandle {
            session_id,
            shell_tx,
            sftp_tx,
        },
    );
    emit_status(
        &app,
        &ConnectionEvent {
            connection_id,
            state: "connected".into(),
            message: text(locale, "SSH 已连接", "SSH connected"),
            host: host.clone(),
            port,
            username: username.clone(),
        },
    );

    let sftp_state = state.clone();
    let sftp_app = app.clone();
    let sftp_task = tokio::spawn(async move {
        sftp_loop(sftp_app, sftp_state, sftp, sftp_rx).await;
    });

    let mut pending = Vec::new();
    let mut ticker = tokio::time::interval(FLUSH_EVERY);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            chunk = read_half(&mut reader) => {
                match chunk {
                    Ok(Some(data)) => {
                        pending.extend_from_slice(&data);
                        if pending.len() >= FLUSH_BYTES {
                            flush_terminal(&app, connection_id, &mut pending);
                        }
                    }
                    Ok(None) => {
                        flush_terminal(&app, connection_id, &mut pending);
                        emit_status(&app, &ConnectionEvent {
                            connection_id,
                            state: "disconnected".into(),
                            message: text(locale, "远程终端已关闭", "Remote terminal closed"),
                            host: host.clone(),
                            port,
                            username: username.clone(),
                        });
                        break;
                    }
                    Err(err) => {
                        flush_terminal(&app, connection_id, &mut pending);
                        return Err(err.into());
                    }
                }
            }
            _ = ticker.tick() => {
                flush_terminal(&app, connection_id, &mut pending);
            }
            cmd = shell_rx.recv() => {
                match cmd {
                    Some(ShellCommand::Write(data)) => {
                        writer
                            .data(data.as_slice())
                            .await
                            .map_err(SshError::from)?;
                    }
                    Some(ShellCommand::Resize { cols, rows }) => {
                        if let Err(err) = writer.window_change(cols, rows, 0, 0).await {
                            tracing::warn!(%connection_id, error = %err, "resize failed");
                        }
                    }
                    Some(ShellCommand::Close) | None => {
                        flush_terminal(&app, connection_id, &mut pending);
                        emit_status(&app, &ConnectionEvent {
                            connection_id,
                            state: "disconnected".into(),
                            message: text(locale, "已断开", "Disconnected"),
                            host,
                            port,
                            username,
                        });
                        break;
                    }
                }
            }
        }
    }
    if let Ok(guard) = lock(&state.transfers) {
        for ctrl in guard.values() {
            if ctrl.connection_id == connection_id {
                ctrl.cancel.store(true, Ordering::Relaxed);
            }
        }
    }
    if let Ok(mut live) = lock(&state.live) {
        live.remove(&connection_id);
    }
    if tokio::time::timeout(Duration::from_secs(5), sftp_task)
        .await
        .is_err()
    {
        tracing::warn!(%connection_id, "sftp task did not stop within 5s after disconnect");
    }
    client.disconnect().await?;
    Ok(())
}

pub(crate) fn flush_terminal(app: &AppHandle, connection_id: Uuid, pending: &mut Vec<u8>) {
    if pending.is_empty() {
        return;
    }
    if pending.len() > MAX_PENDING {
        tracing::warn!(
            %connection_id,
            bytes = pending.len(),
            "terminal buffer exceeded 1MiB before flush; emitting the coalesced batch"
        );
    }
    let data_base64 = base64::engine::general_purpose::STANDARD.encode(&pending);
    pending.clear();
    emit(
        app,
        "terminal-data",
        &TerminalDataEvent {
            connection_id,
            data_base64,
        },
    );
}

async fn sftp_loop(
    app: AppHandle,
    state: SharedState,
    sftp: Option<SftpClient>,
    mut rx: mpsc::UnboundedReceiver<SftpCommand>,
) {
    let Some(sftp) = sftp else {
        while let Some(cmd) = rx.recv().await {
            reply_unavailable(cmd);
        }
        return;
    };
    while let Some(cmd) = rx.recv().await {
        match cmd {
            SftpCommand::List { path, reply } => {
                let result = sftp
                    .read_dir(&path)
                    .await
                    .map(|entries| entries.into_iter().map(map_remote).collect())
                    .map_err(|e| e.to_string());
                let _ = reply.send(result);
            }
            SftpCommand::Mkdir { path, reply } => {
                let result = sftp.mkdir(&path).await.map_err(|e| e.to_string());
                let _ = reply.send(result);
            }
            SftpCommand::Remove {
                path,
                is_dir,
                reply,
            } => {
                let result = if is_dir {
                    sftp.remove_dir(&path).await
                } else {
                    sftp.remove_file(&path).await
                }
                .map_err(|e| e.to_string());
                let _ = reply.send(result);
            }
            SftpCommand::Transfer(job) => run_transfer(&app, &state, &sftp, job).await,
        }
    }
}

fn reply_unavailable(cmd: SftpCommand) {
    match cmd {
        SftpCommand::List { reply, .. } => {
            let _ = reply.send(Err("SFTP subsystem is not available".into()));
        }
        SftpCommand::Mkdir { reply, .. } | SftpCommand::Remove { reply, .. } => {
            let _ = reply.send(Err("SFTP subsystem is not available".into()));
        }
        SftpCommand::Transfer(job) => {
            tracing::warn!(id = %job.id, "dropped transfer because sftp is unavailable");
        }
    }
}

async fn run_transfer(app: &AppHandle, state: &SharedState, sftp: &SftpClient, job: TransferJob) {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let started = Instant::now();
    let name = job
        .local
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file")
        .to_string();
    let local_path = job.local.display().to_string();
    let remote_path = job.remote.clone();
    let work = async {
        if job.direction == "upload" {
            sftp.upload(&job.local, &job.remote, Some(tx), &job.cancel)
                .await
        } else {
            sftp.download(&job.remote, &job.local, Some(tx), &job.cancel)
                .await
        }
    };
    tokio::pin!(work);
    let mut last_transferred = 0u64;
    let mut last_total = 0u64;
    let mut progress_open = true;
    let status = loop {
        tokio::select! {
            biased;
            result = &mut work => {
                break match result {
                    Ok(()) => "completed",
                    Err(SshError::Other(msg)) if msg == "cancelled" => "cancelled",
                    Err(err) => {
                        emit_transfer(app, &job, &name, &local_path, &remote_path, last_transferred, last_total, started, "failed", Some(err.to_string()));
                        record_transfer(state, &job, last_transferred, "failed", Some(err.to_string()));
                        if let Ok(mut guard) = lock(&state.transfers) {
                            guard.remove(&job.id);
                        }
                        return;
                    }
                };
            }
            prog = rx.recv(), if progress_open => {
                match prog {
                    Some(prog) => {
                        last_transferred = prog.transferred;
                        last_total = prog.total;
                        emit_transfer(app, &job, &name, &local_path, &remote_path, prog.transferred, prog.total, started, "running", None);
                    }
                    None => progress_open = false,
                }
            }
        }
    };
    emit_transfer(
        app,
        &job,
        &name,
        &local_path,
        &remote_path,
        if status == "completed" {
            last_total.max(last_transferred)
        } else {
            last_transferred
        },
        last_total,
        started,
        status,
        None,
    );
    record_transfer(
        state,
        &job,
        if status == "completed" {
            last_total.max(last_transferred)
        } else {
            last_transferred
        },
        status,
        None,
    );
    if let Ok(mut guard) = lock(&state.transfers) {
        guard.remove(&job.id);
    }
}

fn record_transfer(
    state: &SharedState,
    job: &TransferJob,
    bytes: u64,
    status: &str,
    error: Option<String>,
) {
    let ephemeral = lock(&state.ephemeral)
        .map(|guard| guard.contains(&job.session_id))
        .unwrap_or(false);
    if ephemeral {
        return;
    }
    let record = NewTransfer {
        id: job.id,
        session_id: Some(job.session_id),
        direction: job.direction.to_string(),
        local_path: job.local.display().to_string(),
        remote_path: job.remote.clone(),
        bytes,
        status: status.to_string(),
        error,
    };
    match lock(&state.store).and_then(|store| Ok(store.insert_transfer(&record)?)) {
        Ok(()) => {}
        Err(err) => {
            tracing::error!(id = %job.id, error = %err, "failed to persist transfer history")
        }
    }
}

fn emit_transfer(
    app: &AppHandle,
    job: &TransferJob,
    name: &str,
    local_path: &str,
    remote_path: &str,
    transferred: u64,
    total: u64,
    started: Instant,
    status: &str,
    error: Option<String>,
) {
    let elapsed = started.elapsed().as_millis().max(1) as u64;
    emit(
        app,
        "transfer-progress",
        &TransferEvent {
            id: job.id,
            connection_id: job.connection_id,
            session_id: job.session_id,
            direction: job.direction.to_string(),
            name: name.to_string(),
            local_path: local_path.to_string(),
            remote_path: remote_path.to_string(),
            transferred,
            total,
            bytes_per_sec: transferred.saturating_mul(1000) / elapsed,
            status: status.to_string(),
            error,
        },
    );
}

fn map_remote(entry: RemoteEntry) -> FileEntry {
    let owner = match (entry.uid, entry.gid) {
        (Some(uid), Some(gid)) => Some(format!("{uid}:{gid}")),
        _ => None,
    };
    FileEntry {
        name: entry.name,
        path: entry.path,
        is_dir: entry.is_dir,
        size: entry.size,
        permissions: entry.permissions,
        mtime: entry.mtime.map(|v| v as i64),
        owner,
    }
}

fn emit_status(app: &AppHandle, event: &ConnectionEvent) {
    emit(app, "connection-status", event);
}

pub(crate) fn notify_connection(
    app: &AppHandle,
    connection_id: Uuid,
    state: &str,
    message: impl AsRef<str>,
    host: &str,
    port: u16,
    username: &str,
) {
    emit_status(
        app,
        &ConnectionEvent {
            connection_id,
            state: state.to_string(),
            message: message.as_ref().to_string(),
            host: host.to_string(),
            port,
            username: username.to_string(),
        },
    );
}

fn emit<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: &T) {
    if let Err(err) = app.emit(event, payload) {
        tracing::warn!(%event, error = %err, "dropped ui event because the window channel failed");
    }
}

pub fn expand_path(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    if path == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }
    PathBuf::from(path)
}

pub async fn sftp_call<T>(
    locale: Locale,
    tx: &mpsc::UnboundedSender<SftpCommand>,
    cmd: SftpCommand,
    rx: oneshot::Receiver<Result<T, String>>,
) -> Result<T, AppError> {
    tx.send(cmd).map_err(|_| {
        AppError::Message(text(locale, "SFTP 通道已关闭", "SFTP channel is closed"))
    })?;
    match tokio::time::timeout(Duration::from_secs(120), rx).await {
        Ok(Ok(Ok(value))) => Ok(value),
        Ok(Ok(Err(err))) => Err(AppError::Message(err)),
        Ok(Err(_)) => Err(AppError::Message(text(
            locale,
            "SFTP 通道已关闭",
            "SFTP channel is closed",
        ))),
        Err(_) => Err(AppError::Message(text(
            locale,
            "SFTP 操作超时",
            "SFTP operation timed out",
        ))),
    }
}
