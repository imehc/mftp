use super::*;

fn temp_root(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("mftp-data-{name}-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    root
}

fn read_meta(storage: &Storage, key: &str) -> Option<String> {
    storage
        .conn()
        .unwrap()
        .query_row("SELECT value FROM app_meta WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .ok()
}

#[test]
fn clearing_one_module_preserves_other_data() {
    let root = temp_root("module");
    let storage = Storage::new(root.clone()).unwrap();
    storage
            .conn()
            .unwrap()
            .execute("INSERT INTO todo_items(id,title,completed,created_at,updated_at) VALUES('todo','Task',0,1,1)", [])
            .unwrap();
    storage
        .conn()
        .unwrap()
        .execute(
            "INSERT INTO vault_entries(id,title,created_at,updated_at) VALUES('vault','Entry',1,1)",
            [],
        )
        .unwrap();

    assert_eq!(storage.clear_data_module(AppDataModule::Todo).unwrap(), 1);
    let conn = storage.conn().unwrap();
    let todo_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM todo_items", [], |row| row.get(0))
        .unwrap();
    let vault_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM vault_entries", [], |row| row.get(0))
        .unwrap();
    assert_eq!(todo_count, 0);
    assert_eq!(vault_count, 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reset_clears_internal_records_without_touching_external_files() {
    let root = temp_root("reset");
    let external = temp_root("external");
    let external_file = external.join("download.bin");
    fs::write(&external_file, b"keep").unwrap();
    let storage = Storage::new(root.clone()).unwrap();
    storage
        .conn()
        .unwrap()
        .execute("INSERT INTO app_meta(key,value) VALUES('test','value')", [])
        .unwrap();
    storage.reset_database().unwrap();
    assert_eq!(storage.app_data_usage().main_database_bytes > 0, true);
    assert!(external_file.exists());
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(external).unwrap();
}

#[test]
fn reset_does_not_reimport_legacy_hosts_and_keys_on_restart() {
    let root = temp_root("reset-legacy-restart");
    let hosts = br#"[{"id":"legacy-host","label":"Old host","host":"localhost","port":22,"username":"test","authType":"key","keyId":"legacy-key","createdAt":1,"updatedAt":1}]"#;
    let keys = br#"[{"id":"legacy-key","label":"Old key","filename":"old-key","hasPassphrase":false,"createdAt":1}]"#;
    fs::write(root.join("hosts.json"), hosts).unwrap();
    fs::write(root.join("keys.json"), keys).unwrap();
    fs::create_dir(root.join("keys")).unwrap();
    fs::write(root.join("keys/old-key"), b"test fixture key").unwrap();
    let storage = Storage::new(root.clone()).unwrap();
    let counts = |storage: &Storage| {
        storage
            .conn()
            .unwrap()
            .query_row(
                "SELECT (SELECT COUNT(*) FROM hosts), (SELECT COUNT(*) FROM ssh_keys)",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .unwrap()
    };
    assert_eq!(counts(&storage), (1, 1));
    for _ in 0..2 {
        storage.reset_database().unwrap();
        let reopened = Storage::new(root.clone()).unwrap();
        assert_eq!(counts(&reopened), (0, 0));
        assert_eq!(fs::read(root.join("hosts.json")).unwrap(), hosts);
        assert_eq!(fs::read(root.join("keys.json")).unwrap(), keys);
        assert_eq!(
            fs::read(root.join("keys/old-key")).unwrap(),
            b"test fixture key"
        );
    }
    // Retired JSON is no longer an input, even if an old backup is damaged.
    fs::write(root.join("hosts.json"), b"invalid retired JSON").unwrap();
    assert_eq!(counts(&Storage::new(root.clone()).unwrap()), (0, 0));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn reset_preserves_migration_versions_and_clears_settings_atomically() {
    let root = temp_root("reset-metadata");
    let storage = Storage::new(root.clone()).unwrap();
    let conn = storage.conn().unwrap();
    conn.execute_batch(
        "INSERT INTO todo_items(id,title,completed,created_at,updated_at) VALUES('todo','Task',0,1,1);
         UPDATE app_meta SET value = '99' WHERE key = 'bt_error_payload_schema_version';
         INSERT INTO app_meta(key,value) VALUES('bt_download_only_migrated_v1','1');
         INSERT INTO app_meta(key,value) VALUES('bt_cache_quota','1024');
         INSERT INTO app_meta(key,value) VALUES('activity_log_error_legacy_before_ms','100');
         CREATE TRIGGER reject_metadata_clear BEFORE DELETE ON app_meta
         WHEN OLD.key = 'bt_cache_quota'
         BEGIN SELECT RAISE(ABORT, 'test metadata clear failure'); END;",
    ).unwrap();
    assert!(storage.reset_database().is_err());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM todo_items", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(storage.migration_done(&conn).unwrap());
    assert_eq!(
        read_meta(&storage, "bt_cache_quota").as_deref(),
        Some("1024")
    );
    conn.execute_batch("DROP TRIGGER reject_metadata_clear")
        .unwrap();
    assert_eq!(storage.reset_database().unwrap(), 3);
    assert!(read_meta(&storage, "bt_cache_quota").is_none());
    // There are no historical activity rows after reset, so their watermark
    // is intentionally cleared while structural versions remain unchanged.
    assert!(read_meta(&storage, "activity_log_error_legacy_before_ms").is_none());
    assert!(storage.migration_done(&conn).unwrap());
    for (key, value) in [
        ("ai_schema_version", "3"),
        ("bt_error_payload_schema_version", "99"),
        ("bt_download_only_migrated_v1", "1"),
    ] {
        assert_eq!(read_meta(&storage, key).as_deref(), Some(value));
    }
    let reopened = Storage::new(root.clone()).unwrap();
    assert_eq!(
        read_meta(&reopened, "bt_error_payload_schema_version").as_deref(),
        Some("99")
    );
    drop(conn);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn module_owned_bt_reset_rolls_back_with_shared_database_failure() {
    let root = temp_root("bt-reset-rollback");
    let storage = Storage::new(root.clone()).unwrap();
    let conn = storage.conn().unwrap();
    conn.execute_batch(
        "INSERT INTO bt_tasks(info_hash,label,dest_dir,created_at) VALUES('task','original','/user/files',1);
         INSERT INTO bt_cache_access(info_hash,last_access) VALUES('task',1);
         INSERT INTO todo_items(id,title,completed,created_at,updated_at) VALUES('todo','Task',0,1,1);
         CREATE TRIGGER reject_reset BEFORE DELETE ON todo_items
         BEGIN SELECT RAISE(ABORT, 'test reset failure'); END;",
    ).unwrap();
    assert!(storage.reset_database().is_err());
    for query in [
        "SELECT COUNT(*) FROM bt_tasks",
        "SELECT COUNT(*) FROM bt_cache_access",
    ] {
        assert_eq!(
            conn.query_row(query, [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    conn.execute_batch("DROP TRIGGER reject_reset").unwrap();
    // Retained schema markers are not counted as deleted user records.
    assert_eq!(storage.reset_database().unwrap(), 3);
    for query in [
        "SELECT COUNT(*) FROM bt_tasks",
        "SELECT COUNT(*) FROM bt_cache_access",
    ] {
        assert_eq!(
            conn.query_row(query, [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    drop(conn);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn bt_reset_detaches_internal_data_from_surviving_writers() {
    use std::io::Write;
    let root = temp_root("bt-tombstone");
    let storage = Storage::new(root.clone()).unwrap();
    let bt = root.join("bt");
    fs::create_dir_all(&bt).unwrap();
    fs::write(bt.join("dht.json"), b"{}").unwrap();
    // Stand in for a librqbit writer that never observed the cancellation.
    let mut survivor = fs::OpenOptions::new()
        .write(true)
        .open(bt.join("dht.json"))
        .unwrap();
    storage.remove_bt_internal_data().unwrap();
    assert!(!bt.exists());
    // The quiet tombstone got removed in the same call, not deferred.
    assert_eq!(storage.app_data_usage().bt_internal_bytes, 0);
    survivor.write_all(b"stale").unwrap();
    survivor.flush().unwrap();
    assert!(!bt.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn pending_bt_tombstones_count_as_usage_and_sweep_on_storage_startup() {
    let root = temp_root("bt-sweep");
    let storage = Storage::new(root.clone()).unwrap();
    assert_eq!(storage.app_data_usage().bt_internal_bytes, 0);
    let tombstone = root.join(format!("{BT_TOMBSTONE_PREFIX}manual"));
    fs::create_dir_all(&tombstone).unwrap();
    fs::write(tombstone.join("dht.json"), vec![b'x'; 64]).unwrap();
    assert_eq!(storage.app_data_usage().bt_internal_bytes, 64);
    drop(storage);
    Storage::new(root.clone()).unwrap();
    assert!(!tombstone.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn bt_detach_failure_preserves_live_and_existing_tombstone_data() {
    let root = temp_root("bt-detach-failure");
    let live = root.join("bt");
    let tombstone = root.join("occupied-tombstone");
    fs::create_dir(&live).unwrap();
    fs::create_dir(&tombstone).unwrap();
    fs::write(live.join("session.json"), b"live state").unwrap();
    fs::write(tombstone.join("session.json"), b"previous state").unwrap();

    // A nonempty destination forces a real rename failure on every platform,
    // without chmod assumptions that fail when tests run as root.
    let error = detach_bt_directory(&live, &tombstone).unwrap_err();
    assert_eq!(error.kind, crate::error::AppErrorKind::External);
    assert_eq!(fs::read(live.join("session.json")).unwrap(), b"live state");
    assert_eq!(
        fs::read(tombstone.join("session.json")).unwrap(),
        b"previous state"
    );
    fs::remove_dir_all(&tombstone).unwrap();
    assert!(detach_bt_directory(&live, &tombstone).unwrap());
    assert!(!live.exists());
    assert_eq!(
        fs::read(tombstone.join("session.json")).unwrap(),
        b"live state"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn bt_detach_distinguishes_missing_data_from_path_lookup_failure() {
    let root = temp_root("bt-detach-lookup");
    let tombstone = root.join("tombstone");
    assert!(!detach_bt_directory(&root.join("missing"), &tombstone).unwrap());
    fs::write(root.join("blocked"), b"parent is a file").unwrap();
    let error = detach_bt_directory(&root.join("blocked/bt"), &tombstone).unwrap_err();
    assert_eq!(error.kind, crate::error::AppErrorKind::External);
    assert!(!tombstone.exists());
    assert_eq!(fs::read(root.join("blocked")).unwrap(), b"parent is a file");
    fs::remove_dir_all(root).unwrap();
}
