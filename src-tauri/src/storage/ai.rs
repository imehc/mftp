use rusqlite::{params, Connection, OptionalExtension};

use crate::ai::AiConnectionConfig;
use crate::error::{AppError, AppResult};
use crate::poetry::model::{PoetryTranslation, PoetryTranslationMode, PoetryTranslationSource};

use super::{now_ms, Storage};

const AI_SCHEMA_VERSION: i64 = 2;
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

pub(super) fn init_schema(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ai_connection (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            base_url TEXT NOT NULL,
            model TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        "#,
    )?;
    let version: i64 = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'ai_schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    if version > AI_SCHEMA_VERSION {
        return Err(AppError("AI database schema is newer than this app".into()));
    }
    if version < 1 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS ai_poetry_translations (
                id TEXT PRIMARY KEY,
                poem_uid TEXT NOT NULL,
                body_fingerprint TEXT NOT NULL,
                language TEXT NOT NULL,
                mode TEXT NOT NULL,
                prompt_version INTEGER NOT NULL,
                content TEXT NOT NULL,
                source TEXT NOT NULL,
                model TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(poem_uid, body_fingerprint, language, mode, prompt_version)
            );

            CREATE INDEX IF NOT EXISTS idx_ai_poetry_translations_poem
            ON ai_poetry_translations(poem_uid, body_fingerprint, language, prompt_version);
            "#,
        )?;
    }
    if version < 2 {
        conn.execute_batch(
            "ALTER TABLE ai_connection
             ADD COLUMN streaming_enabled INTEGER NOT NULL DEFAULT 1;",
        )?;
    }
    if version < AI_SCHEMA_VERSION {
        conn.execute(
            "INSERT INTO app_meta(key, value) VALUES('ai_schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![AI_SCHEMA_VERSION.to_string()],
        )?;
    }
    Ok(())
}

pub(super) fn translation_mode_to_db(mode: PoetryTranslationMode) -> &'static str {
    match mode {
        PoetryTranslationMode::Literal => "literal",
        PoetryTranslationMode::Literary => "literary",
    }
}

pub(super) fn translation_source_to_db(source: PoetryTranslationSource) -> &'static str {
    match source {
        PoetryTranslationSource::Ai => "ai",
        PoetryTranslationSource::User => "user",
    }
}

fn translation_mode_from_db(value: &str) -> AppResult<PoetryTranslationMode> {
    match value {
        "literal" => Ok(PoetryTranslationMode::Literal),
        "literary" => Ok(PoetryTranslationMode::Literary),
        _ => Err(AppError("Stored AI translation has an invalid mode".into())),
    }
}

fn translation_source_from_db(value: &str) -> AppResult<PoetryTranslationSource> {
    match value {
        "ai" => Ok(PoetryTranslationSource::Ai),
        "user" => Ok(PoetryTranslationSource::User),
        _ => Err(AppError(
            "Stored AI translation has an invalid source".into(),
        )),
    }
}

fn translation_from_row(row: TranslationRow) -> AppResult<PoetryTranslation> {
    Ok(PoetryTranslation {
        id: row.0,
        poem_uid: row.1,
        body_fingerprint: row.2,
        language: row.3,
        mode: translation_mode_from_db(&row.4)?,
        prompt_version: u32::try_from(row.5)
            .map_err(|_| AppError("Stored AI translation has an invalid version".into()))?,
        content: row.6,
        source: translation_source_from_db(&row.7)?,
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

pub(super) fn validate_translation(translation: &PoetryTranslation) -> AppResult<()> {
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
        return Err(AppError("Invalid AI translation metadata".into()));
    }
    normalize_translation_content(&translation.content).map(|_| ())
}

fn normalize_translation_content(content: &str) -> AppResult<String> {
    let content = content.trim();
    if content.is_empty() {
        return Err(AppError("Translation content is required".into()));
    }
    if content.len() > TRANSLATION_CONTENT_LIMIT {
        return Err(AppError("Translation content is too long".into()));
    }
    Ok(content.to_string())
}

impl Storage {
    pub fn ai_connection(&self) -> AppResult<Option<AiConnectionConfig>> {
        let conn = self.conn()?;
        conn.query_row(
            "SELECT base_url, model, streaming_enabled FROM ai_connection WHERE id = 1",
            [],
            |row| {
                Ok(AiConnectionConfig {
                    base_url: row.get(0)?,
                    model: row.get(1)?,
                    streaming_enabled: row.get::<_, i64>(2)? != 0,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn save_ai_connection(&self, config: &AiConnectionConfig) -> AppResult<()> {
        let conn = self.conn()?;
        conn.execute(
            r#"
            INSERT INTO ai_connection(id, base_url, model, streaming_enabled, updated_at)
            VALUES(1, ?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET
                base_url = excluded.base_url,
                model = excluded.model,
                streaming_enabled = excluded.streaming_enabled,
                updated_at = excluded.updated_at
            "#,
            params![
                config.base_url,
                config.model,
                i64::from(config.streaming_enabled),
                now_ms()
            ],
        )?;
        Ok(())
    }

    pub fn list_poetry_translations(
        &self,
        poem_uid: &str,
        body_fingerprint: &str,
        language: &str,
        prompt_version: u32,
    ) -> AppResult<Vec<PoetryTranslation>> {
        let conn = self.conn()?;
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

    pub fn all_poetry_translations(&self) -> AppResult<Vec<PoetryTranslation>> {
        let conn = self.conn()?;
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

    pub fn upsert_ai_poetry_translation(
        &self,
        poem_uid: &str,
        body_fingerprint: &str,
        language: &str,
        mode: PoetryTranslationMode,
        prompt_version: u32,
        content: &str,
        model: &str,
    ) -> AppResult<PoetryTranslation> {
        let content = normalize_translation_content(content)?;
        let timestamp = now_ms();
        let conn = self.conn()?;
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
                translation_mode_to_db(mode),
                prompt_version,
                content,
                model,
                timestamp,
            ],
        )?;
        self.poetry_translation(poem_uid, body_fingerprint, language, mode, prompt_version)?
            .ok_or_else(|| AppError("Failed to load the saved AI translation".into()))
    }

    pub fn update_poetry_translation(
        &self,
        poem_uid: &str,
        body_fingerprint: &str,
        language: &str,
        mode: PoetryTranslationMode,
        prompt_version: u32,
        content: &str,
    ) -> AppResult<PoetryTranslation> {
        let content = normalize_translation_content(content)?;
        let conn = self.conn()?;
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
                translation_mode_to_db(mode),
                prompt_version,
                content,
                now_ms(),
            ],
        )?;
        if changed == 0 {
            return Err(AppError("AI translation not found".into()));
        }
        self.poetry_translation(poem_uid, body_fingerprint, language, mode, prompt_version)?
            .ok_or_else(|| AppError("Failed to load the updated AI translation".into()))
    }

    pub fn delete_poetry_translation(
        &self,
        poem_uid: &str,
        body_fingerprint: &str,
        language: &str,
        mode: PoetryTranslationMode,
        prompt_version: u32,
    ) -> AppResult<bool> {
        let conn = self.conn()?;
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
                translation_mode_to_db(mode),
                prompt_version,
            ],
        )? > 0)
    }

    fn poetry_translation(
        &self,
        poem_uid: &str,
        body_fingerprint: &str,
        language: &str,
        mode: PoetryTranslationMode,
        prompt_version: u32,
    ) -> AppResult<Option<PoetryTranslation>> {
        let conn = self.conn()?;
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
                    translation_mode_to_db(mode),
                    prompt_version,
                ],
                read_translation_row,
            )
            .optional()?;
        row.map(translation_from_row).transpose()
    }
}

#[cfg(test)]
#[path = "ai_tests.rs"]
mod tests;
