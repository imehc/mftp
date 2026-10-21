//! The runtime grant must widen the fs scope by exactly the picked path.

use std::path::{Path, PathBuf};

use tauri_plugin_fs::FsExt;

use super::allow_path;

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .plugin(tauri_plugin_fs::init())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app")
}

/// A location the static capability scope never covers.
fn picked_path() -> PathBuf {
    Path::new(&std::env::temp_dir())
        .join("mftp-filesystem-scope")
        .join("picked.bin")
}

#[test]
fn allows_the_picked_path_and_nothing_next_to_it() {
    let app = mock_app();
    let scope = app.handle().fs_scope();
    let picked = picked_path();
    assert!(!scope.is_allowed(&picked), "temp dir starts outside scope");

    allow_path(app.handle(), &picked.to_string_lossy());

    assert!(scope.is_allowed(&picked));
    assert!(!scope.is_allowed(picked.with_file_name("other.bin")));
}

#[test]
fn ignores_empty_and_relative_paths() {
    let app = mock_app();
    let scope = app.handle().fs_scope();

    allow_path(app.handle(), "");
    allow_path(app.handle(), "relative/picked.bin");

    assert!(scope.allowed_patterns().is_empty());
}
