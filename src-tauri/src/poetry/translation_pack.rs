use rusqlite::params;

use super::db::PoetryDb;
use super::model::{
    PoetryPackTranslation, PoetryTranslationMode, PoetryTranslationPack,
    PoetryTranslationPackSummary,
};
use crate::error::{AppError, AppResult};

impl PoetryDb {
    pub fn import_translation_pack(&self, pack: &PoetryTranslationPack) -> AppResult<i64> {
        validate_pack(pack)?;
        let conn = self.open()?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO translation_packs(id,name,author,source,license,installed_at) VALUES(?1,?2,?3,?4,?5,strftime('%s','now')*1000) ON CONFLICT(id) DO UPDATE SET name=excluded.name,author=excluded.author,source=excluded.source,license=excluded.license,installed_at=excluded.installed_at",
            params![pack.id, pack.name, pack.author, pack.source, pack.license],
        )?;
        tx.execute(
            "DELETE FROM translation_pack_entries WHERE pack_id=?1",
            params![pack.id],
        )?;
        for entry in &pack.translations {
            tx.execute(
                "INSERT INTO translation_pack_entries(pack_id,poem_uid,title,author,body_fingerprint,language,mode,content) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                params![pack.id, entry.poem_uid, entry.title, entry.author, entry.body_fingerprint, entry.language, mode_to_db(entry.mode), entry.content],
            )?;
        }
        tx.commit()?;
        Ok(pack.translations.len() as i64)
    }

    pub fn translation_pack_summaries(&self) -> AppResult<Vec<PoetryTranslationPackSummary>> {
        let conn = self.open()?;
        let mut stmt = conn.prepare("SELECT p.id,p.name,p.author,p.source,p.license,COUNT(e.poem_uid) FROM translation_packs p LEFT JOIN translation_pack_entries e ON e.pack_id=p.id GROUP BY p.id ORDER BY p.name")?;
        let rows = stmt
            .query_map([], |row| {
                Ok(PoetryTranslationPackSummary {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    author: row.get(2)?,
                    source: row.get(3)?,
                    license: row.get(4)?,
                    entry_count: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn translation_pack_delete(&self, id: &str) -> AppResult<()> {
        self.open()?
            .execute("DELETE FROM translation_packs WHERE id=?1", params![id])?;
        Ok(())
    }

    pub fn translation_pack_for_poem(
        &self,
        uid: &str,
        fingerprint: &str,
    ) -> AppResult<Vec<PoetryPackTranslation>> {
        let conn = self.open()?;
        let mut stmt = conn.prepare("SELECT p.id,p.name,p.author,p.source,p.license,e.language,e.mode,e.content FROM translation_pack_entries e JOIN translation_packs p ON p.id=e.pack_id WHERE e.poem_uid=?1 AND e.body_fingerprint=?2 ORDER BY p.name,e.language,e.mode")?;
        let rows = stmt
            .query_map(params![uid, fingerprint], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|row| {
                Ok(PoetryPackTranslation {
                    pack_id: row.0,
                    pack_name: row.1,
                    pack_author: row.2,
                    pack_source: row.3,
                    pack_license: row.4,
                    language: row.5,
                    mode: mode_from_db(&row.6)?,
                    content: row.7,
                })
            })
            .collect()
    }
}

fn mode_to_db(mode: PoetryTranslationMode) -> &'static str {
    match mode {
        PoetryTranslationMode::Literal => "literal",
        PoetryTranslationMode::Literary => "literary",
    }
}

fn mode_from_db(value: &str) -> AppResult<PoetryTranslationMode> {
    match value {
        "literal" => Ok(PoetryTranslationMode::Literal),
        "literary" => Ok(PoetryTranslationMode::Literary),
        _ => Err(AppError("invalid translation pack mode".into())),
    }
}

fn validate_pack(pack: &PoetryTranslationPack) -> AppResult<()> {
    if pack.format != "mftp-poetry-translation-pack" || pack.version != 1 {
        return Err(AppError("unsupported translation pack format".into()));
    }
    for value in [
        &pack.id,
        &pack.name,
        &pack.author,
        &pack.source,
        &pack.license,
    ] {
        if value.trim().is_empty() || value.len() > 512 {
            return Err(AppError("translation pack metadata is invalid".into()));
        }
    }
    if pack.translations.len() > 100_000 {
        return Err(AppError("translation pack has too many entries".into()));
    }
    for entry in &pack.translations {
        if entry.poem_uid.is_empty()
            || entry.poem_uid.len() > 256
            || entry.language.is_empty()
            || entry.language.len() > 32
            || entry.content.trim().is_empty()
            || entry.content.len() > 64 * 1024
            || entry.body_fingerprint.len() != 64
            || !entry
                .body_fingerprint
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(AppError("translation pack contains invalid entry".into()));
        }
    }
    Ok(())
}
