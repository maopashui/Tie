use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::i18n::Locale;
use crate::state::SharedState;

#[tauri::command]
pub fn set_locale(
    #[allow(unused_variables)] app: AppHandle,
    state: State<SharedState>,
    locale: String,
) -> Result<(), AppError> {
    let locale = Locale::parse(&locale)
        .ok_or_else(|| AppError::Message(state.text("不支持的语言", "Unsupported language")))?;
    state.set_locale(locale);
    #[cfg(target_os = "macos")]
    crate::install_menu(&app, locale).map_err(|err| AppError::Message(err.to_string()))?;
    Ok(())
}
