use crate::i18n::{text, Locale};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct QuickConnect {
    pub username: String,
    pub host: String,
    pub port: u16,
    pub key_path: Option<String>,
}

#[derive(Debug)]
pub enum QuickParseError {
    Empty,
    MissingKeyPath,
    UnknownFlag(String),
    BadTarget,
}

impl QuickParseError {
    pub fn localize(self, locale: Locale) -> String {
        match self {
            Self::Empty => text(
                locale,
                "请输入 user@host 或 user@host:port",
                "Enter user@host or user@host:port",
            ),
            Self::MissingKeyPath => text(
                locale,
                "-i 后面需要私钥路径",
                "A private key path is required after -i",
            ),
            Self::UnknownFlag(flag) => match locale {
                Locale::Zh => format!("无法识别的参数 {flag}"),
                Locale::En => format!("Unrecognized option {flag}"),
            },
            Self::BadTarget => text(
                locale,
                "地址格式应为 user@host 或 user@host:port",
                "The address should be user@host or user@host:port",
            ),
        }
    }
}

pub fn parse_quick_connect(input: &str) -> Result<QuickConnect, QuickParseError> {
    let mut parts = input.split_whitespace().filter(|p| *p != "ssh");
    let target = parts.next().ok_or(QuickParseError::Empty)?;
    let mut key_path = None;
    while let Some(flag) = parts.next() {
        if flag == "-i" {
            key_path = Some(
                parts
                    .next()
                    .ok_or(QuickParseError::MissingKeyPath)?
                    .to_string(),
            );
        } else {
            return Err(QuickParseError::UnknownFlag(flag.to_string()));
        }
    }
    let (username, host, port) = parse_target(target).ok_or(QuickParseError::BadTarget)?;
    Ok(QuickConnect {
        username,
        host,
        port,
        key_path,
    })
}

fn parse_target(token: &str) -> Option<(String, String, u16)> {
    let (user, hostport) = token.split_once('@')?;
    if user.is_empty() || hostport.is_empty() {
        return None;
    }
    if let Some(rest) = hostport.strip_prefix('[') {
        let (host, port) = rest.split_once("]:")?;
        let port = port.parse().ok()?;
        if host.is_empty() {
            return None;
        }
        return Some((user.to_string(), host.to_string(), port));
    }
    if let Some((host, port)) = hostport.rsplit_once(':') {
        if !host.is_empty() {
            if let Ok(port) = port.parse::<u16>() {
                return Some((user.to_string(), host.to_string(), port));
            }
        }
    }
    Some((user.to_string(), hostport.to_string(), 22))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ssh_style_target() {
        let parsed = parse_quick_connect("ssh root@10.0.4.12:22 -i id_ed25519").unwrap();
        assert_eq!(parsed.username, "root");
        assert_eq!(parsed.host, "10.0.4.12");
        assert_eq!(parsed.port, 22);
        assert_eq!(parsed.key_path.as_deref(), Some("id_ed25519"));
    }

    #[test]
    fn defaults_port() {
        let parsed = parse_quick_connect("dev@example.com").unwrap();
        assert_eq!(parsed.port, 22);
        assert!(parsed.key_path.is_none());
    }
}
