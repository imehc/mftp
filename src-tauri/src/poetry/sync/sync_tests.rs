use std::fs;

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

    let library = PoetryLibrary::new(root.clone());

    assert!(!library.tmp_dir().exists());
    assert!(library.db().path().exists());
    let _ = fs::remove_dir_all(root);
}
