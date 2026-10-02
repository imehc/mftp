use super::*;
use crate::error::{AppErrorKind, CustomErrorCode};
use crate::storage::Storage;
use rusqlite::Connection;

fn test_root(label: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("mftp-activity-{}-{}", label, uuid::Uuid::new_v4()))
}

fn db_file(root: &std::path::Path) -> std::path::PathBuf {
    root.join("mftp.sqlite3")
}

const OLD_TABLE_DDL: &str = r#"
    CREATE TABLE lan_access_logs (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        ip TEXT NOT NULL,
        request_type TEXT NOT NULL,
        result TEXT NOT NULL,
        detail TEXT,
        source TEXT NOT NULL DEFAULT 'lan'
    );
    CREATE INDEX idx_lan_access_logs_created_at ON lan_access_logs(created_at DESC);
"#;

fn table_names(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap();
    stmt.query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

#[test]
fn old_log_table_is_renamed_once_and_rows_survive() {
    let root = test_root("rename");
    std::fs::create_dir_all(&root).unwrap();
    {
        let conn = Connection::open(db_file(&root)).unwrap();
        conn.execute_batch(OLD_TABLE_DDL).unwrap();
        conn.execute(
            "INSERT INTO lan_access_logs(id,created_at,ip,request_type,result,detail,source) \
             VALUES('row-1',10,'127.0.0.1','browse','success','kept','lan')",
            [],
        )
        .unwrap();
    }

    let storage = Storage::new(root.clone()).unwrap();
    let logs = storage.list_activity_logs(10, None, None).unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].id, "row-1");
    assert_eq!(logs[0].detail.as_deref(), Some("kept"));
    {
        let conn = storage.conn().unwrap();
        let names = table_names(&conn);
        assert!(names.iter().any(|name| name == "activity_logs"));
        assert!(!names.iter().any(|name| name == "lan_access_logs"));
    }
    drop(storage);

    // Reopening after the rename must be a no-op and keep the migrated row.
    let reopened = Storage::new(root.clone()).unwrap();
    assert_eq!(
        reopened.list_activity_logs(10, None, None).unwrap().len(),
        1
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn structured_error_round_trips_through_the_payload_column() {
    let root = test_root("payload");
    let storage = Storage::new(root.clone()).unwrap();
    let error = AppError::custom(CustomErrorCode::LanUploadTargetBusy).with_arg("target", "/tmp/x");
    storage
        .record_result(
            "todo",
            "127.0.0.1",
            "create",
            Some("business metadata"),
            Some(&error),
        )
        .unwrap();
    let logs = storage.list_activity_logs(10, Some("todo"), None).unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].result, "failed");
    assert_eq!(logs[0].detail.as_deref(), Some("business metadata"));
    assert_eq!(logs[0].error.as_ref(), Some(&error));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn pre_column_failed_rows_wrap_detail_as_legacy_raw() {
    let root = test_root("legacy-wrap");
    std::fs::create_dir_all(&root).unwrap();
    {
        let conn = Connection::open(db_file(&root)).unwrap();
        conn.execute_batch(OLD_TABLE_DDL).unwrap();
        conn.execute(
            "INSERT INTO lan_access_logs(id,created_at,ip,request_type,result,detail,source) \
             VALUES('old-fail',10,'127.0.0.1','browse','failed','E4-era plain text','lan')",
            [],
        )
        .unwrap();
    }

    // The column-add watermark marks this row as pre-protocol: the read side
    // wraps its plain detail text as external/legacy:raw without rewriting.
    let storage = Storage::new(root.clone()).unwrap();
    let logs = storage.list_activity_logs(10, None, None).unwrap();
    assert_eq!(logs.len(), 1);
    let error = logs[0].error.as_ref().unwrap();
    assert_eq!(error.kind, AppErrorKind::External);
    assert_eq!(error.code, "legacy:raw");
    assert_eq!(error.message, "E4-era plain text");
    assert_eq!(logs[0].detail.as_deref(), Some("E4-era plain text"));
    drop(storage);

    let reopened = Storage::new(root.clone()).unwrap();
    let again = reopened.list_activity_logs(10, None, None).unwrap();
    assert_eq!(again.len(), 1);
    assert_eq!(again[0].error.as_ref().unwrap().code, "legacy:raw");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn post_watermark_failed_rows_without_payload_produce_no_error() {
    let root = test_root("static-failed");
    let storage = Storage::new(root.clone()).unwrap();
    {
        let conn = storage.conn().unwrap();
        // Static outcomes (e.g. LAN "not found") are failed rows without an
        // error; after the watermark they must not be wrapped as legacy text.
        conn.execute(
            "INSERT INTO activity_logs(id,created_at,source,ip,request_type,result,detail,error_payload) \
             VALUES('static-1',99999999999,'lan','127.0.0.1','download','failed','not found',NULL)",
            [],
        )
        .unwrap();
    }
    let logs = storage
        .list_activity_logs(10, None, Some("failed"))
        .unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].detail.as_deref(), Some("not found"));
    assert_eq!(logs[0].error, None);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn coexisting_tables_are_left_untouched() {
    let root = test_root("coexist");
    std::fs::create_dir_all(&root).unwrap();
    {
        let conn = Connection::open(db_file(&root)).unwrap();
        conn.execute_batch(OLD_TABLE_DDL).unwrap();
        conn.execute(
            "INSERT INTO lan_access_logs(id,created_at,ip,request_type,result,detail,source) \
             VALUES('old-only',10,'127.0.0.1','browse','success',NULL,'lan')",
            [],
        )
        .unwrap();
        conn.execute_batch(
            "CREATE TABLE activity_logs (
                id TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                ip TEXT NOT NULL,
                request_type TEXT NOT NULL,
                result TEXT NOT NULL,
                detail TEXT,
                source TEXT NOT NULL DEFAULT 'lan'
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO activity_logs(id,created_at,ip,request_type,result,detail,source) \
             VALUES('new-only',20,'127.0.0.1','browse','success',NULL,'lan')",
            [],
        )
        .unwrap();
    }

    // A downgrade may have written to a recreated old table; startup must not
    // fail or merge, and the app keeps operating on activity_logs.
    let storage = Storage::new(root.clone()).unwrap();
    let logs = storage.list_activity_logs(10, None, None).unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].id, "new-only");
    {
        let conn = storage.conn().unwrap();
        let names = table_names(&conn);
        assert!(names.iter().any(|name| name == "activity_logs"));
        assert!(names.iter().any(|name| name == "lan_access_logs"));
        let old_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM lan_access_logs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(old_rows, 1);
    }
    std::fs::remove_dir_all(root).unwrap();
}
