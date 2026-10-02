use std::fs;
use std::sync::Arc;
use std::time::Duration;

use crate::core::operations::Operations;

use super::PoetryLibrary;

#[test]
fn library_startup_removes_stale_temp_data() {
    let root = std::env::temp_dir().join(format!(
        "mftp-poetry-startup-cleanup-{}",
        std::process::id()
    ));
    let temp_dir = root.join("poetry-tmp");
    let nested = temp_dir.join("pack-extract");
    fs::create_dir_all(&nested).expect("create stale temp data");
    fs::write(nested.join("partial.json"), b"partial").expect("write stale temp data");
    fs::write(root.join("poetry.sqlite3"), b"installed database").expect("write database");

    let library = PoetryLibrary::new(root.clone(), Arc::new(Operations::default()));

    assert!(!library.tmp_dir().exists());
    assert!(root.join("poetry.sqlite3").exists());
    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn maintenance_and_shutdown_reject_jobs_without_claiming_the_slot() {
    let root = std::env::temp_dir().join(format!("mftp-poetry-admission-{}", std::process::id()));
    let operations = Arc::new(Operations::default());
    let library = Arc::new(PoetryLibrary::new(root.clone(), operations.clone()));

    let maintenance = operations
        .maintenance(Duration::from_secs(2))
        .await
        .unwrap();
    assert_eq!(
        library
            .begin_network_sync(|_| {}, Vec::new())
            .unwrap_err()
            .code,
        "app:maintenance_in_progress"
    );
    assert!(!library.is_active());
    drop(maintenance);

    operations.close();
    assert_eq!(
        library
            .begin_local_import(|_| {}, String::new(), Vec::new())
            .unwrap_err()
            .code,
        "app:shutting_down"
    );
    assert_eq!(
        library.begin_annotations_install(|_| {}).unwrap_err().code,
        "app:shutting_down"
    );
    assert!(!library.is_active());
    let _ = fs::remove_dir_all(root);
}
