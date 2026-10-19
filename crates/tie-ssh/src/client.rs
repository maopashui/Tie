use std::sync::Arc;

use russh::client::{self, Msg};
use russh::keys::{load_secret_key, PublicKeyOrCertificate};
use russh::{Channel, ChannelMsg, Disconnect, Preferred};
use tokio::sync::{mpsc, oneshot};

use crate::auth::{AuthMethod, ConnectRequest};
use crate::error::{Result, SshError};
use crate::known_hosts::{HostKeyDecision, HostKeyStatus, KnownHosts};
use crate::sftp::SftpClient;

pub struct SshClient {
    handle: client::Handle<ClientHandler>,
    host: String,
    port: u16,
}

pub struct SshShell {
    channel: Channel<Msg>,
}

struct ClientHandler {
    host: String,
    port: u16,
    known_hosts_path: std::path::PathBuf,
    decision_tx: Option<oneshot::Sender<(HostKeyStatus, String)>>,
    decision_rx: Option<oneshot::Receiver<HostKeyDecision>>,
}

impl client::Handler for ClientHandler {
    type Error = SshError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> std::result::Result<bool, Self::Error> {
        let PublicKeyOrCertificate::PublicKey { key, .. } = server_public_key else {
            return Err(SshError::HostKey(
                "SSH certificates are not accepted; a raw host key is required".into(),
            ));
        };

        let mut known = KnownHosts::load(&self.known_hosts_path)?;

        let status = known.check(&self.host, self.port, key);
        match status {
            HostKeyStatus::Match => Ok(true),
            HostKeyStatus::New | HostKeyStatus::Mismatch => {
                let fp = KnownHosts::fingerprint(key);
                if let Some(tx) = self.decision_tx.take() {
                    let _ = tx.send((status, fp.clone()));
                }
                let decision = if let Some(rx) = self.decision_rx.take() {
                    rx.await.unwrap_or(HostKeyDecision::Reject)
                } else {
                    // No UI channel: reject unknown keys by default
                    HostKeyDecision::Reject
                };
                match decision {
                    HostKeyDecision::Reject => Ok(false),
                    HostKeyDecision::AcceptOnce => Ok(true),
                    HostKeyDecision::AcceptAndSave => {
                        known.append(&self.host, self.port, key)?;
                        Ok(true)
                    }
                }
            }
        }
    }
}

impl SshClient {
    /// Connect with optional host-key confirmation channel.
    pub async fn connect(
        req: ConnectRequest,
        host_key_prompt: Option<(
            oneshot::Sender<(HostKeyStatus, String)>,
            oneshot::Receiver<HostKeyDecision>,
        )>,
    ) -> Result<Self> {
        let (decision_tx, decision_rx) = match host_key_prompt {
            Some((tx, rx)) => (Some(tx), Some(rx)),
            None => (None, None),
        };

        let config = client::Config {
            preferred: Preferred::DEFAULT,
            ..Default::default()
        };
        let config = Arc::new(config);

        let handler = ClientHandler {
            host: req.host.clone(),
            port: req.port,
            known_hosts_path: req.known_hosts_path.clone(),
            decision_tx,
            decision_rx,
        };

        let mut handle = client::connect(config, (req.host.as_str(), req.port), handler).await?;

        match &req.auth {
            AuthMethod::Password(password) => {
                let auth = handle
                    .authenticate_password(req.username.clone(), password.clone())
                    .await?;
                if !auth.success() {
                    return Err(SshError::Auth("password authentication failed".into()));
                }
            }
            AuthMethod::PrivateKey { path, passphrase } => {
                let key = load_secret_key(path, passphrase.as_deref())
                    .map_err(|e| SshError::Key(e.to_string()))?;
                let hash = handle.best_supported_rsa_hash().await?.flatten();
                let auth = handle
                    .authenticate_publickey(
                        req.username.clone(),
                        russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                    )
                    .await?;
                if !auth.success() {
                    return Err(SshError::Auth("public key authentication failed".into()));
                }
            }
        }

        Ok(Self {
            handle,
            host: req.host,
            port: req.port,
        })
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub async fn open_shell(&self, cols: u32, rows: u32) -> Result<SshShell> {
        let channel = self.handle.channel_open_session().await?;
        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await?;
        channel.request_shell(false).await?;
        Ok(SshShell { channel })
    }

    pub async fn open_sftp(&self) -> Result<SftpClient> {
        SftpClient::from_session(&self.handle).await
    }

    pub async fn disconnect(self) -> Result<()> {
        self.handle
            .disconnect(Disconnect::ByApplication, "bye", "en")
            .await?;
        Ok(())
    }
}

impl SshShell {
    pub fn into_split(self) -> (russh::ChannelReadHalf, russh::ChannelWriteHalf<Msg>) {
        self.channel.split()
    }

    pub async fn resize(&mut self, cols: u32, rows: u32) -> Result<()> {
        self.channel
            .window_change(cols, rows, 0, 0)
            .await
            .map_err(SshError::from)
    }

    pub async fn write_all(&mut self, data: &[u8]) -> Result<()> {
        self.channel.data(data).await?;
        Ok(())
    }

    /// Read next data chunk from the remote shell. Returns None on EOF/close.
    pub async fn read(&mut self) -> Result<Option<Vec<u8>>> {
        read_channel(&mut self.channel).await
    }
}

pub async fn read_half(channel: &mut russh::ChannelReadHalf) -> Result<Option<Vec<u8>>> {
    read_channel(channel).await
}

async fn read_channel(channel: &mut impl WaitChannel) -> Result<Option<Vec<u8>>> {
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { ref data }) => {
                return Ok(Some(data.to_vec()));
            }
            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                return Ok(Some(data.to_vec()));
            }
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                return Ok(None);
            }
            _ => continue,
        }
    }
}

trait WaitChannel {
    fn wait(&mut self) -> impl std::future::Future<Output = Option<ChannelMsg>> + Send;
}

impl WaitChannel for russh::Channel<Msg> {
    async fn wait(&mut self) -> Option<ChannelMsg> {
        russh::Channel::wait(self).await
    }
}

impl WaitChannel for russh::ChannelReadHalf {
    async fn wait(&mut self) -> Option<ChannelMsg> {
        russh::ChannelReadHalf::wait(self).await
    }
}

impl SshShell {
    /// Spawn a task that forwards channel output into an mpsc sender.
    pub fn spawn_reader(mut self, tx: mpsc::UnboundedSender<Vec<u8>>) {
        tokio::spawn(async move {
            while let Ok(Some(data)) = self.read().await {
                if tx.send(data).is_err() {
                    break;
                }
            }
        });
    }
}
