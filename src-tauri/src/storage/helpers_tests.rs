use super::*;

#[cfg(unix)]
#[test]
fn database_and_existing_sidecars_are_private_without_truncation() {
    use std::os::unix::fs::PermissionsExt;
    let root = std::env::temp_dir().join(format!("mftp-permissions-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let db = root.join("db.sqlite3");
    prepare_database(&db).unwrap();
    assert_eq!(
        fs::metadata(&db).unwrap().permissions().mode() & 0o777,
        0o600
    );
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let path = root.join(format!("db.sqlite3{suffix}"));
        fs::write(&path, b"keep").unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o644)).unwrap();
    }
    prepare_database(&db).unwrap();
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let path = root.join(format!("db.sqlite3{suffix}"));
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(fs::read(path).unwrap(), b"keep");
    }
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn permissions_failure_propagates_before_database_initialization() {
    use std::os::unix::fs::symlink;
    let root =
        std::env::temp_dir().join(format!("mftp-permissions-failure-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    // A symlink loop reliably fails chmod, including under privileged test users.
    let db = root.join("mftp.sqlite3");
    symlink("mftp.sqlite3", &db).unwrap();
    assert!(restrict_file_permissions(&db).is_err());
    assert!(crate::storage::Storage::new(root.clone()).is_err());
    assert!(fs::symlink_metadata(&db).unwrap().file_type().is_symlink());
    fs::remove_dir_all(root).unwrap();
}
