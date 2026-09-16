use crate::error::{AppError, AppResult};
use crate::models::{
    Host, ImportMode, ImportReport, ImportSectionReport, LanExportData, TodoItem, VaultEntry,
};
use crate::poetry::model::PoetryTranslation;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::collections::HashSet;

use super::ai::{translation_mode_to_db, translation_source_to_db, validate_translation};
use super::export::{decrypt_envelope, parse_document, section_from_key};
use super::{now_ms, Storage};

struct Counts {
    inserted: u32,
    updated: u32,
}

fn import_vault(conn: &Connection, value: &Value, mode: ImportMode) -> AppResult<Counts> {
    let entries: Vec<VaultEntry> = serde_json::from_value(value.clone())
        .map_err(|e| AppError(format!("invalid vault data: {e}")))?;
    let mut counts = Counts {
        inserted: 0,
        updated: 0,
    };
    if mode == ImportMode::Overwrite {
        conn.execute("DELETE FROM vault_entries", [])?;
    }
    let mut next_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM vault_entries",
        [],
        |row| row.get(0),
    )?;
    for mut entry in entries {
        if mode == ImportMode::Append {
            entry.id = uuid::Uuid::new_v4().to_string();
        }
        if mode == ImportMode::Merge {
            let updated = conn.execute(
                r#"
                UPDATE vault_entries SET
                    title = ?2, url = ?3, username = ?4, password = ?5,
                    category = ?6, notes = ?7, updated_at = ?8
                WHERE id = ?1
                "#,
                params![
                    entry.id,
                    entry.title,
                    entry.url,
                    entry.username,
                    entry.password,
                    entry.category,
                    entry.notes,
                    now_ms(),
                ],
            )?;
            if updated > 0 {
                counts.updated += 1;
                continue;
            }
        }
        conn.execute(
            r#"
            INSERT INTO vault_entries(
                id, title, url, username, password, category, notes, sort_order,
                created_at, updated_at
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
            params![
                entry.id,
                entry.title,
                entry.url,
                entry.username,
                entry.password,
                entry.category,
                entry.notes,
                next_order,
                entry.created_at,
                entry.updated_at,
            ],
        )?;
        next_order += 1;
        counts.inserted += 1;
    }
    Ok(counts)
}

fn import_hosts(conn: &Connection, value: &Value, mode: ImportMode) -> AppResult<Counts> {
    let hosts: Vec<Host> = serde_json::from_value(value.clone())
        .map_err(|e| AppError(format!("invalid hosts data: {e}")))?;
    let mut counts = Counts {
        inserted: 0,
        updated: 0,
    };
    // Imported hosts may reference SSH keys that don't exist on this machine;
    // drop those references instead of leaving dangling ids.
    let known_keys: HashSet<String> = {
        let mut stmt = conn.prepare("SELECT id FROM ssh_keys")?;
        let keys = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<_, _>>()?;
        keys
    };
    if mode == ImportMode::Overwrite {
        conn.execute("DELETE FROM hosts", [])?;
    }
    let mut next_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM hosts",
        [],
        |row| row.get(0),
    )?;
    for mut host in hosts {
        host.key_id = host.key_id.filter(|id| known_keys.contains(id));
        if mode == ImportMode::Append {
            host.id = uuid::Uuid::new_v4().to_string();
        }
        let auth_type = match host.auth_type {
            crate::models::AuthType::Password => "password",
            crate::models::AuthType::Key => "key",
        };
        if mode == ImportMode::Merge {
            let updated = conn.execute(
                r#"
                UPDATE hosts SET
                    label = ?2, host = ?3, port = ?4, username = ?5, auth_type = ?6,
                    password = ?7, key_id = ?8, default_path = ?9, updated_at = ?10
                WHERE id = ?1
                "#,
                params![
                    host.id,
                    host.label,
                    host.host,
                    host.port,
                    host.username,
                    auth_type,
                    host.password,
                    host.key_id,
                    host.default_path,
                    now_ms(),
                ],
            )?;
            if updated > 0 {
                counts.updated += 1;
                continue;
            }
        }
        conn.execute(
            r#"
            INSERT INTO hosts(
                id, label, host, port, username, auth_type, password, key_id,
                default_path, sort_order, created_at, updated_at
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
            params![
                host.id,
                host.label,
                host.host,
                host.port,
                host.username,
                auth_type,
                host.password,
                host.key_id,
                host.default_path,
                next_order,
                host.created_at,
                host.updated_at,
            ],
        )?;
        next_order += 1;
        counts.inserted += 1;
    }
    Ok(counts)
}

fn import_todo(conn: &Connection, value: &Value, mode: ImportMode) -> AppResult<Counts> {
    let items: Vec<TodoItem> = serde_json::from_value(value.clone())
        .map_err(|e| AppError(format!("invalid todo data: {e}")))?;
    let mut counts = Counts {
        inserted: 0,
        updated: 0,
    };
    if mode == ImportMode::Overwrite {
        conn.execute("DELETE FROM todo_items", [])?;
    }
    for mut item in items {
        if mode == ImportMode::Append {
            item.id = uuid::Uuid::new_v4().to_string();
        }
        if mode == ImportMode::Merge {
            let updated = conn.execute(
                "UPDATE todo_items SET title=?2, category=?3, notes=?4, due_date=?5, completed=?6, updated_at=?7 WHERE id=?1",
                params![item.id, item.title, item.category, item.notes, item.due_date, item.completed as i64, now_ms()],
            )?;
            if updated > 0 {
                counts.updated += 1;
                continue;
            }
        }
        conn.execute(
            "INSERT INTO todo_items(id,title,category,notes,due_date,completed,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![item.id, item.title, item.category, item.notes, item.due_date, item.completed as i64, item.created_at, item.updated_at],
        )?;
        counts.inserted += 1;
    }
    Ok(counts)
}

fn import_lan(conn: &Connection, value: &Value, mode: ImportMode) -> AppResult<Counts> {
    let data: LanExportData = serde_json::from_value(value.clone())
        .map_err(|e| AppError(format!("invalid lan data: {e}")))?;
    let mut counts = Counts {
        inserted: 0,
        updated: 0,
    };
    if mode == ImportMode::Overwrite {
        conn.execute("DELETE FROM lan_transfer_settings", [])?;
        conn.execute("DELETE FROM lan_shared_dirs", [])?;
        conn.execute("DELETE FROM lan_trusted_devices", [])?;
        conn.execute(
            "INSERT INTO lan_transfer_settings(id,device_name,port,bind_host,download_dir,auto_start,security_mode,default_permission,max_concurrent_transfers) VALUES(1,?1,?2,?3,?4,?5,?6,?7,?8)",
            params![data.settings.device_name, data.settings.port, data.settings.bind_host, data.settings.download_dir, data.settings.auto_start as i64, data.settings.security_mode, data.settings.default_permission, data.settings.max_concurrent_transfers],
        )?;
        counts.updated += 1;
    } else if mode == ImportMode::Merge {
        conn.execute(
            "INSERT INTO lan_transfer_settings(id,device_name,port,bind_host,download_dir,auto_start,security_mode,default_permission,max_concurrent_transfers) VALUES(1,?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO UPDATE SET device_name=excluded.device_name,port=excluded.port,bind_host=excluded.bind_host,download_dir=excluded.download_dir,auto_start=excluded.auto_start,security_mode=excluded.security_mode,default_permission=excluded.default_permission,max_concurrent_transfers=excluded.max_concurrent_transfers",
            params![data.settings.device_name, data.settings.port, data.settings.bind_host, data.settings.download_dir, data.settings.auto_start as i64, data.settings.security_mode, data.settings.default_permission, data.settings.max_concurrent_transfers],
        )?;
        counts.updated += 1;
    }
    for mut dir in data.shared_dirs {
        if mode == ImportMode::Append {
            dir.id = uuid::Uuid::new_v4().to_string();
        }
        if mode == ImportMode::Merge {
            let updated = conn.execute(
                "UPDATE lan_shared_dirs SET name=?2,path=?3 WHERE id=?1",
                params![dir.id, dir.name, dir.path],
            )?;
            if updated > 0 {
                counts.updated += 1;
                continue;
            }
        }
        conn.execute(
            "INSERT INTO lan_shared_dirs(id,name,path,created_at) VALUES(?1,?2,?3,?4)",
            params![dir.id, dir.name, dir.path, dir.created_at],
        )?;
        counts.inserted += 1;
    }
    for mut device in data.trusted_devices {
        if mode == ImportMode::Append {
            device.id = uuid::Uuid::new_v4().to_string();
        }
        if mode == ImportMode::Merge {
            let updated = conn.execute(
                "UPDATE lan_trusted_devices SET label=?2,ip=?3 WHERE id=?1",
                params![device.id, device.label, device.ip],
            )?;
            if updated > 0 {
                counts.updated += 1;
                continue;
            }
        }
        conn.execute(
            "INSERT INTO lan_trusted_devices(id,label,ip,created_at) VALUES(?1,?2,?3,?4)",
            params![device.id, device.label, device.ip, device.created_at],
        )?;
        counts.inserted += 1;
    }
    Ok(counts)
}

fn import_ai_translations(conn: &Connection, value: &Value, mode: ImportMode) -> AppResult<Counts> {
    let mut translations: Vec<PoetryTranslation> = serde_json::from_value(value.clone())
        .map_err(|error| AppError(format!("invalid AI translation data: {error}")))?;
    for translation in &translations {
        validate_translation(translation)?;
    }
    if mode == ImportMode::Overwrite {
        conn.execute("DELETE FROM ai_poetry_translations", [])?;
    }
    let mut counts = Counts {
        inserted: 0,
        updated: 0,
    };
    for translation in &mut translations {
        if mode == ImportMode::Append {
            translation.id = uuid::Uuid::new_v4().to_string();
            counts.inserted += conn.execute(
                r#"
                INSERT OR IGNORE INTO ai_poetry_translations(
                    id, poem_uid, body_fingerprint, language, mode, prompt_version,
                    content, source, model, created_at, updated_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                "#,
                params![
                    translation.id,
                    translation.poem_uid,
                    translation.body_fingerprint,
                    translation.language,
                    translation_mode_to_db(translation.mode),
                    translation.prompt_version,
                    translation.content,
                    translation_source_to_db(translation.source),
                    translation.model,
                    translation.created_at,
                    translation.updated_at,
                ],
            )? as u32;
            continue;
        }
        if mode == ImportMode::Merge {
            let updated = conn.execute(
                r#"
                UPDATE ai_poetry_translations
                SET content = ?6, source = ?7, model = ?8,
                    created_at = ?9, updated_at = ?10
                WHERE poem_uid = ?1 AND body_fingerprint = ?2
                  AND language = ?3 AND mode = ?4 AND prompt_version = ?5
                "#,
                params![
                    translation.poem_uid,
                    translation.body_fingerprint,
                    translation.language,
                    translation_mode_to_db(translation.mode),
                    translation.prompt_version,
                    translation.content,
                    translation_source_to_db(translation.source),
                    translation.model,
                    translation.created_at,
                    translation.updated_at,
                ],
            )?;
            if updated > 0 {
                counts.updated += 1;
                continue;
            }
        }
        conn.execute(
            r#"
            INSERT INTO ai_poetry_translations(
                id, poem_uid, body_fingerprint, language, mode, prompt_version,
                content, source, model, created_at, updated_at
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#,
            params![
                translation.id,
                translation.poem_uid,
                translation.body_fingerprint,
                translation.language,
                translation_mode_to_db(translation.mode),
                translation.prompt_version,
                translation.content,
                translation_source_to_db(translation.source),
                translation.model,
                translation.created_at,
                translation.updated_at,
            ],
        )?;
        counts.inserted += 1;
    }
    Ok(counts)
}

impl Storage {
    /// Apply an export file to the local database. Detects encryption from the
    /// envelope; `password` is required for encrypted files.
    pub fn import_document(
        &self,
        raw: &str,
        password: Option<&str>,
        mode: ImportMode,
    ) -> AppResult<ImportReport> {
        let doc = parse_document(raw)?;
        let plain = if doc.get("encrypted").and_then(Value::as_bool) == Some(true) {
            let password = password
                .filter(|p| !p.is_empty())
                .ok_or_else(|| AppError("password required for encrypted file".into()))?;
            decrypt_envelope(&doc, password)?
        } else {
            Value::Object(doc)
        };
        let sections = plain
            .get("sections")
            .and_then(Value::as_object)
            .ok_or_else(|| AppError("export file has no sections".into()))?;

        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        let mut report = ImportReport {
            sections: Vec::new(),
        };
        for (key, value) in sections {
            let Some(section) = section_from_key(key) else {
                continue; // Unknown sections from newer versions are skipped.
            };
            let counts = match section {
                crate::models::ExportSection::Vault => import_vault(&tx, value, mode)?,
                crate::models::ExportSection::Hosts => import_hosts(&tx, value, mode)?,
                crate::models::ExportSection::Todo => import_todo(&tx, value, mode)?,
                crate::models::ExportSection::Lan => import_lan(&tx, value, mode)?,
                crate::models::ExportSection::AiTranslations => {
                    import_ai_translations(&tx, value, mode)?
                }
            };
            report.sections.push(ImportSectionReport {
                section,
                inserted: counts.inserted,
                updated: counts.updated,
            });
        }
        tx.commit()?;
        Ok(report)
    }
}
