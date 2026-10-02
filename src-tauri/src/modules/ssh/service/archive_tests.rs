use super::*;

#[test]
fn archive_path_rejections_keep_the_offending_path_in_structured_error() {
    for path in ["../escape", "/absolute", "root/../../escape"] {
        assert_eq!(
            archive_entry_target(Path::new("output"), Path::new(path)).unwrap_err(),
            AppError::custom(CustomErrorCode::SftpArchiveUnsafePath).with_arg("path", path),
        );
    }
    assert_eq!(
        archive_entry_target(Path::new("output"), Path::new("root/file.txt")).unwrap(),
        Some(PathBuf::from("output/file.txt")),
    );
}

#[test]
fn non_directory_archive_source_returns_custom_error() {
    let path = std::env::temp_dir().join(format!("mftp-missing-{}", uuid::Uuid::new_v4()));
    assert_eq!(
        pack_clean_tar_gz(path.to_str().unwrap(), "root", &path, None, None, None).unwrap_err(),
        AppError::custom(CustomErrorCode::SftpNotDirectory),
    );
}
