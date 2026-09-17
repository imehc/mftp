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
        total_bytes: Some(456),
        last_error: Some("retryable".into()),
    }
}

#[test]
fn upsert_round_trips_archive_state() {
    let root = temp_root("upsert");
    let storage = Storage::new(root.clone()).unwrap();
    let row = sample_row(&"a".repeat(40));
    storage.upsert_bt_task(&row).unwrap();
    let loaded = storage.get_bt_task(&row.info_hash).unwrap().unwrap();
    assert_eq!(loaded.file_indices, vec![1, 3]);
    assert_eq!(loaded.package_mode, "archive");
    assert_eq!(loaded.status, "packaging");
    assert_eq!(loaded.output_path, row.output_path);
    assert_eq!(loaded.total_bytes, Some(456));
    assert_eq!(loaded.last_error.as_deref(), Some("retryable"));
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

    let storage = Storage::new(root.clone()).unwrap();
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
fn clearing_preview_cache_keeps_history_outside_cache_lru() {
    let root = temp_root("cache-history");
    let storage = Storage::new(root.clone()).unwrap();
    let hash = "b".repeat(40);
    let mut row = sample_row(&hash);
    row.mode = "preview".into();
    row.package_mode = "direct".into();
    row.status = "active".into();
    row.total_bytes = None;
    storage.upsert_bt_task(&row).unwrap();
    storage.touch_bt_access(&hash).unwrap();

    assert!(storage.has_bt_access(&hash).unwrap());
    assert_eq!(storage.list_cache_lru().unwrap().len(), 1);

    storage.mark_bt_cache_cleared(&hash, Some(789)).unwrap();

    let history = storage.get_bt_task(&hash).unwrap().unwrap();
    assert_eq!(history.status, "completed");
    assert_eq!(history.total_bytes, Some(789));
    assert!(!history.pinned);
    assert!(!storage.has_bt_access(&hash).unwrap());
    assert!(storage.list_cache_lru().unwrap().is_empty());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn completing_only_touches_plain_downloads() {
    let root = temp_root("complete");
    let storage = Storage::new(root.clone()).unwrap();

    let direct = "d".repeat(40);
    let mut row = sample_row(&direct);
    row.package_mode = "direct".into();
    row.status = "active".into();
    row.total_bytes = None;
    row.last_error = Some("transient".into());
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
    assert_eq!(done.last_error, None);
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
    let storage = Storage::new(root.clone()).unwrap();
    let hash = "c".repeat(40);
    let mut row = sample_row(&hash);
    row.pinned = true;
    storage.upsert_bt_task(&row).unwrap();
    storage.touch_bt_access(&hash).unwrap();

    storage.mark_bt_task_cancelled(&hash).unwrap();

    let history = storage.get_bt_task(&hash).unwrap().unwrap();
    assert_eq!(history.status, "cancelled");
    assert_eq!(history.output_path, None);
    assert_eq!(history.last_error, None);
    assert!(!history.pinned);
    assert!(!storage.has_bt_access(&hash).unwrap());
    std::fs::remove_dir_all(root).unwrap();
}
