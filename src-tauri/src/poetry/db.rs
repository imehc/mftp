//! `poetry.sqlite3`: schema, migrations, and the import writer.
//!
//! The library database is fully disposable — deleting the file is always a
//! safe recovery path, which is why user data (favorites) lives in the main
//! database instead (D5).

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use super::adapter::ParsedPoem;
use super::model::{PoetryScript, PoetryTier};
use crate::error::{AppError, AppResult};
use crate::poetry::text;

pub const ANNOTATIONS_COLLECTION_ID: &str = "annotations";
pub const META_BODY_INDEX_ENABLED: &str = "body_fts_enabled";

pub struct PoetryDb {
    path: PathBuf,
}

fn script_to_db(script: PoetryScript) -> &'static str {
    match script {
        PoetryScript::Simplified => "simplified",
        PoetryScript::Traditional => "traditional",
    }
}

impl PoetryDb {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn exists(&self) -> bool {
        self.path.exists()
    }

    /// Database size in bytes; 0 before the first import creates the file.
    pub fn file_size(&self) -> i64 {
        std::fs::metadata(&self.path).map(|m| m.len() as i64).unwrap_or(0)
    }

    pub fn open(&self) -> AppResult<Connection> {
        let conn = Connection::open(&self.path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA_SQL)?;
        Ok(conn)
    }

    pub fn open_writer(&self) -> AppResult<PoetryWriter> {
        let conn = self.open()?;
        // One transaction per imported collection keeps partial imports from
        // ever being visible while bounding peak memory.
        conn.execute_batch("BEGIN IMMEDIATE")?;
        Ok(PoetryWriter { conn })
    }

    // ---- meta ----

    pub fn meta_get(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.open()?;
        Ok(conn
            .query_row(
                "SELECT value FROM meta WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn meta_set(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.open()?;
        conn.execute(
            "INSERT INTO meta(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Remove every poem/author row plus the collection record itself, then
    /// VACUUM to actually return disk space (not a hot path).
    pub fn delete_collection(&self, collection_id: &str) -> AppResult<bool> {
        let mut conn = self.open()?;
        let tx = conn.transaction()?;
        let existed: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM collections WHERE id = ?1)",
                params![collection_id],
                |row| row.get(0),
            )?;
        if !existed {
            return Ok(false);
        }
        tx.execute(
            "DELETE FROM poems_fts WHERE rowid IN
             (SELECT rowid FROM poems WHERE collection_id = ?1)",
            params![collection_id],
        )?;
        tx.execute(
            "DELETE FROM poems_body_fts WHERE rowid IN
             (SELECT rowid FROM poems WHERE collection_id = ?1)",
            params![collection_id],
        )?;
        tx.execute(
            "DELETE FROM poems WHERE collection_id = ?1",
            params![collection_id],
        )?;
        tx.execute(
            "DELETE FROM authors WHERE collection_id = ?1",
            params![collection_id],
        )?;
        tx.execute(
            "DELETE FROM collections WHERE id = ?1",
            params![collection_id],
        )?;
        tx.commit()?;
        // VACUUM is legal under WAL; reclaim disk after bulk deletes.
        conn.execute_batch("VACUUM")?;
        Ok(true)
    }

    /// Rebuild or drop the bigram body index. Reports incremental progress
    /// through `on_progress` (done, total).
    pub fn rebuild_body_index(
        &self,
        enable: bool,
        mut on_progress: impl FnMut(i64, i64),
    ) -> AppResult<()> {
        let conn = self.open()?;
        if !enable {
            conn.execute("DELETE FROM poems_body_fts", [])?;
            self.meta_set(META_BODY_INDEX_ENABLED, "0")?;
            return Ok(());
        }
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM poems", [], |r| r.get(0))?;
        on_progress(0, total);
        // Stream row-by-row on one connection: the read cursor scans `poems`
        // while inserts only touch the FTS table, which SQLite allows.
        let mut select = conn.prepare("SELECT rowid, body FROM poems ORDER BY rowid")?;
        let mut rows = select.query([])?;
        let mut insert =
            conn.prepare("INSERT INTO poems_body_fts(rowid, tokens) VALUES(?1, ?2)")?;
        let mut done: i64 = 0;
        while let Some(row) = rows.next()? {
            let rowid: i64 = row.get(0)?;
            let body: String = row.get(1)?;
            let paragraphs: Vec<String> = serde_json::from_str(&body).unwrap_or_default();
            let tokens = text::bigram_tokens(&paragraphs.join("\n"));
            if !tokens.is_empty() {
                insert.execute(params![rowid, tokens])?;
            }
            done += 1;
            if done % 5000 == 0 {
                on_progress(done, total);
            }
        }
        drop(rows);
        drop(select);
        drop(insert);
        self.meta_set(META_BODY_INDEX_ENABLED, "1")?;
        on_progress(total, total);
        Ok(())
    }
}

/// Open transaction over the library database for one collection import.
pub struct PoetryWriter {
    conn: Connection,
}

impl PoetryWriter {
    pub fn upsert_collection(
        &self,
        id: &str,
        name: &str,
        dynasty: &str,
        script: PoetryScript,
        tier: PoetryTier,
        source_sha: &str,
    ) -> AppResult<()> {
        self.conn.execute(
            r#"
            INSERT INTO collections(id, name, dynasty, script, tier, installed_at, source_sha)
            VALUES(?1, ?2, ?3, ?4, ?5, strftime('%s','now') * 1000, ?6)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                dynasty = excluded.dynasty,
                script = excluded.script,
                tier = excluded.tier,
                source_sha = excluded.source_sha
            "#,
            params![id, name, dynasty, script_to_db(script), tier_to_db(tier), source_sha],
        )?;
        Ok(())
    }

    /// Insert one parsed poem plus its search-index rows. The body index is
    /// filled immediately when enabled so no second pass is needed.
    pub fn insert_poem(
        &self,
        collection_id: &str,
        dynasty: &str,
        poem: &ParsedPoem,
        with_body_index: bool,
    ) -> AppResult<()> {
        let (title_norm, author_norm, body_norm) = super::adapter::normalized_parts(poem);
        let uid = text::poem_uid(collection_id, &title_norm, &author_norm, &body_norm);
        let body_json = serde_json::to_string(&poem.paragraphs)
            .map_err(|e| AppError(format!("serialize body failed: {e}")))?;
        let notes_json = serde_json::to_string(&poem.notes)
            .map_err(|e| AppError(format!("serialize notes failed: {e}")))?;
        let strains_json = serde_json::to_string(&poem.strains)
            .map_err(|e| AppError(format!("serialize strains failed: {e}")))?;
        self.conn.execute(
            r#"
            INSERT INTO poems(
                uid, collection_id, title, author, dynasty, rhythmic, chapter,
                body, notes, strains
            )
            VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(uid) DO NOTHING
            "#,
            params![
                uid,
                collection_id,
                poem.title.trim(),
                poem.author.trim(),
                dynasty,
                poem.rhythmic.trim(),
                poem.chapter.trim(),
                body_json,
                notes_json,
                strains_json,
            ],
        )?;
        let inserted = self.conn.changes();
        if inserted == 0 {
            return Ok(());
        }
        let rowid = self.conn.last_insert_rowid();
        let title_tokens = text::char_tokens(&poem.title);
        let author_tokens = text::char_tokens(&poem.author);
        self.conn.execute(
            "INSERT INTO poems_fts(rowid, title, author, uid) VALUES(?1, ?2, ?3, ?4)",
            params![rowid, title_tokens, author_tokens, uid],
        )?;
        if with_body_index && !body_norm.is_empty() {
            let tokens = text::bigram_tokens(&poem.paragraphs.join("\n"));
            self.conn.execute(
                "INSERT INTO poems_body_fts(rowid, tokens) VALUES(?1, ?2)",
                params![rowid, tokens],
            )?;
        }
        Ok(())
    }

    pub fn replace_author_bios(
        &self,
        collection_id: &str,
        bios: &[(String, String, String)],
    ) -> AppResult<()> {
        self.conn.execute(
            "DELETE FROM authors WHERE collection_id = ?1",
            params![collection_id],
        )?;
        for (name, dynasty, desc) in bios {
            self.conn.execute(
                "INSERT OR IGNORE INTO authors(collection_id, name, dynasty, desc)
                 VALUES(?1, ?2, ?3, ?4)",
                params![collection_id, name, dynasty, desc],
            )?;
        }
        Ok(())
    }

    /// Refresh poem_count on the collection row; call once before commit.
    pub fn finalize_counts(&self, collection_id: &str) -> AppResult<()> {
        self.conn.execute(
            r#"
            UPDATE collections
            SET poem_count = (SELECT COUNT(*) FROM poems WHERE collection_id = ?1)
            WHERE id = ?1
            "#,
            params![collection_id],
        )?;
        Ok(())
    }

    pub fn commit(self) -> AppResult<()> {
        self.conn.execute_batch("COMMIT")?;
        Ok(())
    }
}

pub(crate) fn tier_to_db(tier: PoetryTier) -> &'static str {
    match tier {
        PoetryTier::Recommended => "recommended",
        PoetryTier::Default => "default",
        PoetryTier::OptIn => "optIn",
    }
}

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dynasty TEXT NOT NULL DEFAULT '',
    script TEXT NOT NULL DEFAULT 'simplified',
    tier TEXT NOT NULL DEFAULT 'default',
    installed_at INTEGER NOT NULL DEFAULT 0,
    source_sha TEXT NOT NULL DEFAULT '',
    poem_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS poems (
    uid TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    dynasty TEXT NOT NULL DEFAULT '',
    rhythmic TEXT NOT NULL DEFAULT '',
    chapter TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '[]',
    strains TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_poems_collection ON poems(collection_id);
CREATE INDEX IF NOT EXISTS idx_poems_author ON poems(author) WHERE author != '';

CREATE TABLE IF NOT EXISTS authors (
    collection_id TEXT NOT NULL,
    name TEXT NOT NULL,
    dynasty TEXT NOT NULL DEFAULT '',
    desc TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (collection_id, name)
);

-- External annotation pack keyed by normalized (title, author); entries that
-- match no local poem are kept for future matching improvements (D7).
CREATE TABLE IF NOT EXISTS annotations (
    match_key TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    writer TEXT NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT '',
    translation TEXT NOT NULL DEFAULT '',
    appreciation TEXT NOT NULL DEFAULT '',
    audio_url TEXT NOT NULL DEFAULT ''
);

-- Title/author search: unigram streams over normalized text. Rowids mirror
-- poems.rowid so collection deletes stay O(rows-in-collection).
CREATE VIRTUAL TABLE IF NOT EXISTS poems_fts USING fts5(
    title, author, uid UNINDEXED,
    detail=full, content='', contentless_delete=1
);

-- Optional bigram body index (D6 upgrade switch).
CREATE VIRTUAL TABLE IF NOT EXISTS poems_body_fts USING fts5(
    tokens,
    detail=full, content='', contentless_delete=1
);
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db(tag: &str) -> (tempdir::TempDir, PoetryDb) {
        let dir = tempdir::new(tag);
        let db = PoetryDb::new(dir.path().join("poetry.sqlite3"));
        (dir, db)
    }

    mod tempdir {
        use std::fs;
        use std::path::{Path, PathBuf};
        use std::process;

        pub struct TempDir(PathBuf);

        impl TempDir {
            pub fn path(&self) -> &Path {
                &self.0
            }
        }

        impl Drop for TempDir {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }

        pub fn new(tag: &str) -> TempDir {
            let dir = std::env::temp_dir().join(format!(
                "mftp-poetry-test-{tag}-{}",
                process::id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("create temp dir");
            TempDir(dir)
        }
    }

    use crate::poetry::model::{PoetryScript, PoetryTier};

    fn sample_poem(title: &str, paragraphs: &[&str]) -> ParsedPoem {
        ParsedPoem {
            title: title.to_string(),
            author: "李白".to_string(),
            rhythmic: String::new(),
            chapter: String::new(),
            paragraphs: paragraphs.iter().map(|s| s.to_string()).collect(),
            notes: vec![],
            strains: vec![],
        }
    }

    #[test]
    fn schema_creates_fts_and_supports_phrase_query() {
        let (_dir, db) = temp_db("schema");
        let conn = db.open().expect("open");
        let version: String = conn
            .query_row("SELECT sqlite_version()", [], |r| r.get(0))
            .unwrap();
        println!("sqlite {version}");
        conn.execute(
            "INSERT INTO poems_fts(rowid, title, author, uid) VALUES(1, '静 夜 思', '李 白', 'u1')",
            [],
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM poems_fts WHERE poems_fts MATCH '\"静 夜\"'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let miss: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM poems_fts WHERE poems_fts MATCH '\"静 月\"'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(miss, 0);
    }

    #[test]
    fn writer_import_is_transactional_and_searchable() {
        let (_dir, db) = temp_db("writer");
        {
            let writer = db.open_writer().expect("writer");
            writer
                .upsert_collection(
                    "shijing", "诗经", "先秦",
                    PoetryScript::Simplified, PoetryTier::Recommended, "sha-test",
                )
                .unwrap();
            writer
                .insert_poem("shijing", "先秦", &sample_poem("關雎", &["关关雎鸠"]), false)
                .unwrap();
            writer.finalize_counts("shijing").unwrap();
            writer.commit().unwrap();
        }
        let conn = db.open().unwrap();
        let count: i64 = conn
            .query_row("SELECT poem_count FROM collections WHERE id='shijing'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let hit: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM poems_fts f JOIN poems p ON p.rowid = f.rowid
                 WHERE poems_fts MATCH '\"关 雎\"'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hit, 1);
        assert!(db.delete_collection("shijing").unwrap());
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM poems", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn delete_missing_collection_returns_false() {
        let (_dir, db) = temp_db("delete-missing");
        assert!(!db.delete_collection("nope").unwrap());
    }
}
