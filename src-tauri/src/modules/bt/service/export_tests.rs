use super::*;

#[test]
fn failed_export_does_not_remove_an_existing_destination() {
    let root = temp_dir("collision");
    let source = root.join("source.txt");
    let target = root.join("existing.txt");
    std::fs::write(&source, "new content").unwrap();
    std::fs::write(&target, "original content").unwrap();
    let error = copy_without_overwrite(&source, &target).unwrap_err();
    assert_eq!(error.code, "io:already_exists");
    assert_eq!(
        std::fs::read_to_string(&target).unwrap(),
        "original content"
    );
    let error = copy_without_overwrite(&root.join("missing"), &target).unwrap_err();
    assert_eq!(error.code, "io:not_found");
    assert_eq!(
        std::fs::read_to_string(&target).unwrap(),
        "original content"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn archive_cancellation_is_terminal_and_preserves_the_application_error() {
    let cancelled = AtomicBool::new(true);
    let mut reader = CancelReader {
        source: std::io::Cursor::new(b"data"),
        cancelled: &cancelled,
    };
    let error = reader.read(&mut [0; 4]).unwrap_err();
    assert_ne!(error.kind(), std::io::ErrorKind::Interrupted);
    assert_eq!(
        AppError::from(error),
        AppError::custom(CustomErrorCode::BtTaskCancelled)
    );
    let mut archive = tar::Builder::new(Vec::new());
    let mut header = tar::Header::new_gnu();
    header.set_size(4);
    header.set_mode(0o644);
    header.set_cksum();
    let error = archive
        .append_data(&mut header, "entry", reader)
        .unwrap_err();
    assert_eq!(
        AppError::from(error),
        AppError::custom(CustomErrorCode::BtTaskCancelled)
    );
}

#[test]
fn archive_missing_source_keeps_the_io_error_category() {
    let root = temp_dir("missing-source");
    let files = [ExportFile {
        absolute: root.join("missing"),
        relative: "missing".into(),
        len: 4,
    }];
    let error = pack_tar(&files, &root.join("archive.tar"), &AtomicBool::new(false)).unwrap_err();
    assert_eq!(error.code, "io:not_found");
    std::fs::remove_dir_all(root).unwrap();
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mftp-bt-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn packs_selected_files_with_relative_paths() {
    let root = temp_dir("pack");
    let first = root.join("first.txt");
    let nested = root.join("nested/second.txt");
    std::fs::create_dir_all(nested.parent().unwrap()).unwrap();
    File::create(&first).unwrap().write_all(b"first").unwrap();
    File::create(&nested).unwrap().write_all(b"second").unwrap();
    let target = root.join("result.tar");
    let files = vec![
        ExportFile {
            absolute: first,
            relative: "folder/first.txt".into(),
            len: 5,
        },
        ExportFile {
            absolute: nested,
            relative: "folder/nested/second.txt".into(),
            len: 6,
        },
    ];
    pack_tar(&files, &target, &AtomicBool::new(false)).unwrap();

    let names = tar::Archive::new(File::open(&target).unwrap())
        .entries()
        .unwrap()
        .map(|entry| entry.unwrap().path().unwrap().into_owned())
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        vec![
            PathBuf::from("folder/first.txt"),
            PathBuf::from("folder/nested/second.txt")
        ]
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn copying_private_output_uses_unique_name_without_overwrite() {
    let source_root = temp_dir("move-source");
    let destination = temp_dir("move-destination");
    let source = source_root.join("source.bin");
    std::fs::write(&source, b"payload").unwrap();
    std::fs::write(destination.join("source.bin"), b"old").unwrap();

    let target = copy_path_to_dir(&source, &destination, "source.bin").unwrap();

    assert_eq!(target, destination.join("source (2).bin"));
    assert_eq!(std::fs::read(target).unwrap(), b"payload");
    assert_eq!(std::fs::read(&source).unwrap(), b"payload");
    std::fs::remove_dir_all(source_root).unwrap();
    std::fs::remove_dir_all(destination).unwrap();
}

#[test]
fn tar_suffix_is_preserved_when_choosing_unique_name() {
    let root = temp_dir("unique");
    File::create(root.join("sample.tar")).unwrap();
    assert_eq!(
        unique_path(&root, "sample.tar"),
        root.join("sample (2).tar")
    );
    std::fs::remove_dir_all(root).unwrap();
}
