use std::io;
use std::net::SocketAddr;
use std::sync::Arc;

use russh::client::Msg;
use russh::{Channel, ChannelMsg};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};

use crate::client::ClientHandler;
use crate::error::{Result, SshError};

pub type SharedHandle = Arc<russh::client::Handle<ClientHandler>>;

/// An inbound remote-forward channel accepted from the SSH server.
pub struct IncomingForward {
    pub channel: Channel<Msg>,
    pub connected_address: String,
    pub connected_port: u32,
    pub originator_address: String,
    pub originator_port: u32,
}

/// Shared registry: remote bind (addr, port) → local destination (host, port).
pub type RemoteForwardMap = Arc<Mutex<Vec<RemoteForwardEntry>>>;

#[derive(Clone, Debug)]
pub struct RemoteForwardEntry {
    pub bind_host: String,
    pub bind_port: u16,
    pub dest_host: String,
    pub dest_port: u16,
}

pub fn new_remote_forward_map() -> RemoteForwardMap {
    Arc::new(Mutex::new(Vec::new()))
}

/// Bidirectional relay between a TCP stream and an SSH channel.
pub async fn relay_tcp_and_channel(mut stream: TcpStream, mut channel: Channel<Msg>) {
    let mut buf = vec![0u8; 65536];
    let mut stream_closed = false;
    loop {
        tokio::select! {
            r = stream.read(&mut buf), if !stream_closed => {
                match r {
                    Ok(0) => {
                        stream_closed = true;
                        let _ = channel.eof().await;
                    }
                    Ok(n) => {
                        if channel.data(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        if stream.write_all(data).await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                        if !stream_closed {
                            let _ = channel.eof().await;
                        }
                        break;
                    }
                    Some(ChannelMsg::WindowAdjusted { .. }) => {}
                    _ => {}
                }
            }
        }
    }
}

/// Bind a local TCP listener for port forwarding.
pub async fn bind_tcp_listener(bind_host: &str, bind_port: u16) -> Result<TcpListener> {
    let addr = format!("{bind_host}:{bind_port}");
    TcpListener::bind(&addr)
        .await
        .map_err(|e| SshError::Other(format!("bind {addr}: {e}")))
}

/// Accept local TCP connections and open direct-tcpip channels to a fixed destination.
pub async fn run_local_tcp_forward(
    listener: TcpListener,
    dest_host: String,
    dest_port: u16,
    handle: SharedHandle,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) -> Result<()> {
    loop {
        tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() {
                    break;
                }
            }
            accepted = listener.accept() => {
                let (stream, peer) = match accepted {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!(error = %e, "local forward accept failed");
                        continue;
                    }
                };
                let dest_host = dest_host.clone();
                let handle = Arc::clone(&handle);
                tokio::spawn(async move {
                    let originator = peer.ip().to_string();
                    let channel = match handle
                        .channel_open_direct_tcpip(
                            dest_host,
                            u32::from(dest_port),
                            originator,
                            u32::from(peer.port()),
                        )
                        .await
                    {
                        Ok(ch) => ch,
                        Err(e) => {
                            tracing::warn!(error = %e, "direct-tcpip open failed");
                            return;
                        }
                    };
                    relay_tcp_and_channel(stream, channel).await;
                });
            }
        }
    }
    Ok(())
}

/// SOCKS5 dynamic forward: accept on an already-bound listener.
pub async fn run_dynamic_forward(
    listener: TcpListener,
    handle: SharedHandle,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) -> Result<()> {
    loop {
        tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() {
                    break;
                }
            }
            accepted = listener.accept() => {
                let (stream, peer) = match accepted {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!(error = %e, "dynamic forward accept failed");
                        continue;
                    }
                };
                let handle = Arc::clone(&handle);
                tokio::spawn(async move {
                    if let Err(e) = handle_socks5(stream, peer, handle).await {
                        tracing::debug!(error = %e, "socks5 session ended");
                    }
                });
            }
        }
    }
    Ok(())
}

async fn handle_socks5(
    mut stream: TcpStream,
    peer: SocketAddr,
    handle: SharedHandle,
) -> io::Result<()> {
    let mut hdr = [0u8; 2];
    stream.read_exact(&mut hdr).await?;
    if hdr[0] != 0x05 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "not socks5"));
    }
    let nmethods = hdr[1] as usize;
    let mut methods = vec![0u8; nmethods];
    stream.read_exact(&mut methods).await?;
    stream.write_all(&[0x05, 0x00]).await?;

    let mut req = [0u8; 4];
    stream.read_exact(&mut req).await?;
    if req[0] != 0x05 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "bad socks ver"));
    }
    if req[1] != 0x01 {
        reply_socks_fail(&mut stream, 0x07).await?;
        return Ok(());
    }
    let (dest_host, dest_port) = match req[3] {
        0x01 => {
            let mut ip = [0u8; 4];
            stream.read_exact(&mut ip).await?;
            let mut port_buf = [0u8; 2];
            stream.read_exact(&mut port_buf).await?;
            let port = u16::from_be_bytes(port_buf);
            (std::net::Ipv4Addr::from(ip).to_string(), port)
        }
        0x03 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await?;
            let mut name = vec![0u8; len[0] as usize];
            stream.read_exact(&mut name).await?;
            let mut port_buf = [0u8; 2];
            stream.read_exact(&mut port_buf).await?;
            let port = u16::from_be_bytes(port_buf);
            (
                String::from_utf8(name)
                    .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "bad domain"))?,
                port,
            )
        }
        0x04 => {
            let mut ip = [0u8; 16];
            stream.read_exact(&mut ip).await?;
            let mut port_buf = [0u8; 2];
            stream.read_exact(&mut port_buf).await?;
            let port = u16::from_be_bytes(port_buf);
            (std::net::Ipv6Addr::from(ip).to_string(), port)
        }
        _ => {
            reply_socks_fail(&mut stream, 0x08).await?;
            return Ok(());
        }
    };

    let channel = match handle
        .channel_open_direct_tcpip(
            dest_host,
            u32::from(dest_port),
            peer.ip().to_string(),
            u32::from(peer.port()),
        )
        .await
    {
        Ok(ch) => ch,
        Err(_) => {
            reply_socks_fail(&mut stream, 0x05).await?;
            return Ok(());
        }
    };

    stream
        .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await?;

    relay_tcp_and_channel(stream, channel).await;
    Ok(())
}

async fn reply_socks_fail(stream: &mut TcpStream, code: u8) -> io::Result<()> {
    stream
        .write_all(&[0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await
}

/// Consume inbound remote-forward channels and connect them to local destinations.
pub async fn run_remote_accept_loop(
    mut incoming: mpsc::UnboundedReceiver<IncomingForward>,
    map: RemoteForwardMap,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() {
                    break;
                }
            }
            item = incoming.recv() => {
                let Some(item) = item else { break };
                let dest = {
                    let guard = map.lock().await;
                    find_dest(&guard, &item.connected_address, item.connected_port as u16)
                };
                let Some((dest_host, dest_port)) = dest else {
                    tracing::warn!(
                        addr = %item.connected_address,
                        port = item.connected_port,
                        "no remote forward destination registered"
                    );
                    continue;
                };
                tokio::spawn(async move {
                    let addr = format!("{dest_host}:{dest_port}");
                    let stream = match TcpStream::connect(&addr).await {
                        Ok(s) => s,
                        Err(e) => {
                            tracing::warn!(error = %e, %addr, "remote forward connect failed");
                            return;
                        }
                    };
                    relay_tcp_and_channel(stream, item.channel).await;
                });
            }
        }
    }
}

fn find_dest(entries: &[RemoteForwardEntry], addr: &str, port: u16) -> Option<(String, u16)> {
    entries
        .iter()
        .find(|e| {
            e.bind_port == port
                && (e.bind_host == addr
                    || e.bind_host == "0.0.0.0"
                    || e.bind_host == "*"
                    || addr.is_empty())
        })
        .or_else(|| entries.iter().find(|e| e.bind_port == port))
        .map(|e| (e.dest_host.clone(), e.dest_port))
}
