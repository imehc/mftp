use super::*;

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
            index: 0,
            absolute: first,
            relative: "folder/first.txt".into(),
            len: 5,
        },
        ExportFile {
            index: 1,
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
fn tar_suffix_is_preserved_when_choosing_unique_name() {
    let root = temp_dir("unique");
    File::create(root.join("sample.tar")).unwrap();
    assert_eq!(
        unique_path(&root, "sample.tar"),
        root.join("sample (2).tar")
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn single_file_export_keeps_name_and_never_overwrites() {
    let source_root = temp_dir("single-source");
    let destination = temp_dir("single-destination");
    let source = source_root.join("source.bin");
    File::create(&source)
        .unwrap()
        .write_all(b"payload")
        .unwrap();
    File::create(destination.join("source.bin")).unwrap();
    let file = ExportFile {
        index: 0,
        absolute: source,
        relative: "folder/source.bin".into(),
        len: 7,
    };
    let target = copy_export_file(&file, &destination).unwrap();
    assert_eq!(target, destination.join("source (2).bin"));
    assert_eq!(std::fs::read(target).unwrap(), b"payload");
    std::fs::remove_dir_all(source_root).unwrap();
    std::fs::remove_dir_all(destination).unwrap();
}

#[test]
fn cancelled_archive_export_removes_partial_file() {
    let source_root = temp_dir("cancelled-source");
    let destination = temp_dir("cancelled-destination");
    let source = source_root.join("source.bin");
    File::create(&source)
        .unwrap()
        .write_all(b"payload")
        .unwrap();
    let files = vec![
        ExportFile {
            index: 0,
            absolute: source.clone(),
            relative: "source.bin".into(),
            len: 7,
        },
        ExportFile {
            index: 1,
            absolute: source,
            relative: "copy.bin".into(),
            len: 7,
        },
    ];
    let hash = "a".repeat(40);
    let result = export_files(
        &files,
        &destination,
        "cancelled",
        &hash,
        &AtomicBool::new(true),
    );
    assert!(result.is_err());
    assert!(!destination.join("cancelled.tar").exists());
    assert!(!destination
        .join(format!(".cancelled.tar.{hash}.mftp-part"))
        .exists());
    std::fs::remove_dir_all(source_root).unwrap();
    std::fs::remove_dir_all(destination).unwrap();
}

#[test]
fn staged_file_moves_out_without_clobbering_the_folder() {
    let staging = temp_dir("move-staging");
    let destination = temp_dir("move-destination");
    let source = staging.join("source.bin");
    File::create(&source)
        .unwrap()
        .write_all(b"payload")
        .unwrap();
    File::create(destination.join("source.bin")).unwrap();
    let file = ExportFile {
        index: 0,
        absolute: source.clone(),
        relative: "folder/source.bin".into(),
        len: 7,
    };
    let target = move_export_file(&file, &destination).unwrap();
    assert_eq!(target, destination.join("source (2).bin"));
    assert_eq!(std::fs::read(target).unwrap(), b"payload");
    assert!(!source.exists());
    std::fs::remove_dir_all(staging).unwrap();
    std::fs::remove_dir_all(destination).unwrap();
}

#[test]
fn file_completion_uses_the_target_file_progress() {
    let progress = vec![10, 2, 30];
    assert!(progress_reaches_len(&progress, 0, 10));
    assert!(!progress_reaches_len(&progress, 1, 20));
    assert!(progress_reaches_len(&progress, 2, 30));
    assert!(!progress_reaches_len(&progress, 4, 1));
}
