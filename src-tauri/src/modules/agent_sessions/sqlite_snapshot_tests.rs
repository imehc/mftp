use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::Connection;

use super::sqlite_snapshot::{self, Snapshot};
use crate::error::{AppError, CustomErrorCode};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("mftp-agent-snapshot-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn database(&self) -> (PathBuf, Connection) {
        let path = self.0.join("source.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE content(value TEXT); INSERT INTO content VALUES ('committed in WAL');").unwrap();
        (path, connection)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn snapshot_reads_committed_wal_without_creating_source_shm() {
    let fixture = Fixture::new();
    let (source, _writer) = fixture.database();
    let shm = fixture.0.join("source.sqlite-shm");
    fs::remove_file(&shm).unwrap();
    let before = sqlite_snapshot::fingerprint(&source).unwrap();
    let snapshot = Snapshot::open(&source, &AtomicBool::new(false)).unwrap();
    let value: String = snapshot
        .connection()
        .query_row("SELECT value FROM content", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        (
            value.as_str(),
            shm.exists(),
            sqlite_snapshot::fingerprint(&source).unwrap() == before
        ),
        ("committed in WAL", false, true)
    );
}

#[test]
fn snapshot_has_private_permissions_and_cleans_after_worker_drop() {
    let fixture = Fixture::new();
    let (source, _writer) = fixture.database();
    let snapshot = Snapshot::open(&source, &AtomicBool::new(false)).unwrap();
    let path = snapshot.directory().to_owned();
    let permissions = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    let files_private = fs::read_dir(&path)
        .unwrap()
        .all(|file| file.unwrap().metadata().unwrap().permissions().mode() & 0o077 == 0);
    drop(snapshot);
    assert_eq!(
        (permissions, files_private, path.exists()),
        (0o700, true, false)
    );
}

#[test]
fn snapshot_bounds_sql_values_and_keeps_sorting_in_memory() {
    let fixture = Fixture::new();
    let (source, _writer) = fixture.database();
    let snapshot = Snapshot::open(&source, &AtomicBool::new(false)).unwrap();
    let connection = snapshot.connection();
    let limit = connection
        .limit(rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH)
        .unwrap();
    let temp_store: i32 = connection
        .query_row("PRAGMA temp_store", [], |row| row.get(0))
        .unwrap();
    let cache_size: i32 = connection
        .query_row("PRAGMA cache_size", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        (limit, temp_store, cache_size),
        (32 * 1024 * 1024, 2, -8192)
    );
}

#[test]
fn sql_value_limit_maps_numeric_sqlite_error_to_structured_limit() {
    let connection = Connection::open_in_memory().unwrap();
    connection
        .set_limit(rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH, 128)
        .unwrap();
    let result = sqlite_snapshot::run(&connection, &AtomicBool::new(false), || {
        connection
            .query_row("SELECT zeroblob(1024)", [], |row| row.get::<_, Vec<u8>>(0))
            .map_err(AppError::from)
    });
    assert_eq!(result.err().unwrap().code, "agent_sessions:limit");
}

#[test]
fn snapshot_detects_checkpoint_between_main_and_wal_copies() {
    let fixture = Fixture::new();
    let (source, writer) = fixture.database();
    let mut private = PathBuf::new();
    let result = Snapshot::open_between_copies(&source, &AtomicBool::new(false), |copied| {
        private = copied.parent().unwrap().to_owned();
        writer.execute_batch(
            "PRAGMA wal_checkpoint(TRUNCATE); INSERT INTO content VALUES ('after checkpoint')",
        )?;
        Ok(())
    });
    assert_eq!(
        (result.err().unwrap().code.as_str(), private.exists()),
        ("agent_sessions:changed", false)
    );
}

#[test]
fn snapshot_cancellation_during_copy_cleans_its_actual_private_directory() {
    let fixture = Fixture::new();
    let (source, _writer) = fixture.database();
    let cancel = AtomicBool::new(false);
    let mut private = PathBuf::new();
    let result = Snapshot::open_between_copies(&source, &cancel, |copied| {
        private = copied.parent().unwrap().to_owned();
        cancel.store(true, Ordering::Release);
        Ok(())
    });
    assert_eq!(
        (result.err().unwrap().code.as_str(), private.exists()),
        ("agent_sessions:cancelled", false)
    );
}

#[test]
fn snapshot_failure_cleans_the_copy_without_modifying_source() {
    let fixture = Fixture::new();
    let (source, _writer) = fixture.database();
    let before = sqlite_snapshot::fingerprint(&source).unwrap();
    let mut private = PathBuf::new();
    let result = Snapshot::open_between_copies(&source, &AtomicBool::new(false), |copied| {
        private = copied.parent().unwrap().to_owned();
        Err(AppError::custom(CustomErrorCode::AgentSessionRead))
    });
    assert_eq!(
        (
            result.err().unwrap().code.as_str(),
            private.exists(),
            sqlite_snapshot::fingerprint(&source).unwrap() == before
        ),
        ("agent_sessions:read", false, true)
    );
}

#[test]
fn snapshot_rejects_corrupted_wal_checksum() {
    let fixture = Fixture::new();
    let (source, _writer) = fixture.database();
    let wal_path = fixture.0.join("source.sqlite-wal");
    let mut wal = fs::read(&wal_path).unwrap();
    wal[48] ^= 1;
    fs::write(wal_path, wal).unwrap();
    let result = Snapshot::open(&source, &AtomicBool::new(false));
    assert_eq!(result.err().unwrap().code, "agent_sessions:format");
}

#[test]
fn snapshot_accepts_wal_restart_with_old_generation_tail() {
    let fixture = Fixture::new();
    let (source, writer) = fixture.database();
    for _ in 0..5 {
        writer
            .execute("INSERT INTO content VALUES (?1)", ["more history"])
            .unwrap();
    }
    writer
        .execute_batch(
            "PRAGMA wal_checkpoint(RESTART); INSERT INTO content VALUES ('latest generation')",
        )
        .unwrap();
    let snapshot = Snapshot::open(&source, &AtomicBool::new(false)).unwrap();
    let count: u32 = snapshot
        .connection()
        .query_row("SELECT count(*) FROM content", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 7);
}

#[test]
fn sql_cancellation_interrupts_running_work_before_snapshot_cleanup() {
    let fixture = Fixture::new();
    let (source, _writer) = fixture.database();
    let snapshot = Snapshot::open(&source, &AtomicBool::new(false)).unwrap();
    let cancel = AtomicBool::new(false);
    let result = std::thread::scope(|scope| {
        scope.spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(30));
            cancel.store(true, Ordering::Release);
        });
        sqlite_snapshot::run(snapshot.connection(), &cancel, || {
            snapshot.connection().query_row("WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) FROM n", [], |row| row.get::<_, i64>(0)).map_err(AppError::from)
        })
    });
    assert_eq!(result.err().unwrap().code, "agent_sessions:cancelled");
}
