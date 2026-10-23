use std::collections::HashMap;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tie_ssh::{
    bind_tcp_listener, new_remote_forward_map, run_dynamic_forward, run_local_tcp_forward,
    run_remote_accept_loop, IncomingForward, RemoteForwardEntry, RemoteForwardMap, SharedHandle,
};
use tokio::sync::{mpsc, oneshot, watch};
use uuid::Uuid;

use crate::error::AppError;
use crate::i18n::{text, Locale};
use crate::state::{lock, SharedState};

#[derive(Clone, Debug, Serialize)]
pub struct ForwardSnapshot {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub kind: String,
    pub bind_host: String,
    pub bind_port: u16,
    pub dest_host: Option<String>,
    pub dest_port: Option<u16>,
    pub status: String,
    pub error: Option<String>,
}

pub enum ForwardCommand {
    Start {
        id: Uuid,
        kind: String,
        bind_host: String,
        bind_port: u16,
        dest_host: Option<String>,
        dest_port: Option<u16>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Stop {
        id: Uuid,
        reply: oneshot::Sender<Result<(), String>>,
    },
}

struct ActiveForward {
    kind: String,
    bind_host: String,
    bind_port: u16,
    dest_host: Option<String>,
    dest_port: Option<u16>,
    cancel_tx: watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}

pub async fn forward_loop(
    app: AppHandle,
    state: SharedState,
    connection_id: Uuid,
    handle: SharedHandle,
    incoming: mpsc::UnboundedReceiver<IncomingForward>,
    mut cmd_rx: mpsc::UnboundedReceiver<ForwardCommand>,
    locale: Locale,
) {
    let remote_map = new_remote_forward_map();
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let accept_map = remote_map.clone();
    let accept_task = tokio::spawn(async move {
        run_remote_accept_loop(incoming, accept_map, shutdown_rx).await;
    });

    let mut active: HashMap<Uuid, ActiveForward> = HashMap::new();

    while let Some(cmd) = cmd_rx.recv().await {
        match cmd {
            ForwardCommand::Start {
                id,
                kind,
                bind_host,
                bind_port,
                dest_host,
                dest_port,
                reply,
            } => {
                if active.contains_key(&id) {
                    let _ = reply.send(Err(text(
                        locale,
                        "转发已存在",
                        "Forward already exists",
                    )));
                    continue;
                }
                emit_snapshot(
                    &app,
                    &state,
                    ForwardSnapshot {
                        id,
                        connection_id,
                        kind: kind.clone(),
                        bind_host: bind_host.clone(),
                        bind_port,
                        dest_host: dest_host.clone(),
                        dest_port,
                        status: "starting".into(),
                        error: None,
                    },
                );

                let result = start_one(
                    std::sync::Arc::clone(&handle),
                    &remote_map,
                    &kind,
                    &bind_host,
                    bind_port,
                    dest_host.clone(),
                    dest_port,
                    locale,
                )
                .await;

                match result {
                    Ok((cancel_tx, task)) => {
                        active.insert(
                            id,
                            ActiveForward {
                                kind: kind.clone(),
                                bind_host: bind_host.clone(),
                                bind_port,
                                dest_host: dest_host.clone(),
                                dest_port,
                                cancel_tx,
                                task,
                            },
                        );
                        emit_snapshot(
                            &app,
                            &state,
                            ForwardSnapshot {
                                id,
                                connection_id,
                                kind,
                                bind_host,
                                bind_port,
                                dest_host,
                                dest_port,
                                status: "active".into(),
                                error: None,
                            },
                        );
                        let _ = reply.send(Ok(()));
                    }
                    Err(err) => {
                        emit_snapshot(
                            &app,
                            &state,
                            ForwardSnapshot {
                                id,
                                connection_id,
                                kind,
                                bind_host,
                                bind_port,
                                dest_host,
                                dest_port,
                                status: "error".into(),
                                error: Some(err.clone()),
                            },
                        );
                        let _ = reply.send(Err(err));
                    }
                }
            }
            ForwardCommand::Stop { id, reply } => {
                if let Some(fwd) = active.remove(&id) {
                    stop_forward(&handle, &remote_map, &fwd).await;
                    emit_snapshot(
                        &app,
                        &state,
                        ForwardSnapshot {
                            id,
                            connection_id,
                            kind: fwd.kind,
                            bind_host: fwd.bind_host,
                            bind_port: fwd.bind_port,
                            dest_host: fwd.dest_host,
                            dest_port: fwd.dest_port,
                            status: "stopped".into(),
                            error: None,
                        },
                    );
                    remove_from_state(&state, id);
                    let _ = reply.send(Ok(()));
                } else {
                    let _ = reply.send(Err(text(
                        locale,
                        "转发不存在",
                        "Forward not found",
                    )));
                }
            }
        }
    }

    let _ = shutdown_tx.send(true);
    for (id, fwd) in active.drain() {
        stop_forward(&handle, &remote_map, &fwd).await;
        emit_snapshot(
            &app,
            &state,
            ForwardSnapshot {
                id,
                connection_id,
                kind: fwd.kind,
                bind_host: fwd.bind_host,
                bind_port: fwd.bind_port,
                dest_host: fwd.dest_host,
                dest_port: fwd.dest_port,
                status: "stopped".into(),
                error: None,
            },
        );
        remove_from_state(&state, id);
    }
    {
        let mut map = remote_map.lock().await;
        map.clear();
    }
    accept_task.abort();
}

async fn stop_forward(
    handle: &SharedHandle,
    remote_map: &RemoteForwardMap,
    fwd: &ActiveForward,
) {
    let _ = fwd.cancel_tx.send(true);
    if fwd.kind == "remote" {
        let _ = handle
            .cancel_tcpip_forward(&fwd.bind_host, u32::from(fwd.bind_port))
            .await;
        let mut map = remote_map.lock().await;
        map.retain(|e| !(e.bind_host == fwd.bind_host && e.bind_port == fwd.bind_port));
    }
    fwd.task.abort();
}

async fn start_one(
    handle: SharedHandle,
    remote_map: &RemoteForwardMap,
    kind: &str,
    bind_host: &str,
    bind_port: u16,
    dest_host: Option<String>,
    dest_port: Option<u16>,
    locale: Locale,
) -> Result<(watch::Sender<bool>, tokio::task::JoinHandle<()>), String> {
    let (cancel_tx, cancel_rx) = watch::channel(false);
    match kind {
        "local" => {
            let dest_host = dest_host
                .ok_or_else(|| text(locale, "需要目标主机", "Destination host is required"))?;
            let dest_port = dest_port
                .ok_or_else(|| text(locale, "需要目标端口", "Destination port is required"))?;
            let listener = bind_tcp_listener(bind_host, bind_port)
                .await
                .map_err(|e| e.to_string())?;
            let task = tokio::spawn(async move {
                if let Err(e) =
                    run_local_tcp_forward(listener, dest_host, dest_port, handle, cancel_rx).await
                {
                    tracing::warn!(error = %e, "local forward stopped with error");
                }
            });
            Ok((cancel_tx, task))
        }
        "dynamic" => {
            let listener = bind_tcp_listener(bind_host, bind_port)
                .await
                .map_err(|e| e.to_string())?;
            let task = tokio::spawn(async move {
                if let Err(e) = run_dynamic_forward(listener, handle, cancel_rx).await {
                    tracing::warn!(error = %e, "dynamic forward stopped with error");
                }
            });
            Ok((cancel_tx, task))
        }
        "remote" => {
            let dest_host = dest_host
                .ok_or_else(|| text(locale, "需要目标主机", "Destination host is required"))?;
            let dest_port = dest_port
                .ok_or_else(|| text(locale, "需要目标端口", "Destination port is required"))?;
            handle
                .tcpip_forward(bind_host, u32::from(bind_port))
                .await
                .map_err(|e| e.to_string())?;
            {
                let mut map = remote_map.lock().await;
                map.push(RemoteForwardEntry {
                    bind_host: bind_host.to_string(),
                    bind_port,
                    dest_host,
                    dest_port,
                });
            }
            let task = tokio::spawn(async move {
                let mut cancel_rx = cancel_rx;
                loop {
                    if cancel_rx.changed().await.is_err() || *cancel_rx.borrow() {
                        break;
                    }
                }
            });
            Ok((cancel_tx, task))
        }
        _ => Err(text(locale, "未知转发类型", "Unknown forward kind")),
    }
}

fn emit_snapshot(app: &AppHandle, state: &SharedState, snap: ForwardSnapshot) {
    if let Ok(mut guard) = lock(&state.forwards) {
        if snap.status == "stopped" {
            guard.remove(&snap.id);
        } else {
            guard.insert(snap.id, snap.clone());
        }
    }
    let _ = app.emit("forward-status", &snap);
}

fn remove_from_state(state: &SharedState, id: Uuid) {
    let _ = lock(&state.forwards).map(|mut g| g.remove(&id));
}

pub fn clear_connection_forwards(app: &AppHandle, state: &SharedState, connection_id: Uuid) {
    let removed: Vec<ForwardSnapshot> = lock(&state.forwards)
        .map(|mut guard| {
            let ids: Vec<Uuid> = guard
                .values()
                .filter(|s| s.connection_id == connection_id)
                .map(|s| s.id)
                .collect();
            ids.into_iter()
                .filter_map(|id| {
                    guard.remove(&id).map(|mut s| {
                        s.status = "stopped".into();
                        s
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    for snap in removed {
        let _ = app.emit("forward-status", &snap);
    }
}

pub fn list_forwards(
    state: &SharedState,
    connection_id: Uuid,
) -> Result<Vec<ForwardSnapshot>, AppError> {
    let guard = lock(&state.forwards)?;
    let mut list: Vec<_> = guard
        .values()
        .filter(|s| s.connection_id == connection_id)
        .cloned()
        .collect();
    list.sort_by_key(|s| s.bind_port);
    Ok(list)
}
