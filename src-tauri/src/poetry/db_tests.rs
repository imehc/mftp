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
        let dir = std::env::temp_dir().join(format!("mftp-poetry-test-{tag}-{}", process::id()));
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
                "shijing",
                "诗经",
                "先秦",
                PoetryScript::Simplified,
                PoetryTier::Recommended,
                "sha-test",
            )
            .unwrap();
        writer
            .insert_poem(
                "shijing",
                "先秦",
                &sample_poem("關雎", &["关关雎鸠"]),
                false,
            )
            .unwrap();
        writer.finalize_counts("shijing").unwrap();
        writer.commit().unwrap();
    }
    let conn = db.open().unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT poem_count FROM collections WHERE id='shijing'",
            [],
            |r| r.get(0),
        )
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
