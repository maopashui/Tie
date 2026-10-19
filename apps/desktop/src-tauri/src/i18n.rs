#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Locale {
    Zh,
    En,
}

impl Locale {
    pub fn parse(value: &str) -> Option<Self> {
        let value = value.trim().to_ascii_lowercase();
        if value == "en" || value.starts_with("en-") {
            Some(Self::En)
        } else if value == "zh" || value == "zh-cn" || value.starts_with("zh-") {
            Some(Self::Zh)
        } else {
            None
        }
    }

    pub fn system() -> Self {
        for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
            if let Ok(value) = std::env::var(key) {
                let lower = value.to_ascii_lowercase();
                if lower.starts_with("zh") {
                    return Self::Zh;
                }
                if lower.starts_with("en") {
                    return Self::En;
                }
            }
        }
        Self::Zh
    }
}

pub fn text(locale: Locale, zh: &str, en: &str) -> String {
    match locale {
        Locale::Zh => zh.to_string(),
        Locale::En => en.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_tags() {
        assert_eq!(Locale::parse("zh-CN"), Some(Locale::Zh));
        assert_eq!(Locale::parse("en"), Some(Locale::En));
        assert_eq!(Locale::parse("fr"), None);
    }
}
