//! Repository for the `ai_poetry_translations` table (shared app database).
//! Translation rows belong to the poetry domain even though AI generates them;
//! the table schema stays under the storage startup coordination because the
//! shared database must migrate it on every platform.

use rusqlite::{params, OptionalExtension};

use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::storage::{now_ms, Storage};

use super::model::{PoetryTranslation, PoetryTranslationMode, PoetryTranslationSource};

const TRANSLATION_CONTENT_LIMIT: usize = 64 * 1024;

type TranslationRow = (
    String,
    String,
    String,
    String,
    String,
    i64,
    String,
    String,
    String,
    i64,
    i64,
);

pub(crate) fn mode_to_db(mode: PoetryTranslationMode) -> &'static str {
    match mode {
        PoetryTranslationMode::Literal => "literal",
        PoetryTranslationMode::Literary => "literary",
    }
}

pub(crate) fn source_to_db(source: PoetryTranslationSource) -> &'static str {
    match source {
        PoetryTranslationSource::Ai => "ai",
        PoetryTranslationSource::User => "user",
    }
}

fn mode_from_db(value: &str) -> AppResult<PoetryTranslationMode> {
    match value {
        "literal" => Ok(PoetryTranslationMode::Literal),
        "literary" => Ok(PoetryTranslationMode::Literary),
        _ => Err(AppError::custom(
            CustomErrorCode::AiTranslationRecordInvalid,
        )),
    }
}

fn source_from_db(value: &str) -> AppResult<PoetryTranslationSource> {
    match value {
        "ai" => Ok(PoetryTranslationSource::Ai),
        "user" => Ok(PoetryTranslationSource::User),
        _ => Err(AppError::custom(
            CustomErrorCode::AiTranslationRecordInvalid,
        )),
    }
}

fn translation_from_row(row: TranslationRow) -> AppResult<PoetryTranslation> {
    Ok(PoetryTranslation {
        id: row.0,
        poem_uid: row.1,
        body_fingerprint: row.2,
        language: row.3,
        mode: mode_from_db(&row.4)?,
        prompt_version: u32::try_from(row.5)
            .map_err(|_| AppError::custom(CustomErrorCode::AiTranslationRecordInvalid))?,
        content: row.6,
        source: source_from_db(&row.7)?,
        model: row.8,
        created_at: row.9,
        updated_at: row.10,
    })
}

fn read_translation_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TranslationRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
    ))
}

pub(crate) fn validate_translation(translation: &PoetryTranslation) -> AppResult<()> {
    if translation.id.is_empty()
        || translation.poem_uid.is_empty()
        || translation.poem_uid.len() > 256
        || translation.body_fingerprint.len() != 64
        || !translation
            .body_fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || translation.language.is_empty()
        || translation.language.len() > 32
        || translation.prompt_version == 0
        || translation.model.is_empty()
        || translation.model.len() > 256
    {
        return Err(AppError::custom(
            CustomErrorCode::AiTranslationRecordInvalid,
        ));
    }
    normalize_content(&translation.content).map(|_| ())
}

fn normalize_content(content: &str) -> AppResult<String> {
    let content = content.trim();
    if content.is_empty() {
        return Err(AppError::custom(CustomErrorCode::AiTranslationContentEmpty));
    }
    if content.len() > TRANSLATION_CONTENT_LIMIT {
        return Err(AppError::custom(
            CustomErrorCode::AiTranslationContentTooLong,
        ));
    }
    Ok(content.to_string())
}

pub(crate) fn list(
    storage: &Storage,
    poem_uid: &str,
    body_fingerprint: &str,
    language: &str,
    prompt_version: u32,
) -> AppResult<Vec<PoetryTranslation>> {
    let conn = storage.conn()?;
    let mut stmt = conn.prepare(
        r#"
        SELECT id, poem_uid, body_fingerprint, language, mode, prompt_version,
               content, source, model, created_at, updated_at
        FROM ai_poetry_translations
        WHERE poem_uid = ?1 AND body_fingerprint = ?2
          AND language = ?3 AND prompt_version = ?4
        ORDER BY mode
        "#,
    )?;
    let rows = stmt
        .query_map(
            params![poem_uid, body_fingerprint, language, prompt_version],
            read_translation_row,
        )?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter().map(translation_from_row).collect()
}

pub(crate) fn all(storage: &Storage) -> AppResult<Vec<PoetryTranslation>> {
    let conn = storage.conn()?;
    let mut stmt = conn.prepare(
        r#"
        SELECT id, poem_uid, body_fingerprint, language, mode, prompt_version,
               content, source, model, created_at, updated_at
        FROM ai_poetry_translations
        ORDER BY updated_at DESC
        "#,
    )?;
    let rows = stmt
        .query_map([], read_translation_row)?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter().map(translation_from_row).collect()
}

pub(crate) fn upsert(
    storage: &Storage,
    poem_uid: &str,
    body_fingerprint: &str,
    language: &str,
    mode: PoetryTranslationMode,
    prompt_version: u32,
    content: &str,
    model: &str,
) -> AppResult<PoetryTranslation> {
    let content = normalize_content(content)?;
    let timestamp = now_ms();
    let conn = storage.conn()?;
    conn.execute(
        r#"
        INSERT INTO ai_poetry_translations(
            id, poem_uid, body_fingerprint, language, mode, prompt_version,
            content, source, model, created_at, updated_at
        ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ai', ?8, ?9, ?9)
        ON CONFLICT(poem_uid, body_fingerprint, language, mode, prompt_version)
        DO UPDATE SET content = excluded.content, source = 'ai',
                      model = excluded.model, updated_at = excluded.updated_at
        "#,
        params![
            uuid::Uuid::new_v4().to_string(),
            poem_uid,
            body_fingerprint,
            language,
            mode_to_db(mode),
            prompt_version,
            content,
            model,
            timestamp,
        ],
    )?;
    read_one(
        storage,
        poem_uid,
        body_fingerprint,
        language,
        mode,
        prompt_version,
    )?
    .ok_or_else(|| AppError::custom(CustomErrorCode::AiTranslationPersistFailed))
}

pub(crate) fn update(
    storage: &Storage,
    poem_uid: &str,
    body_fingerprint: &str,
    language: &str,
    mode: PoetryTranslationMode,
    prompt_version: u32,
    content: &str,
) -> AppResult<PoetryTranslation> {
    let content = normalize_content(content)?;
    let conn = storage.conn()?;
    let changed = conn.execute(
        r#"
        UPDATE ai_poetry_translations
        SET content = ?6, source = 'user', updated_at = ?7
        WHERE poem_uid = ?1 AND body_fingerprint = ?2
          AND language = ?3 AND mode = ?4 AND prompt_version = ?5
        "#,
        params![
            poem_uid,
            body_fingerprint,
            language,
            mode_to_db(mode),
            prompt_version,
            content,
            now_ms(),
        ],
    )?;
    if changed == 0 {
        return Err(AppError::custom(CustomErrorCode::AiTranslationNotFound));
    }
    read_one(
        storage,
        poem_uid,
        body_fingerprint,
        language,
        mode,
        prompt_version,
    )?
    .ok_or_else(|| AppError::custom(CustomErrorCode::AiTranslationPersistFailed))
}

pub(crate) fn delete(
    storage: &Storage,
    poem_uid: &str,
    body_fingerprint: &str,
    language: &str,
    mode: PoetryTranslationMode,
    prompt_version: u32,
) -> AppResult<bool> {
    let conn = storage.conn()?;
    Ok(conn.execute(
        r#"
        DELETE FROM ai_poetry_translations
        WHERE poem_uid = ?1 AND body_fingerprint = ?2
          AND language = ?3 AND mode = ?4 AND prompt_version = ?5
        "#,
        params![
            poem_uid,
            body_fingerprint,
            language,
            mode_to_db(mode),
            prompt_version,
        ],
    )? > 0)
}

fn read_one(
    storage: &Storage,
    poem_uid: &str,
    body_fingerprint: &str,
    language: &str,
    mode: PoetryTranslationMode,
    prompt_version: u32,
) -> AppResult<Option<PoetryTranslation>> {
    let conn = storage.conn()?;
    let row = conn
        .query_row(
            r#"
            SELECT id, poem_uid, body_fingerprint, language, mode, prompt_version,
                   content, source, model, created_at, updated_at
            FROM ai_poetry_translations
            WHERE poem_uid = ?1 AND body_fingerprint = ?2
              AND language = ?3 AND mode = ?4 AND prompt_version = ?5
            "#,
            params![
                poem_uid,
                body_fingerprint,
                language,
                mode_to_db(mode),
                prompt_version,
            ],
            read_translation_row,
        )
        .optional()?;
    row.map(translation_from_row).transpose()
}

#[cfg(test)]
#[path = "translation_store_tests.rs"]
mod tests;
