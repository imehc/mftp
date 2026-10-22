use super::*;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

fn task_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("mftp-rsync-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&path).expect("create task dir");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
        .expect("secure task dir");
    path
}

#[test]
fn helper_path_requires_the_private_task_directory_and_token() {
    let dir = task_dir("helper");
    let program = dir.join("mftp-rsync-bridge");
    assert!(!is_helper_path(&program), "token is missing");
    std::fs::write(dir.join(TOKEN_FILE), "token").expect("write token");
    assert!(is_helper_path(&program));
    assert_eq!(helper_task_dir(&program), Some(dir.clone()));

    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755))
        .expect("widen permissions");
    assert!(!is_helper_path(&program), "task dir must stay private");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn helper_path_rejects_other_names_and_directories() {
    let dir = task_dir("other");
    std::fs::write(dir.join(TOKEN_FILE), "token").expect("write token");
    assert!(!is_helper_path(&dir.join("rsync")));
    assert!(is_helper_path(&dir.join("mftp-rsync-bridge")));

    let plain = std::env::temp_dir().join(format!("plain-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&plain).expect("create plain dir");
    std::fs::write(plain.join(TOKEN_FILE), "token").expect("write token");
    assert!(!is_helper_path(&plain.join("mftp-rsync-bridge")));
    let _ = std::fs::remove_dir_all(dir);
    let _ = std::fs::remove_dir_all(plain);
}
