use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::error::{Result, StoreError};
use crate::models::*;
use crate::paths::database_path;

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open_default() -> Result<Self> {
        let path = database_path()?;
        Self::open(&path)
    }

    pub fn open(path: &std::path::Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS app_meta (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
                sort INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY NOT NULL,
                folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                host TEXT,
                port INTEGER,
                username TEXT,
                auth_type TEXT,
                key_path TEXT,
                save_password INTEGER NOT NULL DEFAULT 0,
                local_subtype TEXT,
                extra_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS transfers (
                id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT,
                direction TEXT NOT NULL,
                local_path TEXT NOT NULL,
                remote_path TEXT NOT NULL,
                bytes INTEGER NOT NULL,
                status TEXT NOT NULL,
                error TEXT,
                created_at TEXT NOT NULL,
                finished_at TEXT
            );
            "#,
        )?;

        let version: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM app_meta WHERE key = 'schema_version'",
                [],
                |r| r.get(0),
            )
            .optional()?;

        self.ensure_system_key_column()?;

        match version.as_deref() {
            None => {
                self.conn.execute(
                    "INSERT INTO app_meta(key, value) VALUES ('schema_version', '3')",
                    [],
                )?;
                self.seed_defaults()?;
            }
            Some("1" | "2") => {
                self.conn.execute(
                    "UPDATE app_meta SET value = '3' WHERE key = 'schema_version'",
                    [],
                )?;
            }
            Some("3") => {}
            Some(other) => {
                return Err(StoreError::Invalid(format!(
                    "unsupported schema version {other}"
                )));
            }
        }
        self.ensure_local_group()?;
        Ok(())
    }

    fn ensure_system_key_column(&self) -> Result<()> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(folders)")?;
        let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut present = false;
        for name in names {
            if name? == "system_key" {
                present = true;
                break;
            }
        }
        if !present {
            self.conn
                .execute("ALTER TABLE folders ADD COLUMN system_key TEXT", [])?;
        }
        Ok(())
    }

    fn ensure_local_group(&self) -> Result<()> {
        let existing: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM folders WHERE system_key = 'local'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let by_name: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM folders WHERE name = '本地会话 (Personal)' ORDER BY sort LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let folder_id = if let Some(id) = existing.or(by_name) {
            self.conn.execute(
                "UPDATE folders SET system_key = 'local', name = '本地会话 (Personal)' WHERE id = ?1",
                params![id],
            )?;
            id
        } else {
            let id = Uuid::new_v4();
            self.insert_folder_raw(id, "本地会话 (Personal)", None, 0, Some("local"))?;
            id.to_string()
        };

        self.conn.execute(
            "UPDATE sessions SET folder_id = NULL WHERE kind = 'ssh' AND folder_id = ?1",
            params![folder_id],
        )?;

        let now = Utc::now().to_rfc3339();
        let mut kept = Vec::new();
        for (name, subtype) in [
            ("Local Shell", LocalSubtype::DefaultShell),
            ("PowerShell", LocalSubtype::Powershell),
            ("WSL", LocalSubtype::Wsl),
        ] {
            let found: Option<String> = self
                .conn
                .query_row(
                    "SELECT id FROM sessions WHERE kind = 'local' AND local_subtype = ?1 LIMIT 1",
                    params![subtype.as_str()],
                    |row| row.get(0),
                )
                .optional()?;
            let id = if let Some(id) = found {
                self.conn.execute(
                    "UPDATE sessions SET folder_id = ?1, name = ?2, updated_at = ?3 WHERE id = ?4",
                    params![folder_id, name, now, id],
                )?;
                id
            } else {
                let id = Uuid::new_v4().to_string();
                self.conn.execute(
                    r#"INSERT INTO sessions
                    (id, folder_id, name, kind, host, port, username, auth_type, key_path,
                     save_password, local_subtype, extra_json, created_at, updated_at)
                    VALUES (?1, ?2, ?3, 'local', NULL, NULL, NULL, NULL, NULL, 0, ?4, NULL, ?5, ?5)"#,
                    params![id, folder_id, name, subtype.as_str(), now],
                )?;
                id
            };
            kept.push(id);
        }
        self.conn.execute(
            "DELETE FROM sessions WHERE kind = 'local' AND id NOT IN (?1, ?2, ?3)",
            params![kept[0], kept[1], kept[2]],
        )?;
        Ok(())
    }

    fn seed_defaults(&self) -> Result<()> {
        let personal = Uuid::new_v4();
        let remote = Uuid::new_v4();
        self.insert_folder_raw(personal, "本地会话 (Personal)", None, 0, Some("local"))?;
        self.insert_folder_raw(remote, "远程主机", None, 1, None)?;

        let now = Utc::now();
        for (name, subtype, _sort) in [
            ("Local Shell", LocalSubtype::DefaultShell, 0),
            ("PowerShell", LocalSubtype::Powershell, 1),
            ("WSL", LocalSubtype::Wsl, 2),
        ] {
            let id = Uuid::new_v4();
            self.conn.execute(
                r#"INSERT INTO sessions
                (id, folder_id, name, kind, host, port, username, auth_type, key_path,
                 save_password, local_subtype, extra_json, created_at, updated_at)
                VALUES (?1, ?2, ?3, 'local', NULL, NULL, NULL, NULL, NULL, 0, ?4, NULL, ?5, ?5)"#,
                params![
                    id.to_string(),
                    personal.to_string(),
                    name,
                    subtype.as_str(),
                    now.to_rfc3339(),
                ],
            )?;
        }
        Ok(())
    }

    fn insert_folder_raw(
        &self,
        id: Uuid,
        name: &str,
        parent_id: Option<Uuid>,
        sort: i64,
        system_key: Option<&str>,
    ) -> Result<()> {
        self.conn.execute(
            "INSERT INTO folders(id, name, parent_id, sort, system_key) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id.to_string(),
                name,
                parent_id.map(|u| u.to_string()),
                sort,
                system_key
            ],
        )?;
        Ok(())
    }

    pub fn list_folders(&self) -> Result<Vec<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, parent_id, sort, system_key FROM folders ORDER BY sort, name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Folder {
                id: parse_uuid(r.get::<_, String>(0)?)?,
                name: r.get(1)?,
                parent_id: r
                    .get::<_, Option<String>>(2)?
                    .map(|s| parse_uuid(s))
                    .transpose()?,
                sort: r.get(3)?,
                system_key: r.get(4)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn create_folder(&self, name: &str, parent_id: Option<Uuid>) -> Result<Folder> {
        let id = Uuid::new_v4();
        let sort = self.next_folder_sort(parent_id)?;
        self.insert_folder_raw(id, name, parent_id, sort, None)?;
        Ok(Folder {
            id,
            name: name.to_string(),
            parent_id,
            sort,
            system_key: None,
        })
    }

    fn next_folder_sort(&self, parent_id: Option<Uuid>) -> Result<i64> {
        let max: Option<i64> = match parent_id {
            Some(pid) => self.conn.query_row(
                "SELECT MAX(sort) FROM folders WHERE parent_id = ?1",
                params![pid.to_string()],
                |r| r.get(0),
            )?,
            None => self.conn.query_row(
                "SELECT MAX(sort) FROM folders WHERE parent_id IS NULL",
                [],
                |r| r.get(0),
            )?,
        };
        Ok(max.unwrap_or(-1) + 1)
    }

    pub fn rename_folder(&self, id: Uuid, name: &str) -> Result<()> {
        self.reject_system_folder(id)?;
        let n = self.conn.execute(
            "UPDATE folders SET name = ?2 WHERE id = ?1",
            params![id.to_string(), name],
        )?;
        if n == 0 {
            return Err(StoreError::NotFound(format!("folder {id}")));
        }
        Ok(())
    }

    pub fn delete_folder(&self, id: Uuid) -> Result<()> {
        self.reject_system_folder(id)?;
        let n = self
            .conn
            .execute("DELETE FROM folders WHERE id = ?1", params![id.to_string()])?;
        if n == 0 {
            return Err(StoreError::NotFound(format!("folder {id}")));
        }
        Ok(())
    }

    fn reject_system_folder(&self, id: Uuid) -> Result<()> {
        let found: Option<Option<String>> = self
            .conn
            .query_row(
                "SELECT system_key FROM folders WHERE id = ?1",
                params![id.to_string()],
                |row| row.get(0),
            )
            .optional()?;
        match found {
            None => Err(StoreError::NotFound(format!("folder {id}"))),
            Some(Some(_)) => Err(StoreError::Other("系统分组不能修改或删除".into())),
            Some(None) => Ok(()),
        }
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let mut stmt = self.conn.prepare(
            r#"SELECT id, folder_id, name, kind, host, port, username, auth_type, key_path,
                      save_password, local_subtype, extra_json, created_at, updated_at
               FROM sessions ORDER BY name"#,
        )?;
        let rows = stmt.query_map([], map_session)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn get_session(&self, id: Uuid) -> Result<Session> {
        self.conn
            .query_row(
                r#"SELECT id, folder_id, name, kind, host, port, username, auth_type, key_path,
                          save_password, local_subtype, extra_json, created_at, updated_at
                   FROM sessions WHERE id = ?1"#,
                params![id.to_string()],
                map_session,
            )
            .optional()?
            .ok_or_else(|| StoreError::NotFound(format!("session {id}")))
    }

    fn reject_local_folder(&self, folder_id: Option<Uuid>) -> Result<()> {
        let Some(folder_id) = folder_id else {
            return Ok(());
        };
        let key: Option<String> = self
            .conn
            .query_row(
                "SELECT system_key FROM folders WHERE id = ?1",
                params![folder_id.to_string()],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        if key.as_deref() == Some("local") {
            return Err(StoreError::Invalid("不能把连接放入本地会话".into()));
        }
        Ok(())
    }

    pub fn ssh_identity_exists(
        &self,
        name: &str,
        host: &str,
        port: u16,
        username: &str,
        except: Option<Uuid>,
    ) -> Result<bool> {
        let except_id = except.map(|id| id.to_string()).unwrap_or_default();
        let exists: i64 = self.conn.query_row(
            r#"SELECT EXISTS(
                SELECT 1 FROM sessions
                WHERE kind = 'ssh' AND name = ?1 AND host = ?2 AND port = ?3 AND username = ?4
                  AND id != ?5
            )"#,
            params![name, host, port as i64, username, except_id],
            |row| row.get(0),
        )?;
        Ok(exists != 0)
    }

    pub fn create_ssh_session(&self, input: NewSshSession) -> Result<Session> {
        self.reject_local_folder(input.folder_id)?;
        if self.ssh_identity_exists(&input.name, &input.host, input.port, &input.username, None)? {
            return Err(StoreError::Other("已存在该连接信息".into()));
        }
        let id = Uuid::new_v4();
        let now = Utc::now();
        self.conn.execute(
            r#"INSERT INTO sessions
            (id, folder_id, name, kind, host, port, username, auth_type, key_path,
             save_password, local_subtype, extra_json, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'ssh', ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, ?10, ?10)"#,
            params![
                id.to_string(),
                input.folder_id.map(|u| u.to_string()),
                input.name,
                input.host,
                input.port as i64,
                input.username,
                input.auth_type.as_str(),
                input.key_path,
                input.save_password as i64,
                now.to_rfc3339(),
            ],
        )?;
        self.get_session(id)
    }

    pub fn create_local_session(&self, input: NewLocalSession) -> Result<Session> {
        let id = Uuid::new_v4();
        let now = Utc::now();
        self.conn.execute(
            r#"INSERT INTO sessions
            (id, folder_id, name, kind, host, port, username, auth_type, key_path,
             save_password, local_subtype, extra_json, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'local', NULL, NULL, NULL, NULL, NULL, 0, ?4, ?5, ?6, ?6)"#,
            params![
                id.to_string(),
                input.folder_id.map(|u| u.to_string()),
                input.name,
                input.subtype.as_str(),
                input.extra_json,
                now.to_rfc3339(),
            ],
        )?;
        self.get_session(id)
    }

    pub fn update_session(&self, session: &Session) -> Result<()> {
        if session.kind == SessionKind::Ssh {
            self.reject_local_folder(session.folder_id)?;
        }
        let n = self.conn.execute(
            r#"UPDATE sessions SET
                folder_id = ?2, name = ?3, host = ?4, port = ?5, username = ?6,
                auth_type = ?7, key_path = ?8, save_password = ?9, local_subtype = ?10,
                extra_json = ?11, updated_at = ?12
               WHERE id = ?1"#,
            params![
                session.id.to_string(),
                session.folder_id.map(|u| u.to_string()),
                session.name,
                session.host,
                session.port.map(|p| p as i64),
                session.username,
                session.auth_type.map(|a| a.as_str().to_string()),
                session.key_path,
                session.save_password as i64,
                session.local_subtype.map(|s| s.as_str().to_string()),
                session.extra_json,
                Utc::now().to_rfc3339(),
            ],
        )?;
        if n == 0 {
            return Err(StoreError::NotFound(format!("session {}", session.id)));
        }
        Ok(())
    }

    pub fn delete_session(&self, id: Uuid) -> Result<()> {
        let n = self.conn.execute(
            "DELETE FROM sessions WHERE id = ?1",
            params![id.to_string()],
        )?;
        if n == 0 {
            return Err(StoreError::NotFound(format!("session {id}")));
        }
        Ok(())
    }

    pub fn insert_transfer(&self, input: &NewTransfer) -> Result<()> {
        let now = Utc::now();
        self.conn.execute(
            r#"INSERT INTO transfers
            (id, session_id, direction, local_path, remote_path, bytes, status, error, created_at, finished_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)"#,
            params![
                input.id.to_string(),
                input.session_id.map(|id| id.to_string()),
                input.direction,
                input.local_path,
                input.remote_path,
                input.bytes as i64,
                input.status,
                input.error,
                now.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_transfers(&self) -> Result<Vec<TransferRecord>> {
        let mut stmt = self.conn.prepare(
            r#"SELECT id, session_id, direction, local_path, remote_path, bytes, status, error, created_at, finished_at
               FROM transfers ORDER BY created_at DESC LIMIT 100"#,
        )?;
        let rows = stmt.query_map([], |r| {
            let created: String = r.get(8)?;
            let finished: Option<String> = r.get(9)?;
            Ok(TransferRecord {
                id: parse_uuid(r.get::<_, String>(0)?)?,
                session_id: r.get::<_, Option<String>>(1)?.map(parse_uuid).transpose()?,
                direction: r.get(2)?,
                local_path: r.get(3)?,
                remote_path: r.get(4)?,
                bytes: r.get::<_, i64>(5)? as u64,
                status: r.get(6)?,
                error: r.get(7)?,
                created_at: created
                    .parse()
                    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
                finished_at: finished
                    .map(|s| s.parse())
                    .transpose()
                    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn search_sessions(&self, query: &str) -> Result<Vec<Session>> {
        let q = format!("%{query}%");
        let mut stmt = self.conn.prepare(
            r#"SELECT id, folder_id, name, kind, host, port, username, auth_type, key_path,
                      save_password, local_subtype, extra_json, created_at, updated_at
               FROM sessions
               WHERE name LIKE ?1 OR IFNULL(host,'') LIKE ?1 OR IFNULL(username,'') LIKE ?1
               ORDER BY name"#,
        )?;
        let rows = stmt.query_map(params![q], map_session)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }
}

fn parse_uuid(s: String) -> rusqlite::Result<Uuid> {
    Uuid::parse_str(&s).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
}

fn map_session(r: &rusqlite::Row<'_>) -> rusqlite::Result<Session> {
    let kind_s: String = r.get(3)?;
    let kind = SessionKind::parse(&kind_s).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            format!("unknown kind {kind_s}").into(),
        )
    })?;

    let auth = r
        .get::<_, Option<String>>(7)?
        .and_then(|s| AuthType::parse(&s));
    let local = r
        .get::<_, Option<String>>(10)?
        .and_then(|s| LocalSubtype::parse(&s));

    let created: String = r.get(12)?;
    let updated: String = r.get(13)?;

    Ok(Session {
        id: parse_uuid(r.get(0)?)?,
        folder_id: r.get::<_, Option<String>>(1)?.map(parse_uuid).transpose()?,
        name: r.get(2)?,
        kind,
        host: r.get(4)?,
        port: r.get::<_, Option<i64>>(5)?.map(|p| p as u16),
        username: r.get(6)?,
        auth_type: auth,
        key_path: r.get(8)?,
        save_password: r.get::<_, i64>(9)? != 0,
        local_subtype: local,
        extra_json: r.get(11)?,
        created_at: created
            .parse()
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
        updated_at: updated
            .parse()
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_and_crud() {
        let store = Store::open_in_memory().unwrap();
        let folders = store.list_folders().unwrap();
        assert!(folders.len() >= 2);
        let sessions = store.list_sessions().unwrap();
        assert_eq!(sessions.len(), 3);

        let ssh = store
            .create_ssh_session(NewSshSession {
                folder_id: Some(folders[1].id),
                name: "demo".into(),
                host: "10.0.0.1".into(),
                port: 22,
                username: "root".into(),
                auth_type: AuthType::Password,
                key_path: None,
                save_password: false,
            })
            .unwrap();
        assert_eq!(ssh.host.as_deref(), Some("10.0.0.1"));
        let duplicate = store.create_ssh_session(NewSshSession {
            folder_id: Some(folders[1].id),
            name: "demo".into(),
            host: "10.0.0.1".into(),
            port: 22,
            username: "root".into(),
            auth_type: AuthType::Password,
            key_path: None,
            save_password: false,
        });
        assert!(duplicate.is_err());
        store.delete_session(ssh.id).unwrap();

        let local = folders
            .iter()
            .find(|folder| folder.system_key.as_deref() == Some("local"));
        let rejected = store.create_ssh_session(NewSshSession {
            folder_id: local.map(|folder| folder.id),
            name: "blocked".into(),
            host: "10.0.0.2".into(),
            port: 22,
            username: "root".into(),
            auth_type: AuthType::Password,
            key_path: None,
            save_password: false,
        });
        assert!(rejected.is_err());
    }
}
