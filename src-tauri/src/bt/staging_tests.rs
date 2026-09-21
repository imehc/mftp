use super::*;
use std::path::PathBuf;

fn temp_root(name: &str) -> PathBuf {
    let root =
        std::env::temp_dir().join(format!("mftp-bt-private-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

#[test]
fn private_cleanup_removes_only_the_exact_hash_child() {
    let root = temp_root("owned");
    let hash = "a".repeat(40);
    let owned = root.join(&hash);
    std::fs::create_dir_all(&owned).unwrap();
    remove_owned_hash_dir(&root, &owned, &hash).unwrap();
    assert!(!owned.exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn private_cleanup_rejects_user_directories() {
    let root = temp_root("root");
    let user = temp_root("user");
    let sentinel = user.join("keep.txt");
    std::fs::write(&sentinel, b"keep").unwrap();
    let hash = "b".repeat(40);
    assert!(remove_owned_hash_dir(&root, &user, &hash).is_err());
    assert_eq!(std::fs::read(&sentinel).unwrap(), b"keep");
    std::fs::remove_dir_all(root).unwrap();
    std::fs::remove_dir_all(user).unwrap();
}
