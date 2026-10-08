use super::*;
use crate::storage::Storage;
use std::path::PathBuf;

struct Fixture {
    root: PathBuf,
    repo: ModelLibraryRepository,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("model-env-{}", uuid::Uuid::new_v4()));
        Self {
            repo: ModelLibraryRepository::new(Storage::new(root.clone()).unwrap()),
            root,
        }
    }
    fn save(&self, bytes: &[u8]) -> String {
        let id = self
            .repo
            .environment_begin("light.hdr", bytes.len() as u32)
            .unwrap();
        for (index, chunk) in bytes.chunks(CHUNK).enumerate() {
            self.repo
                .environment_write(&id, (index * CHUNK) as u32, chunk)
                .unwrap();
        }
        self.repo.environment_commit(&id).unwrap();
        id
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn hdr() -> Vec<u8> {
    b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n\x80\x80\x80\x80".to_vec()
}

#[test]
fn environment_replacement_is_atomic_and_reads_are_version_bound() {
    let f = Fixture::new();
    let old = f.save(&hdr());
    let mut bytes = hdr();
    bytes.resize(CHUNK + 10, 0);
    let id = f
        .repo
        .environment_begin("new.hdr", bytes.len() as u32)
        .unwrap();
    assert!(f.repo.environment_commit(&id).is_err());
    assert_eq!(f.repo.environment_current().unwrap().unwrap().id, old);
    assert!(f.repo.environment_write(&id, 1, &bytes[..CHUNK]).is_err());
    f.repo.environment_write(&id, 0, &bytes[..CHUNK]).unwrap();
    assert!(f.repo.environment_write(&id, 0, &bytes[..CHUNK]).is_err());
    f.repo
        .environment_write(&id, CHUNK as u32, &bytes[CHUNK..])
        .unwrap();
    let conn = f.repo.storage.conn().unwrap();
    conn.execute_batch("CREATE TRIGGER reject_environment BEFORE UPDATE OF ready ON model_environment BEGIN SELECT RAISE(ABORT, 'test'); END;").unwrap();
    assert!(f.repo.environment_commit(&id).is_err());
    assert_eq!(f.repo.environment_read(&old, 0).unwrap(), hdr());
    conn.execute_batch("DROP TRIGGER reject_environment")
        .unwrap();
    f.repo.environment_commit(&id).unwrap();
    f.repo.environment_abort(&id).unwrap();
    assert!(f.repo.environment_read(&old, 0).is_err());
    assert_eq!(
        f.repo.environment_read(&id, CHUNK as u32).unwrap(),
        bytes[CHUNK..]
    );
}

#[test]
fn environment_rejects_bad_headers_dimensions_and_budgets() {
    let f = Fixture::new();
    for (name, size) in [
        ("../a.hdr", 10),
        ("a.txt", 10),
        ("a.hdr", 0),
        ("a.hdr", 32 * 1024 * 1024 + 1),
    ] {
        assert!(f.repo.environment_begin(name, size).is_err());
    }
    for bytes in [
        b"invalid".to_vec(),
        b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1025 +X 1\n".to_vec(),
    ] {
        let id = f
            .repo
            .environment_begin("bad.hdr", bytes.len() as u32)
            .unwrap();
        assert!(f.repo.environment_write(&id, 0, &bytes).is_err());
        f.repo.environment_abort(&id).unwrap();
    }
    f.repo.environment_begin("one.hdr", 10).unwrap();
    f.repo.environment_begin("two.hdr", 10).unwrap();
    assert!(f.repo.environment_begin("three.hdr", 10).is_err());
    assert!(f.repo.environment_current().unwrap().is_none());
}

#[test]
fn environment_survives_reopen_and_cache_clear_but_reset_removes_it() {
    let f = Fixture::new();
    let id = f.save(&hdr());
    f.repo.environment_begin("draft.hdr", 20).unwrap();
    f.repo.configure_cache(0, true).unwrap();
    assert_eq!(f.repo.catalog().unwrap().library_bytes, hdr().len() as f64);
    let reopened = ModelLibraryRepository::new(Storage::new(f.root.clone()).unwrap());
    assert_eq!(reopened.environment_read(&id, 0).unwrap(), hdr());
    let count: i64 = reopened
        .storage
        .conn()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM model_environment", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
    reopened.storage.reset_database().unwrap();
    assert!(reopened.environment_current().unwrap().is_none());
    assert!(reopened.environment_write("missing", 0, &hdr()).is_err());
}

#[test]
fn environment_migration_from_v2_is_repeatable_and_preserves_attachments_table() {
    let f = Fixture::new();
    let mut conn = f.repo.storage.conn().unwrap();
    conn.execute_batch("DROP TABLE model_environment_chunks; DROP TABLE model_environment; UPDATE app_meta SET value = '2' WHERE key = 'model_viewer_schema_version';").unwrap();
    super::super::schema::init(&mut conn).unwrap();
    super::super::schema::init(&mut conn).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM model_attachments", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn explicit_clear_invalidates_pending_uploads() {
    let f = Fixture::new();
    f.save(&hdr());
    let id = f
        .repo
        .environment_begin("new.hdr", hdr().len() as u32)
        .unwrap();
    f.repo.environment_write(&id, 0, &hdr()).unwrap();
    f.repo.environment_clear().unwrap();
    assert!(f.repo.environment_commit(&id).is_err());
    assert!(f.repo.environment_current().unwrap().is_none());
}
