mod commands;
mod error;
mod i18n;
mod local_term;
mod parse;
mod port_forward;
mod session;
mod state;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};
use tracing_subscriber::EnvFilter;

use crate::i18n::{text, Locale};
use crate::state::{AppState, SharedState};

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .on_menu_event(|app, event| {
            if event.id() == "close-tab" {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("close-tab", ());
                }
            }
        })
        .setup(|app| {
            let store = tie_store::Store::open_default().map_err(anyhow::Error::from)?;
            let shared = SharedState::new(AppState::new(store));
            let locale = shared.locale();
            app.manage(shared);
            #[cfg(target_os = "macos")]
            {
                install_menu(app.handle(), locale)?;
                if let Some(window) = app.get_webview_window("main") {
                    // Keep the in-app header as the only title. The system title bar stays
                    // transparent and overlaid so the traffic lights sit on that same row.
                    window.set_title("")?;
                    window.set_title_bar_style(tauri::TitleBarStyle::Overlay)?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_workspace,
            commands::create_folder,
            commands::update_folder,
            commands::delete_folder,
            commands::create_ssh_session,
            commands::update_ssh_session,
            commands::delete_session,
            commands::parse_quick,
            commands::start_ssh,
            commands::start_local,
            commands::start_ephemeral_ssh,
            commands::respond_host_key,
            commands::write_terminal,
            commands::resize_terminal,
            commands::disconnect,
            commands::sftp_list,
            commands::sftp_mkdir,
            commands::sftp_remove,
            commands::start_upload,
            commands::start_download,
            commands::cancel_transfer,
            commands::list_transfer_history,
            commands::list_local,
            commands::make_local_dir,
            commands::remove_local,
            commands::home_dir,
            commands::append_session_log,
            commands::set_locale,
            commands::start_port_forward,
            commands::stop_port_forward,
            commands::list_port_forwards,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tie");
}

/// Replace the default macOS menu so Command+W closes a tab instead of the window.
/// Command+Q stays on the application Quit item.
#[cfg(target_os = "macos")]
pub(crate) fn install_menu(app: &tauri::AppHandle, locale: Locale) -> tauri::Result<()> {
    let pkg = app.package_info();
    let config = app.config();
    let about = AboutMetadata {
        name: Some(pkg.name.clone()),
        version: Some(pkg.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };
    let close_tab = MenuItem::with_id(
        app,
        "close-tab",
        text(locale, "关闭标签", "Close Tab"),
        true,
        Some("CmdOrCtrl+W"),
    )?;
    let menu = Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                pkg.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, text(locale, "文件", "File"), true, &[&close_tab])?,
            &Submenu::with_items(
                app,
                text(locale, "编辑", "Edit"),
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                text(locale, "显示", "View"),
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            &Submenu::with_items(
                app,
                text(locale, "窗口", "Window"),
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                ],
            )?,
        ],
    )?;
    menu.set_as_app_menu()?;
    Ok(())
}
