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
