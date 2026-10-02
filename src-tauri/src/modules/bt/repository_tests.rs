use super::*;
use std::path::PathBuf;

fn temp_root(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("mftp-bt-db-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn sample_row(hash: &str) -> BtTaskRow {
    BtTaskRow {
        info_hash: hash.into(),
        label: "archive".into(),
        dest_dir: "/downloads".into(),
        mode: "download".into(),
        pinned: true,
        created_at: 123,
        work_dir: "/app/bt/staging/hash".into(),
        file_indices: vec![1, 3],
        package_mode: "archive".into(),
        status: "packaging".into(),
        output_path: Some("/downloads/archive.tar.gz".into()),
        export_path: Some("/Users/test/archive.tar.gz".into()),
        total_bytes: Some(456),
        error: Some(AppError::external("io:timed_out", "retryable")),
    }
}

fn read_meta(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM app_meta WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .ok()
}

fn write_meta(conn: &rusqlite::Connection, key: &str, value: &str) {
    conn.execute(
        "INSERT INTO app_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .unwrap();
}

#[test]
fn upsert_round_trips_archive_state() {
    let root = temp_root("upsert");
    let storage = BtRepository::new(Storage::new(root.clone()).unwrap());
    let row = sample_row(&"a".repeat(40));
    storage.upsert_bt_task(&row).unwrap();
    let loaded = storage.get_bt_task(&row.info_hash).unwrap().unwrap();
    assert_eq!(loaded.file_indices, vec![1, 3]);
    assert_eq!(loaded.package_mode, "archive");
    assert_eq!(loaded.status, "packaging");
    assert_eq!(loaded.output_path, row.output_path);
    assert_eq!(loaded.export_path, row.export_path);
    assert_eq!(loaded.total_bytes, Some(456));
    assert_eq!(
        loaded.error.as_ref().map(|error| error.message.as_str()),
        Some("retryable")
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn old_schema_migrates_to_direct_active_task() {
    let root = temp_root("migration");
    let db = root.join("mftp.sqlite3");
    let conn = Connection::open(&db).unwrap();
    conn.execute_batch(
        "CREATE TABLE bt_tasks (
                info_hash TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                dest_dir TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'download',
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
             );
             INSERT INTO bt_tasks VALUES (
                'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                'legacy', '/downloads', 'download', 0, 1
             );",
    )
    .unwrap();
    drop(conn);

    let storage = BtRepository::new(Storage::new(root.clone()).unwrap());
    let row = storage
        .get_bt_task("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        .unwrap()
        .unwrap();
    assert_eq!(row.work_dir, "/downloads");
    assert!(row.file_indices.is_empty());
    assert_eq!(row.package_mode, "direct");
    assert_eq!(row.status, "active");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn completing_only_touches_plain_downloads() {
    let root = temp_root("complete");
    let storage = BtRepository::new(Storage::new(root.clone()).unwrap());

    let direct = "d".repeat(40);
    let mut row = sample_row(&direct);
    row.package_mode = "direct".into();
    row.status = "active".into();
    row.total_bytes = None;
    row.error = Some(AppError::external("io:timed_out", "transient"));
    storage.upsert_bt_task(&row).unwrap();

    let preview = "e".repeat(40);
    let mut cached = sample_row(&preview);
    cached.mode = "preview".into();
    cached.package_mode = "direct".into();
    cached.status = "active".into();
    storage.upsert_bt_task(&cached).unwrap();

    let archive = "f".repeat(40);
    let mut packing = sample_row(&archive);
    packing.status = "active".into();
    storage.upsert_bt_task(&packing).unwrap();

    assert_eq!(
        storage
            .list_bt_direct_downloads()
            .unwrap()
            .into_iter()
            .map(|row| row.info_hash)
            .collect::<Vec<_>>(),
        vec![direct.clone()]
    );

    for hash in [&direct, &preview, &archive] {
        storage
            .mark_bt_task_completed(hash, Some(999), Some("/downloads/movie.mp4"))
            .unwrap();
    }

    let done = storage.get_bt_task(&direct).unwrap().unwrap();
    assert_eq!(done.status, "completed");
    assert_eq!(done.total_bytes, Some(999));
    assert_eq!(done.output_path.as_deref(), Some("/downloads/movie.mp4"));
    assert_eq!(done.error, None);
    assert_eq!(
        storage.get_bt_task(&preview).unwrap().unwrap().status,
        "active"
    );
    assert_eq!(
        storage.get_bt_task(&archive).unwrap().unwrap().status,
        "active"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn cancelling_task_keeps_history_and_clears_runtime_state() {
    let root = temp_root("cancel-history");
    let storage = BtRepository::new(Storage::new(root.clone()).unwrap());
    let hash = "c".repeat(40);
    let mut row = sample_row(&hash);
    row.pinned = true;
    storage.upsert_bt_task(&row).unwrap();
    storage
        .storage
        .conn()
        .unwrap()
        .execute(
            "INSERT INTO bt_cache_access(info_hash,last_access) VALUES(?1,1)",
            params![hash],
        )
        .unwrap();

    storage.mark_bt_task_cancelled(&hash).unwrap();

    let history = storage.get_bt_task(&hash).unwrap().unwrap();
    assert_eq!(history.status, "cancelled");
    assert_eq!(history.output_path, None);
    assert_eq!(history.export_path, None);
    assert_eq!(history.error, None);
    assert!(!history.pinned);
    assert_eq!(
        storage
            .storage
            .conn()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM bt_cache_access WHERE info_hash=?1",
                params![hash],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn error_schema_migration_is_idempotent_and_keeps_old_diagnostics() {
    let root = temp_root("error-migration");
    let storage = BtRepository::new(Storage::new(root.clone()).unwrap());
    let row = sample_row(&"a".repeat(40));
    storage.upsert_bt_task(&row).unwrap();
    let conn = storage.storage.conn().unwrap();
    // Recreate the exact pre-envelope shape while retaining the historical row.
    conn.execute("ALTER TABLE bt_tasks DROP COLUMN error_payload", [])
        .unwrap();
    conn.execute(
        "DELETE FROM app_meta WHERE key = 'bt_error_payload_schema_version'",
        [],
    )
    .unwrap();
    drop(conn);
    for _ in 0..2 {
        let reopened = BtRepository::new(Storage::new(root.clone()).unwrap());
        let loaded = reopened.get_bt_task(&row.info_hash).unwrap().unwrap();
        let error = loaded.error.unwrap();
        assert_eq!(error.code, "legacy:raw");
        assert_eq!(error.message, "retryable");
        let raw: (Option<String>, Option<String>) = reopened
            .storage
            .conn()
            .unwrap()
            .query_row(
                "SELECT last_error, error_payload FROM bt_tasks",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(raw, (Some("retryable".into()), None));
        assert_eq!(
            read_meta(
                &reopened.storage.conn().unwrap(),
                "bt_error_payload_schema_version"
            )
            .as_deref(),
            Some("1")
        );
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn stored_errors_round_trip_and_unknown_versions_remain_untouched() {
    use crate::error::CustomErrorCode;
    let root = temp_root("error-roundtrip");
    let storage = BtRepository::new(Storage::new(root.clone()).unwrap());
    let mut row = sample_row(&"a".repeat(40));
    for error in [
        AppError::custom(CustomErrorCode::BtArchiveAlreadyExists)
            .with_arg("path", "目录/archive.tar"),
        AppError::from(std::io::Error::from_raw_os_error(13)),
    ] {
        row.error = Some(error.clone());
        storage.upsert_bt_task(&row).unwrap();
        assert_eq!(
            storage.get_bt_task(&row.info_hash).unwrap().unwrap().error,
            Some(error.clone())
        );
        storage
            .update_bt_task_state(&row.info_hash, "error", None, Some(&error))
            .unwrap();
        assert_eq!(storage.list_bt_tasks().unwrap()[0].error, Some(error));
    }
    for payload in [
        r#"{"version":99,"error":{"future":true}}"#,
        "corrupt payload",
    ] {
        storage
            .storage
            .conn()
            .unwrap()
            .execute(
                "UPDATE bt_tasks SET error_payload = ?1, last_error = ?2",
                params![payload, "original historical text"],
            )
            .unwrap();
        let reopened = BtRepository::new(Storage::new(root.clone()).unwrap());
        let error = reopened.list_bt_tasks().unwrap().remove(0).error.unwrap();
        assert_eq!(error.code, "legacy:raw");
        assert_eq!(error.message, "original historical text");
        let unchanged: String = reopened
            .storage
            .conn()
            .unwrap()
            .query_row("SELECT error_payload FROM bt_tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(unchanged, payload);
    }
    write_meta(
        &storage.storage.conn().unwrap(),
        "bt_error_payload_schema_version",
        "99",
    );
    let reopened = BtRepository::new(Storage::new(root.clone()).unwrap());
    assert_eq!(
        read_meta(
            &reopened.storage.conn().unwrap(),
            "bt_error_payload_schema_version"
        )
        .as_deref(),
        Some("99")
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn successful_cancelled_and_retried_tasks_clear_both_error_columns() {
    let root = temp_root("error-clear");
    let storage = BtRepository::new(Storage::new(root.clone()).unwrap());
    let mut row = sample_row(&"a".repeat(40));
    row.status = "active".into();
    row.package_mode = "direct".into();
    for transition in 0..4 {
        storage.upsert_bt_task(&row).unwrap();
        match transition {
            0 => storage
                .mark_bt_task_completed(&row.info_hash, None, None)
                .unwrap(),
            1 => storage.mark_bt_task_cancelled(&row.info_hash).unwrap(),
            2 => storage
                .update_bt_task_state(&row.info_hash, "completed", None, None)
                .unwrap(),
            _ => {
                let mut retry = row.clone();
                retry.error = None;
                storage.upsert_bt_task(&retry).unwrap();
            }
        }
        let raw: (Option<String>, Option<String>) = storage
            .storage
            .conn()
            .unwrap()
            .query_row(
                "SELECT last_error, error_payload FROM bt_tasks",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(raw, (None, None));
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn download_only_migration_is_idempotent_and_preserves_downloads_and_user_files() {
    let root = temp_root("download-only");
    let repository = BtRepository::new(Storage::new(root.clone()).unwrap());
    let mut download = sample_row(&"a".repeat(40));
    let user_dir = root.join("user-downloads");
    std::fs::create_dir(&user_dir).unwrap();
    let user_file = user_dir.join("original.bin");
    std::fs::write(&user_file, b"keep").unwrap();
    download.dest_dir = user_dir.to_string_lossy().into_owned();
    repository.upsert_bt_task(&download).unwrap();
    let mut legacy = sample_row(&"b".repeat(40));
    legacy.mode = "preview".into();
    repository.upsert_bt_task(&legacy).unwrap();
    repository
        .storage
        .conn()
        .unwrap()
        .execute(
            "INSERT INTO bt_cache_access(info_hash,last_access) VALUES(?1,1)",
            params![legacy.info_hash],
        )
        .unwrap();
    let cache = root.join("bt/cache");
    std::fs::create_dir_all(&cache).unwrap();
    std::fs::write(cache.join("legacy.bin"), b"old cache").unwrap();
    for _ in 0..2 {
        repository.finish_bt_download_only_migration().unwrap();
        assert!(repository.get_bt_task(&legacy.info_hash).unwrap().is_none());
        assert!(repository
            .get_bt_task(&download.info_hash)
            .unwrap()
            .is_some());
        assert_eq!(std::fs::read(&user_file).unwrap(), b"keep");
        assert!(!cache.exists());
    }
    std::fs::remove_dir_all(root).unwrap();
}
