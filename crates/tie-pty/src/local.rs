use std::io::{Read, Write};
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use crate::caps::{LocalShellKind, PlatformCaps};
use crate::error::{PtyError, Result};

pub struct LocalPty {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    reader: Mutex<Option<Box<dyn Read + Send>>>,
}

pub struct PtyReader {
    reader: Box<dyn Read + Send>,
}

pub struct PtyWriter {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl LocalPty {
    pub fn spawn(kind: LocalShellKind, cols: u16, rows: u16) -> Result<Self> {
        let caps = PlatformCaps::detect();
        let (program, args) = caps
            .command_for(kind)
            .ok_or_else(|| PtyError::Unavailable(kind.unavailable_hint().to_string()))?;

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::Pty(e.to_string()))?;

        let mut cmd = CommandBuilder::new(program);
        for a in args {
            cmd.arg(a);
        }
        cmd.env("TERM", "xterm-256color");
        if let Some(home) = dirs_home() {
            cmd.cwd(home);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::Pty(e.to_string()))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::Pty(e.to_string()))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::Pty(e.to_string()))?;

        Ok(Self {
            master: pair.master,
            child,
            writer: Arc::new(Mutex::new(writer)),
            reader: Mutex::new(Some(reader)),
        })
    }

    pub fn take_reader(&self) -> Result<PtyReader> {
        self.reader
            .lock()
            .take()
            .map(|reader| PtyReader { reader })
            .ok_or_else(|| PtyError::Other("pty reader already taken".into()))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::Pty(e.to_string()))
    }

    pub fn writer(&self) -> PtyWriter {
        PtyWriter {
            writer: Arc::clone(&self.writer),
        }
    }

    pub fn kill(&mut self) -> Result<()> {
        self.child
            .kill()
            .map_err(|e| PtyError::Pty(e.to_string()))
    }

    pub fn try_wait(&mut self) -> Result<Option<u32>> {
        match self.child.try_wait() {
            Ok(Some(status)) => Ok(Some(status.exit_code())),
            Ok(None) => Ok(None),
            Err(e) => Err(PtyError::Pty(e.to_string())),
        }
    }
}

impl PtyReader {
    pub fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.reader.read(buf)
    }
}

impl PtyWriter {
    pub fn write_all(&self, data: &[u8]) -> std::io::Result<()> {
        let mut w = self.writer.lock();
        w.write_all(data)?;
        w.flush()?;
        Ok(())
    }
}

fn dirs_home() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)
}
