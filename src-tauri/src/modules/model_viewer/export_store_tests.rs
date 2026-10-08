use super::*;

struct Fixture {
    root: PathBuf,
    store: ModelExportStore,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("mftp-export-tests-{}", uuid::Uuid::new_v4()));
        Self {
            store: ModelExportStore::new(root.clone()),
            root,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn chunks_are_ordered_and_complete_before_handoff() {
    let fixture = Fixture::new();
    let id = fixture.store.begin("capture.png".into(), 4).unwrap();
    assert!(fixture.store.prepare(&id).is_err());
    assert!(fixture.store.write(&id, 1, &[1]).is_err());
    fixture.store.write(&id, 0, &[1, 2]).unwrap();
    assert!(fixture.store.write(&id, 0, &[1, 2]).is_err());
    assert!(fixture.store.write(&id, 2, &[3, 4, 5]).is_err());
    fixture.store.write(&id, 2, &[3, 4]).unwrap();
    let (path, mime) = fixture.store.prepare(&id).unwrap();
    assert_eq!(mime, "image/png");
    assert_eq!(fs::read(path).unwrap(), vec![1, 2, 3, 4]);
    assert!(fixture.store.close(&id).is_err());
    assert!(fixture.store.prepare(&id).is_err());
    fixture.store.finish(&id);
    fixture.store.close(&id).unwrap();
    assert!(fixture.root.join(id).exists());
}

#[test]
fn rejected_names_and_capacity_do_not_create_user_files() {
    let fixture = Fixture::new();
    for name in [
        "../source.png",
        "/source.png",
        "nested/file.png",
        "a\\b.png",
        "x.html",
        "bad\0.png",
    ] {
        assert!(fixture.store.begin(name.into(), 1).is_err());
    }
    assert!(fixture.store.begin("file.mp4".into(), 0).is_err());
    assert!(fixture
        .store
        .begin("file.mp4".into(), MAX_BYTES as u32 + 1)
        .is_err());
    assert!(!fixture.root.exists());
    for _ in 0..4 {
        fixture
            .store
            .begin("recording.mp4".into(), MAX_BYTES as u32)
            .unwrap();
    }
    assert_eq!(
        fixture
            .store
            .begin("another.png".into(), 1)
            .unwrap_err()
            .code,
        "model:export_capacity"
    );
}

#[test]
fn unpresented_uploads_are_removed_without_touching_other_exports() {
    let fixture = Fixture::new();
    let first = fixture.store.begin("same.png".into(), 1).unwrap();
    let second = fixture.store.begin("same.png".into(), 1).unwrap();
    fixture.store.write(&second, 0, &[9]).unwrap();
    fixture.store.close(&first).unwrap();
    assert!(!fixture.root.join(first).exists());
    assert_eq!(
        fs::read(fixture.root.join(second).join("same.png")).unwrap(),
        [9]
    );
    fixture.store.close("../../outside").unwrap();
}

#[test]
fn expiry_only_removes_owned_inactive_directories() {
    let fixture = Fixture::new();
    let live = fixture.store.begin("live.png".into(), 1).unwrap();
    let retained = fixture.store.begin("shared.png".into(), 1).unwrap();
    fixture.store.write(&retained, 0, &[7]).unwrap();
    fixture.store.prepare(&retained).unwrap();
    fixture.store.finish(&retained);
    fixture.store.close(&retained).unwrap();
    let entries = fixture.store.entries.lock();
    fixture
        .store
        .sweep(
            &entries,
            SystemTime::now() + RETENTION + Duration::from_secs(2),
        )
        .unwrap();
    assert!(fixture.root.join(live).exists());
    assert!(!fixture.root.join(retained).exists());
}

#[cfg(unix)]
#[test]
fn symlinks_are_not_followed_by_cleanup() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    fixture.store.prepare_root().unwrap();
    let external = Fixture::new();
    external.store.prepare_root().unwrap();
    fs::write(external.root.join("keep.png"), [9]).unwrap();
    symlink(
        &external.root,
        fixture.root.join(uuid::Uuid::new_v4().to_string()),
    )
    .unwrap();
    assert!(fixture.store.begin("new.png".into(), 1).is_err());
    assert_eq!(fs::read(external.root.join("keep.png")).unwrap(), [9]);
}
