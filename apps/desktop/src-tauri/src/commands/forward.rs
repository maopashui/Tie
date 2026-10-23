use serde::Deserialize;
use tauri::State;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::error::AppError;
use crate::port_forward::{list_forwards, ForwardCommand, ForwardSnapshot};
use crate::state::{lock, SharedState};

#[derive(Deserialize)]
pub struct StartForwardArgs {
    pub connection_id: Uuid,
    pub kind: String,
    pub bind_host: String,
    pub bind_port: u16,
    pub dest_host: Option<String>,
    pub dest_port: Option<u16>,
}

#[tauri::command]
pub async fn start_port_forward(
    state: State<'_, SharedState>,
    args: StartForwardArgs,
) -> Result<Uuid, AppError> {
    let kind = args.kind.trim().to_ascii_lowercase();
    if !matches!(kind.as_str(), "local" | "remote" | "dynamic") {
        return Err(AppError::Message(state.text(
            "转发类型必须是 local、remote 或 dynamic",
            "Forward kind must be local, remote, or dynamic",
        )));
    }
    let bind_host = args.bind_host.trim();
    if bind_host.is_empty() {
        return Err(AppError::Message(state.text(
            "请填写绑定地址",
            "Bind address is required",
        )));
    }
    if args.bind_port == 0 {
        return Err(AppError::Message(state.text(
            "绑定端口必须是 1 到 65535 的整数",
            "Bind port must be an integer from 1 to 65535",
        )));
    }
    if kind != "dynamic" {
        let dest_host = args
            .dest_host
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let dest_port = args.dest_port.filter(|p| *p > 0);
        if dest_host.is_none() || dest_port.is_none() {
            return Err(AppError::Message(state.text(
                "请填写目标地址和端口",
                "Destination host and port are required",
            )));
        }
    }

    let tx = {
        let live = lock(&state.live)?;
        live.get(&args.connection_id)
            .ok_or_else(|| AppError::Message(state.text("连接不存在", "Connection not found")))?
            .forward_tx
            .clone()
    };
    let id = Uuid::new_v4();
    let (reply, rx) = oneshot::channel();
    tx.send(ForwardCommand::Start {
        id,
        kind,
        bind_host: bind_host.to_string(),
        bind_port: args.bind_port,
        dest_host: args
            .dest_host
            .map(|h| h.trim().to_string())
            .filter(|h| !h.is_empty()),
        dest_port: args.dest_port.filter(|p| *p > 0),
        reply,
    })
    .map_err(|_| {
        AppError::Message(state.text("转发通道已关闭", "The forward channel is closed"))
    })?;
    rx.await
        .map_err(|_| AppError::Message(state.text("转发通道已关闭", "The forward channel is closed")))?
        .map_err(AppError::Message)?;
    Ok(id)
}

#[derive(Deserialize)]
pub struct StopForwardArgs {
    pub connection_id: Uuid,
    pub forward_id: Uuid,
}

#[tauri::command]
pub async fn stop_port_forward(
    state: State<'_, SharedState>,
    args: StopForwardArgs,
) -> Result<(), AppError> {
    let tx = {
        let live = lock(&state.live)?;
        live.get(&args.connection_id)
            .ok_or_else(|| AppError::Message(state.text("连接不存在", "Connection not found")))?
            .forward_tx
            .clone()
    };
    let (reply, rx) = oneshot::channel();
    tx.send(ForwardCommand::Stop {
        id: args.forward_id,
        reply,
    })
    .map_err(|_| {
        AppError::Message(state.text("转发通道已关闭", "The forward channel is closed"))
    })?;
    rx.await
        .map_err(|_| AppError::Message(state.text("转发通道已关闭", "The forward channel is closed")))?
        .map_err(AppError::Message)?;
    Ok(())
}

#[tauri::command]
pub fn list_port_forwards(
    state: State<SharedState>,
    connection_id: Uuid,
) -> Result<Vec<ForwardSnapshot>, AppError> {
    list_forwards(state.inner(), connection_id)
}
