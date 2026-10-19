use std::path::PathBuf;

#[cfg(windows)]
use std::process::Command;

/// Local shell entry kinds shown in the session tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalShellKind {
    DefaultShell,
    Wsl,
    Powershell,
}

impl LocalShellKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::DefaultShell => "Local Shell",
            Self::Wsl => "WSL",
            Self::Powershell => "PowerShell Core",
        }
    }

    pub fn unavailable_hint(self) -> &'static str {
        match self {
            Self::DefaultShell => "当前平台无可用本地 Shell",
            Self::Wsl => "当前平台不支持 WSL",
            Self::Powershell => "未检测到 pwsh / PowerShell",
        }
    }
}

#[derive(Debug, Clone)]
pub struct PlatformCaps {
    pub default_shell: Option<PathBuf>,
    pub wsl_distros: Vec<String>,
    pub powershell: Option<PathBuf>,
}

impl PlatformCaps {
    pub fn detect() -> Self {
        Self {
            default_shell: detect_default_shell(),
            wsl_distros: detect_wsl_distros(),
            powershell: detect_powershell(),
        }
    }

    pub fn is_available(&self, kind: LocalShellKind) -> bool {
        match kind {
            LocalShellKind::DefaultShell => self.default_shell.is_some(),
            LocalShellKind::Wsl => !self.wsl_distros.is_empty(),
            LocalShellKind::Powershell => self.powershell.is_some(),
        }
    }

    pub fn command_for(&self, kind: LocalShellKind) -> Option<(PathBuf, Vec<String>)> {
        match kind {
            LocalShellKind::DefaultShell => self.default_shell.clone().map(|p| (p, Vec::new())),
            LocalShellKind::Wsl => {
                if self.wsl_distros.is_empty() {
                    None
                } else {
                    Some((PathBuf::from("wsl"), Vec::new()))
                }
            }
            LocalShellKind::Powershell => self.powershell.clone().map(|p| (p, Vec::new())),
        }
    }
}

fn detect_default_shell() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(ps) = detect_powershell() {
            return Some(ps);
        }
        Some(PathBuf::from("cmd.exe"))
    }
    #[cfg(not(windows))]
    {
        if let Ok(shell) = std::env::var("SHELL") {
            let p = PathBuf::from(&shell);
            if p.exists() {
                return Some(p);
            }
        }
        for candidate in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
            let p = PathBuf::from(candidate);
            if p.exists() {
                return Some(p);
            }
        }
        None
    }
}

fn detect_wsl_distros() -> Vec<String> {
    #[cfg(windows)]
    {
        let Ok(output) = Command::new("wsl").args(["-l", "-q"]).output() else {
            return Vec::new();
        };
        if !output.status.success() {
            return Vec::new();
        }
        let text = decode_wsl_list(&output.stdout);
        text.lines()
            .map(|l| l.trim().trim_start_matches('\u{feff}').to_string())
            .filter(|l| !l.is_empty())
            .collect()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[cfg(windows)]
fn decode_wsl_list(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[1] == 0 {
        let u16s: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&u16s)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

fn detect_powershell() -> Option<PathBuf> {
    which::which("pwsh")
        .or_else(|_| which::which("powershell"))
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_runs() {
        let caps = PlatformCaps::detect();
        #[cfg(target_os = "macos")]
        {
            assert!(caps.default_shell.is_some());
            assert!(!caps.is_available(LocalShellKind::Wsl));
        }
        let _ = caps;
    }
}
