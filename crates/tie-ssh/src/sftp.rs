use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use russh::client;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;

use crate::error::{Result, SshError};

#[derive(Debug, Clone)]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub permissions: Option<u32>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub mtime: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct TransferProgress {
    pub path: String,
    pub transferred: u64,
    pub total: u64,
    pub done: bool,
    pub error: Option<String>,
}

pub struct SftpClient {
    sftp: SftpSession,
}

impl SftpClient {
    pub async fn from_session<H>(handle: &client::Handle<H>) -> Result<Self>
    where
        H: client::Handler + Send + 'static,
        H::Error: From<russh::Error> + Send,
    {
        let channel = handle.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| SshError::Sftp(e.to_string()))?;
        Ok(Self { sftp })
    }

    pub async fn read_dir(&self, path: &str) -> Result<Vec<RemoteEntry>> {
        let mut entries = Vec::new();
        let dir = self
            .sftp
            .read_dir(path)
            .await
            .map_err(|e| SshError::Sftp(e.to_string()))?;
        for entry in dir {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let meta = entry.metadata();
            let full = if path.ends_with('/') {
                format!("{path}{name}")
            } else {
                format!("{path}/{name}")
            };
            entries.push(RemoteEntry {
                name,
                path: full,
                is_dir: meta.file_type().is_dir(),
                size: meta.size.unwrap_or(0),
                permissions: meta.permissions,
                uid: meta.uid,
                gid: meta.gid,
                mtime: meta.mtime,
            });
        }
        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        Ok(entries)
    }

    pub async fn mkdir(&self, path: &str) -> Result<()> {
        self.sftp
            .create_dir(path)
            .await
            .map_err(|e| SshError::Sftp(e.to_string()))
    }

    pub async fn remove_file(&self, path: &str) -> Result<()> {
        self.sftp
            .remove_file(path)
            .await
            .map_err(|e| SshError::Sftp(e.to_string()))
    }

    pub async fn remove_dir(&self, path: &str) -> Result<()> {
        self.sftp
            .remove_dir(path)
            .await
            .map_err(|e| SshError::Sftp(e.to_string()))
    }

    pub async fn upload(
        &self,
        local: &Path,
        remote: &str,
        progress: Option<mpsc::UnboundedSender<TransferProgress>>,
        cancel: &AtomicBool,
    ) -> Result<()> {
        let mut file = File::open(local).await?;
        let total = file.metadata().await?.len();
        let mut remote_file = self
            .sftp
            .open_with_flags(
                remote,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            )
            .await
            .map_err(|e| SshError::Sftp(e.to_string()))?;

        let mut buf = vec![0u8; 64 * 1024];
        let mut transferred = 0u64;
        loop {
            if cancel.load(Ordering::Relaxed) {
                drop(remote_file);
                let _ = self.remove_file(remote).await;
                return Err(SshError::Other("cancelled".into()));
            }
            let n = file.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            remote_file
                .write_all(&buf[..n])
                .await
                .map_err(|e| SshError::Sftp(e.to_string()))?;
            transferred += n as u64;
            if let Some(tx) = &progress {
                let _ = tx.send(TransferProgress {
                    path: remote.to_string(),
                    transferred,
                    total,
                    done: false,
                    error: None,
                });
            }
        }
        remote_file
            .shutdown()
            .await
            .map_err(|e| SshError::Sftp(e.to_string()))?;
        if let Some(tx) = &progress {
            let _ = tx.send(TransferProgress {
                path: remote.to_string(),
                transferred,
                total,
                done: true,
                error: None,
            });
        }
        Ok(())
    }

    pub async fn download(
        &self,
        remote: &str,
        local: &Path,
        progress: Option<mpsc::UnboundedSender<TransferProgress>>,
        cancel: &AtomicBool,
    ) -> Result<()> {
        let meta = self
            .sftp
            .metadata(remote)
            .await
            .map_err(|e| SshError::Sftp(e.to_string()))?;
        let total = meta.size.unwrap_or(0);

        let mut remote_file = self
            .sftp
            .open(remote)
            .await
            .map_err(|e| SshError::Sftp(e.to_string()))?;
        if let Some(parent) = local.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let mut file = File::create(local).await?;

        let mut buf = vec![0u8; 64 * 1024];
        let mut transferred = 0u64;
        loop {
            if cancel.load(Ordering::Relaxed) {
                drop(file);
                let _ = tokio::fs::remove_file(local).await;
                return Err(SshError::Other("cancelled".into()));
            }
            let n = remote_file
                .read(&mut buf)
                .await
                .map_err(|e| SshError::Sftp(e.to_string()))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).await?;
            transferred += n as u64;
            if let Some(tx) = &progress {
                let _ = tx.send(TransferProgress {
                    path: remote.to_string(),
                    transferred,
                    total,
                    done: false,
                    error: None,
                });
            }
        }
        file.flush().await?;
        if total > 0 && transferred == 0 {
            drop(file);
            let _ = tokio::fs::remove_file(local).await;
            return Err(SshError::Sftp("远程文件没有读到内容".into()));
        }
        if let Some(tx) = &progress {
            let _ = tx.send(TransferProgress {
                path: remote.to_string(),
                transferred,
                total,
                done: true,
                error: None,
            });
        }
        Ok(())
    }
}
