use super::super::test_support::Fixture;
use super::*;

fn write_archive(path: &Path, entries: &[(&str, &[u8])]) {
    let file = fs::File::create(path).unwrap();
    let gzip = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
    let mut builder = tar::Builder::new(gzip);
    for (name, bytes) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_mode(0o644);
        header.set_size(bytes.len() as u64);
        header.set_cksum();
        builder.append_data(&mut header, name, *bytes).unwrap();
    }
    builder.into_inner().unwrap().finish().unwrap();
}

fn assert_no_temps(fixture: &Fixture) {
    assert!(fixture.manager.local_temps.lock().is_empty());
    assert!(!fixture.root.join("journal.json").exists());
    assert!(!fs::read_dir(&fixture.root).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".mftp-extract-")));
}

#[test]
fn successful_extraction_publishes_without_top_level_name_and_merges_existing_files() {
    for existing in [false, true] {
        let fixture = Fixture::new();
        let archive = fixture.root.join("input.tar.gz");
        write_archive(
            &archive,
            &[("root/file", b"updated"), ("root/nested/child", b"child")],
        );
        let destination = fixture.root.join("renamed");
        if existing {
            fs::create_dir(&destination).unwrap();
            fs::write(destination.join("file"), b"previous").unwrap();
            fs::write(destination.join("keep"), b"original").unwrap();
        }
        fixture
            .manager
            .extract_download(&archive, &destination, None)
            .unwrap();
        assert_eq!(fs::read(destination.join("file")).unwrap(), b"updated");
        assert_eq!(
            fs::read(destination.join("nested/child")).unwrap(),
            b"child"
        );
        if existing {
            assert_eq!(fs::read(destination.join("keep")).unwrap(), b"original");
        }
        assert_no_temps(&fixture);
    }
}

#[test]
fn corrupt_gzip_trailer_keeps_existing_destination_unchanged_and_removes_partial_extraction() {
    let fixture = Fixture::new();
    let archive = fixture.root.join("input.tar.gz");
    write_archive(
        &archive,
        &[("root/file", b"replacement"), ("root/new", b"new")],
    );
    let mut bytes = fs::read(&archive).unwrap();
    let checksum = bytes.len() - 8;
    bytes[checksum] ^= 0xff;
    fs::write(&archive, bytes).unwrap();
    let destination = fixture.root.join("destination");
    fs::create_dir(&destination).unwrap();
    fs::write(destination.join("file"), b"original").unwrap();
    assert!(fixture
        .manager
        .extract_download(&archive, &destination, None)
        .is_err());
    assert_eq!(fs::read(destination.join("file")).unwrap(), b"original");
    assert!(!destination.join("new").exists());
    assert_no_temps(&fixture);
}

#[test]
fn cancellation_and_invalid_roots_never_publish_partial_directories() {
    let fixture = Fixture::new();
    let archive = fixture.root.join("input.tar.gz");
    let destination = fixture.root.join("destination");
    write_archive(
        &archive,
        &[("first/file", b"first"), ("second/file", b"second")],
    );
    assert_eq!(
        fixture
            .manager
            .extract_download(&archive, &destination, None)
            .unwrap_err()
            .code,
        "sftp:archive_unsafe_path"
    );
    assert!(!destination.exists());
    assert_no_temps(&fixture);
    write_archive(&archive, &[("root/file", b"file")]);
    let transfer = fixture.manager.transfer_guard(Some("cancelled")).unwrap();
    fixture.manager.cancel_transfer("cancelled");
    assert_eq!(
        fixture
            .manager
            .extract_download(&archive, &destination, Some(&transfer))
            .unwrap_err()
            .code,
        "sftp:transfer_cancelled"
    );
    assert!(!destination.exists());
    assert_no_temps(&fixture);
}

#[cfg(unix)]
#[test]
fn archive_symlink_and_hard_link_entries_cannot_overwrite_outside_staging() {
    for hard_link in [false, true] {
        let fixture = Fixture::new();
        let outside = fixture.root.join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("victim"), b"original").unwrap();
        let archive = fixture.root.join("input.tar.gz");
        let gzip = flate2::write::GzEncoder::new(
            fs::File::create(&archive).unwrap(),
            flate2::Compression::fast(),
        );
        let mut builder = tar::Builder::new(gzip);
        let mut header = tar::Header::new_gnu();
        header.set_mode(0o755);
        header.set_size(0);
        header.set_entry_type(if hard_link {
            tar::EntryType::Link
        } else {
            tar::EntryType::Symlink
        });
        let target = if hard_link {
            outside.join("victim")
        } else {
            outside.clone()
        };
        builder
            .append_link(&mut header, "root/escape", &target)
            .unwrap();
        let mut header = tar::Header::new_gnu();
        header.set_mode(0o644);
        header.set_size(4);
        header.set_cksum();
        builder
            .append_data(&mut header, "root/escape/victim", &b"evil"[..])
            .unwrap();
        builder.into_inner().unwrap().finish().unwrap();
        let destination = fixture.root.join("destination");
        assert!(fixture
            .manager
            .extract_download(&archive, &destination, None)
            .is_err());
        assert_eq!(fs::read(outside.join("victim")).unwrap(), b"original");
        assert!(!destination.exists());
        assert_no_temps(&fixture);
    }
}

#[cfg(unix)]
#[test]
fn existing_destination_symlink_is_not_followed_during_merge() {
    let fixture = Fixture::new();
    let archive = fixture.root.join("input.tar.gz");
    write_archive(&archive, &[("root/nested/victim", b"replacement")]);
    let outside = fixture.root.join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("victim"), b"original").unwrap();
    let destination = fixture.root.join("destination");
    fs::create_dir(&destination).unwrap();
    std::os::unix::fs::symlink(&outside, destination.join("nested")).unwrap();
    assert!(fixture
        .manager
        .extract_download(&archive, &destination, None)
        .is_err());
    assert_eq!(fs::read(outside.join("victim")).unwrap(), b"original");
    assert_no_temps(&fixture);
}

#[test]
fn a_publication_conflict_preserves_user_directory_contents() {
    let fixture = Fixture::new();
    let archive = fixture.root.join("input.tar.gz");
    write_archive(&archive, &[("root/conflict", b"file")]);
    let destination = fixture.root.join("destination");
    fs::create_dir_all(destination.join("conflict")).unwrap();
    fs::write(destination.join("conflict/keep"), b"original").unwrap();
    assert_eq!(
        fixture
            .manager
            .extract_download(&archive, &destination, None)
            .unwrap_err()
            .code,
        "sftp:target_is_directory"
    );
    assert_eq!(
        fs::read(destination.join("conflict/keep")).unwrap(),
        b"original"
    );
    assert_no_temps(&fixture);
}

#[test]
fn an_empty_archive_still_publishes_an_empty_directory() {
    let fixture = Fixture::new();
    let archive = fixture.root.join("input.tar.gz");
    write_archive(&archive, &[]);
    let destination = fixture.root.join("destination");
    fixture
        .manager
        .extract_download(&archive, &destination, None)
        .unwrap();
    assert!(destination.is_dir());
    assert_eq!(fs::read_dir(destination).unwrap().count(), 0);
    assert_no_temps(&fixture);
}
