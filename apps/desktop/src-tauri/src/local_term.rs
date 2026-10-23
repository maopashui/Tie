use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::AppHandle;
use tie_pty::{LocalPty, LocalShellKind, PtyWriter};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::error::AppError;
use crate::i18n::text;
use crate::port_forward::ForwardCommand;
use crate::session::{flush_terminal, notify_connection, LiveHandle, SftpCommand, ShellCommand};
use crate::state::{lock, SharedState};

const FLUSH_EVERY: Duration = Duration::from_millis(20);
const FLUSH_BYTES: usize = 32 * 1024;

pub fn spawn_local_connection(
    app: AppHandle,
    state: SharedState,
    connection_id: Uuid,
    session_id: Uuid,
    kind: LocalShellKind,
    cols: u32,
    rows: u32,
) -> Result<(), AppError> {
    let cols = if cols == 0 { 80 } else { cols.min(1000) } as u16;
    let rows = if rows == 0 { 24 } else { rows.min(1000) } as u16;
    let pty =
        LocalPty::spawn(kind, cols, rows).map_err(|err| AppError::Message(err.to_string()))?;
    let reader = pty
        .take_reader()
        .map_err(|err| AppError::Message(err.to_string()))?;
    let writer = pty.writer();
    let pty = Arc::new(Mutex::new(pty));
    let (output_tx, mut output_rx) = mpsc::unbounded_channel::<std::io::Result<Vec<u8>>>();
    std::thread::Builder::new()
        .name("tie-local-pty".into())
        .spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = output_tx.send(Ok(Vec::new()));
                        break;
                    }
                    Ok(n) => {
                        if output_tx.send(Ok(buf[..n].to_vec())).is_err() {
                            break;
                        }
                    }
                    Err(err) => {
                        let _ = output_tx.send(Err(err));
                        break;
                    }
                }
            }
        })
        .map_err(|err| {
            let locale = state.locale();
            AppError::Message(match locale {
                crate::i18n::Locale::Zh => format!("无法启动本地终端读取线程: {err}"),
                crate::i18n::Locale::En => {
                    format!("Could not start the local terminal reader: {err}")
                }
            })
        })?;

    let (shell_tx, mut shell_rx) = mpsc::unbounded_channel();
    let (sftp_tx, mut sftp_rx) = mpsc::unbounded_channel();
    let (forward_tx, mut forward_rx) = mpsc::unbounded_channel();
    lock(&state.live)?.insert(
        connection_id,
        LiveHandle {
            session_id,
            shell_tx,
            sftp_tx,
            forward_tx,
        },
    );

    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "local".into());
    let host = "local".to_string();

    let locale = state.locale();
    tauri::async_runtime::spawn(async move {
        let reject = tokio::spawn(async move {
            while let Some(cmd) = sftp_rx.recv().await {
                let message = text(
                    locale,
                    "本地会话不支持 SFTP",
                    "Local sessions do not support SFTP",
                );
                match cmd {
                    SftpCommand::List { reply, .. } => {
                        let _ = reply.send(Err(message));
                    }
                    SftpCommand::Mkdir { reply, .. } | SftpCommand::Remove { reply, .. } => {
                        let _ = reply.send(Err(message));
                    }
                    SftpCommand::Transfer(_) => {}
                }
            }
        });
        let reject_forward = tokio::spawn(async move {
            while let Some(cmd) = forward_rx.recv().await {
                let message = text(
                    locale,
                    "本地会话不支持端口转发",
                    "Local sessions do not support port forwarding",
                );
                match cmd {
                    ForwardCommand::Start { reply, .. } | ForwardCommand::Stop { reply, .. } => {
                        let _ = reply.send(Err(message));
                    }
                }
            }
        });

        notify_connection(
            &app,
            connection_id,
            "connected",
            text(locale, "本地终端已连接", "Local terminal connected"),
            &host,
            0,
            &username,
        );

        let mut pending = Vec::new();
        let mut ticker = tokio::time::interval(FLUSH_EVERY);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut disconnect_message = text(locale, "本地终端已退出", "Local terminal exited");
        loop {
            tokio::select! {
                chunk = output_rx.recv() => {
                    match chunk {
                        Some(Ok(data)) if data.is_empty() => break,
                        Some(Ok(data)) => {
                            pending.extend_from_slice(&data);
                            if pending.len() >= FLUSH_BYTES {
                                flush_terminal(&app, connection_id, &mut pending);
                            }
                        }
                        Some(Err(err)) => {
                            flush_terminal(&app, connection_id, &mut pending);
                            disconnect_message = text(locale, "本地终端读取失败", "Failed to read the local terminal");
                            tracing::warn!(%connection_id, error = %err, "local pty read failed");
                            break;
                        }
                        None => break,
                    }
                }
                _ = ticker.tick() => {
                    flush_terminal(&app, connection_id, &mut pending);
                }
                cmd = shell_rx.recv() => {
                    match cmd {
                        Some(ShellCommand::Write(data)) => {
                            if let Err(err) = write_pty(&writer, &data) {
                                tracing::warn!(%connection_id, error = %err, "local pty write failed");
                                disconnect_message = text(locale, "本地终端写入失败", "Failed to write to the local terminal");
                                break;
                            }
                        }
                        Some(ShellCommand::Resize { cols, rows }) => {
                            let cols = cols.min(1000) as u16;
                            let rows = rows.min(1000) as u16;
                            if cols > 0 && rows > 0 {
                                if let Ok(pty) = pty.lock() {
                                    if let Err(err) = pty.resize(cols, rows) {
                                        tracing::warn!(%connection_id, error = %err, "local pty resize failed");
                                    }
                                }
                            }
                        }
                        Some(ShellCommand::Close) | None => {
                            disconnect_message = text(locale, "已断开", "Disconnected");
                            break;
                        }
                    }
                }
            }
        }
        flush_terminal(&app, connection_id, &mut pending);
        if let Ok(mut pty) = pty.lock() {
            let _ = pty.kill();
        }
        let _ = lock(&state.live).map(|mut guard| {
            guard.remove(&connection_id);
        });
        notify_connection(
            &app,
            connection_id,
            "disconnected",
            disconnect_message,
            &host,
            0,
            &username,
        );
        reject.abort();
        reject_forward.abort();
    });
    Ok(())
}

fn write_pty(writer: &PtyWriter, data: &[u8]) -> std::io::Result<()> {
    writer.write_all(data)
}
