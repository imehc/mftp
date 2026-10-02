use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::models::{ImportMode, ImportReport, ImportSectionReport};
use crate::modules::hosts::model::Host;
use crate::modules::lan_transfer::LanExportData;
use crate::modules::poetry::model::PoetryTranslation;
use crate::modules::todo::model::TodoItem;
use crate::modules::vault::model::VaultEntry;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::collections::HashSet;

use super::export::{decrypt_envelope, parse_document, section_from_key};
use super::{now_ms, Storage};
use crate::modules::poetry::translation_store::{mode_to_db, source_to_db, validate_translation};

// Section data comes from a user-supplied file; serde diagnostics could echo
// untrusted tokens, so only the stable section key is exposed as an argument.
fn invalid_section(section: &str) -> AppError {
    AppError::custom(CustomErrorCode::AppDataSectionInvalid).with_arg("section", section)
}

struct Counts {
    inserted: u32,
    updated: u32,
}

fn import_vault(conn: &Connection, value: &Value, mode: ImportMode) -> AppResult<Counts> {
    let entries: Vec<VaultEntry> =
        serde_json::from_value(value.clone()).map_err(|_| invalid_section("vault"))?;
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
    let hosts: Vec<Host> =
        serde_json::from_value(value.clone()).map_err(|_| invalid_section("hosts"))?;
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
            crate::modules::hosts::model::AuthType::Password => "password",
            crate::modules::hosts::model::AuthType::Key => "key",
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
    let items: Vec<TodoItem> =
        serde_json::from_value(value.clone()).map_err(|_| invalid_section("todo"))?;
    let mut counts = Counts {
        inserted: 0,
        updated: 0,
    };
    if mode == ImportMode::Overwrite {
        conn.execute("DELETE FROM todo_items", [])?;
    }
    for mut item in items {
        if [item.due_at, item.completed_at]
            .into_iter()
            .flatten()
            .any(|value| !(0..=253_402_300_799_999).contains(&value))
        {
            return Err(invalid_section("todo"));
        }
        if mode == ImportMode::Append {
            item.id = uuid::Uuid::new_v4().to_string();
        }
        if mode == ImportMode::Merge {
            let updated = conn.execute(
                "UPDATE todo_items SET title=?2, category=?3, notes=?4, due_date=?5, completed=?6, updated_at=?7, due_at=?8, completed_at=?9 WHERE id=?1",
                params![item.id, item.title, item.category, item.notes, item.due_date, item.completed as i64, now_ms(), item.due_at, item.completed_at.filter(|_| item.completed)],
            )?;
            if updated > 0 {
                counts.updated += 1;
                continue;
            }
        }
        conn.execute(
            "INSERT INTO todo_items(id,title,category,notes,due_date,completed,created_at,updated_at,due_at,completed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![item.id, item.title, item.category, item.notes, item.due_date, item.completed as i64, item.created_at, item.updated_at, item.due_at, item.completed_at.filter(|_| item.completed)],
        )?;
        counts.inserted += 1;
    }
    Ok(counts)
}

fn import_lan(conn: &Connection, value: &Value, mode: ImportMode) -> AppResult<Counts> {
    let data: LanExportData =
        serde_json::from_value(value.clone()).map_err(|_| invalid_section("lan"))?;
    let (inserted, updated) = crate::modules::lan_transfer::repository::import(conn, &data, mode)?;
    Ok(Counts { inserted, updated })
}

fn import_ai_translations(conn: &Connection, value: &Value, mode: ImportMode) -> AppResult<Counts> {
    let mut translations: Vec<PoetryTranslation> =
        serde_json::from_value(value.clone()).map_err(|_| invalid_section("aiTranslations"))?;
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
                    mode_to_db(translation.mode),
                    translation.prompt_version,
                    translation.content,
                    source_to_db(translation.source),
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
                    mode_to_db(translation.mode),
                    translation.prompt_version,
                    translation.content,
                    source_to_db(translation.source),
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
                mode_to_db(translation.mode),
                translation.prompt_version,
                translation.content,
                source_to_db(translation.source),
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
                .ok_or_else(|| AppError::custom(CustomErrorCode::AppDataPasswordRequired))?;
            decrypt_envelope(&doc, password)?
        } else {
            Value::Object(doc)
        };
        let sections = plain
            .get("sections")
            .and_then(Value::as_object)
            .ok_or_else(|| AppError::custom(CustomErrorCode::AppDataNoSections))?;

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
