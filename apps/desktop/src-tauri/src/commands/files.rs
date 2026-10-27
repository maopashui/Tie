use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use tauri::State;

use crate::error::AppError;
use crate::i18n::{text, Locale};
use crate::session::{expand_path, FileEntry};
use crate::state::SharedState;

#[derive(Deserialize)]
pub struct LocalPathArgs {
    pub path: String,
}

#[tauri::command]
pub fn list_local(
    state: State<SharedState>,
    args: LocalPathArgs,
) -> Result<Vec<FileEntry>, AppError> {
    let locale = state.locale();
    let path = expand_path(&args.path);
    let meta = fs::metadata(&path).map_err(|e| {
        io_message(
            locale,
            "无法读取本地目录",
            "Could not read the local directory",
            &e,
        )
    })?;
    if !meta.is_dir() {
        return Err(AppError::Message(text(
            locale,
            "本地路径不是目录",
            "The local path is not a directory",
        )));
    }
    let mut entries = Vec::new();
    for item in fs::read_dir(&path).map_err(|e| {
        io_message(
            locale,
            "无法读取本地目录",
            "Could not read the local directory",
            &e,
        )
    })? {
        let item = item.map_err(|e| {
            io_message(
                locale,
                "无法读取目录项",
                "Could not read a directory entry",
                &e,
            )
        })?;
        let file_type = item.file_type().map_err(|e| {
            io_message(
                locale,
                "无法读取文件类型",
                "Could not read the file type",
                &e,
            )
        })?;
        let meta = item.metadata().map_err(|e| {
            io_message(
                locale,
                "无法读取文件信息",
                "Could not read file information",
                &e,
            )
        })?;
        let name = item.file_name().to_string_lossy().to_string();
        entries.push(FileEntry {
            path: item.path().display().to_string(),
            name,
            is_dir: file_type.is_dir(),
            size: if file_type.is_dir() { 0 } else { meta.len() },
            permissions: unix_mode(&meta),
            mtime: meta.modified().ok().and_then(|t| {
                t.duration_since(UNIX_EPOCH)
                    .ok()
                    .map(|d| d.as_secs() as i64)
            }),
            owner: None,
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[tauri::command]
pub fn make_local_dir(state: State<SharedState>, args: LocalPathArgs) -> Result<(), AppError> {
    let locale = state.locale();
    let path = expand_path(&args.path);
    validate_local(&path, locale)?;
    fs::create_dir(&path)
        .map_err(|e| io_message(locale, "创建目录失败", "Could not create the directory", &e))?;
    Ok(())
}

#[derive(Deserialize)]
pub struct RemoveLocalArgs {
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn remove_local(state: State<SharedState>, args: RemoveLocalArgs) -> Result<(), AppError> {
    let locale = state.locale();
    let path = expand_path(&args.path);
    validate_local(&path, locale)?;
    if args.is_dir {
        fs::remove_dir_all(&path).map_err(|e| {
            io_message(locale, "删除目录失败", "Could not delete the directory", &e)
        })?;
    } else {
        fs::remove_file(&path)
            .map_err(|e| io_message(locale, "删除文件失败", "Could not delete the file", &e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn home_dir(state: State<SharedState>) -> Result<String, AppError> {
    dirs::home_dir()
        .map(|p| p.display().to_string())
        .ok_or_else(|| {
            AppError::Message(
                state.text("无法定位用户主目录", "Could not locate the home directory"),
            )
        })
}

const SESSION_LOG_LIMIT: u64 = 10 * 1024 * 1024;

#[derive(Deserialize)]
pub struct AppendSessionLogArgs {
    pub path: String,
    pub index: u32,
    pub data: String,
}

#[derive(Serialize)]
pub struct AppendSessionLogResult {
    pub index: u32,
    pub path: String,
}

#[tauri::command]
pub fn append_session_log(
    state: State<SharedState>,
    args: AppendSessionLogArgs,
) -> Result<AppendSessionLogResult, AppError> {
    let locale = state.locale();
    if args.index == 0 || args.index > 9999 {
        return Err(AppError::Message(text(
            locale,
            "日志分段序号无效",
            "Invalid log segment index",
        )));
    }
    if args.data.is_empty() {
        return Err(AppError::Message(text(
            locale,
            "日志内容为空",
            "Log content is empty",
        )));
    }
    let base = expand_path(&args.path);
    validate_local(&base, locale)?;
    let mut index = args.index;
    let mut rest = args.data.as_str();
    let mut latest = segment_path(&base, index);
    while !rest.is_empty() {
        if index > 9999 {
            return Err(AppError::Message(text(
                locale,
                "日志分段已超过 9999",
                "Log segments exceeded 9999",
            )));
        }
        let path = segment_path(&base, index);
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() && !parent.is_dir() {
                return Err(AppError::Message(text(
                    locale,
                    "日志目录不存在",
                    "The log directory does not exist",
                )));
            }
        }
        let existing = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        if existing >= SESSION_LOG_LIMIT {
            index += 1;
            continue;
        }
        let room = (SESSION_LOG_LIMIT - existing) as usize;
        let (take, next) = split_log_chunk(rest, room);
        if take.is_empty() {
            index += 1;
            rest = next;
            continue;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|err| io_message(locale, "无法写入日志", "Could not write the log", &err))?;
        file.write_all(take.as_bytes())
            .map_err(|err| io_message(locale, "无法写入日志", "Could not write the log", &err))?;
        latest = path;
        rest = next;
        if !rest.is_empty() {
            index += 1;
        }
    }
    Ok(AppendSessionLogResult {
        index,
        path: latest.display().to_string(),
    })
}

fn segment_path(base: &Path, index: u32) -> PathBuf {
    let name = base
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "tie.log".into());
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem.to_string(), format!(".{ext}")),
        _ => (name, String::new()),
    };
    let parent = base.parent().unwrap_or_else(|| Path::new(""));
    parent.join(format!("{stem}-{index:03}{ext}"))
}

fn split_log_chunk(data: &str, room: usize) -> (&str, &str) {
    if room == 0 || data.is_empty() {
        return ("", data);
    }
    if data.len() <= room {
        return (data, "");
    }
    let mut end = room.min(data.len());
    while end > 0 && !data.is_char_boundary(end) {
        end -= 1;
    }
    if end == 0 {
        return ("", data);
    }
    if let Some(nl) = data[..end].rfind('\n') {
        if nl + 1 < end {
            end = nl + 1;
        }
    }
    (&data[..end], &data[end..])
}

fn validate_local(path: &PathBuf, locale: Locale) -> Result<(), AppError> {
    let value = path.to_string_lossy();
    if value.is_empty() || value.contains('\0') {
        return Err(AppError::Message(text(
            locale,
            "本地路径无效",
            "The local path is invalid",
        )));
    }
    Ok(())
}

fn io_message(locale: Locale, zh: &str, en: &str, err: &std::io::Error) -> AppError {
    AppError::Message(match locale {
        Locale::Zh => format!("{zh}: {err}"),
        Locale::En => format!("{en}: {err}"),
    })
}

#[cfg(unix)]
fn unix_mode(meta: &fs::Metadata) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    Some(meta.permissions().mode())
}

#[cfg(not(unix))]
fn unix_mode(_meta: &fs::Metadata) -> Option<u32> {
    None
}

#[cfg(test)]
mod tests {
    use super::{segment_path, split_log_chunk};
    use std::path::Path;

    #[test]
    fn segment_names_insert_index_before_extension() {
        let path = segment_path(Path::new("/tmp/tie-20261019.log"), 1);
        assert_eq!(path, Path::new("/tmp/tie-20261019-001.log"));
        let next = segment_path(Path::new("/tmp/tie-20261019.log"), 12);
        assert_eq!(next, Path::new("/tmp/tie-20261019-012.log"));
    }

    #[test]
    fn split_prefers_newline_inside_the_limit() {
        let (take, rest) = split_log_chunk("abc\ndefghij", 6);
        assert_eq!(take, "abc\n");
        assert_eq!(rest, "defghij");
    }
}
