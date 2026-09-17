use super::*;

fn temp_root(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("mftp-data-{name}-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    root
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
