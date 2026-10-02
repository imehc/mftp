use super::*;
use crate::modules::lan_transfer::service::tests::Fixture;
use std::io::Write;
use std::sync::{Arc, Barrier};

fn request(conflict: Conflict, start: u64) -> UploadRequest {
    UploadRequest {
        relative: "folder/file.txt".into(),
        conflict,
        start,
        length: 3,
    }
}

#[test]
fn concurrent_renames_create_distinct_files_and_preserve_existing_bytes() {
    let fixture = Fixture::new();
    let root = fixture.root.join("uploads");
    std::fs::create_dir_all(root.join("folder")).unwrap();
    std::fs::write(root.join("folder/file.txt"), b"original").unwrap();
    let barrier = Arc::new(Barrier::new(4));
    std::thread::scope(|scope| {
        let mut workers = vec![];
        for _ in 0..4 {
            let barrier = barrier.clone();
            let root = &root;
            workers.push(scope.spawn(move || {
                barrier.wait();
                let mut target = open(root, &request(Conflict::Rename, 0)).unwrap();
                target.file.write_all(b"new").unwrap();
                target.name
            }));
        }
        let names: std::collections::HashSet<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(names.len(), 4);
        for name in names {
            assert_eq!(std::fs::read(root.join(name)).unwrap(), b"new");
        }
    });
    assert_eq!(
        std::fs::read(root.join("folder/file.txt")).unwrap(),
        b"original"
    );
}

#[test]
fn resume_checks_even_zero_and_locks_precede_truncation() {
    let fixture = Fixture::new();
    let root = fixture.root.join("uploads");
    let mut first = open(&root, &request(Conflict::Resume, 0)).unwrap();
    first.file.write_all(b"abc").unwrap();
    for conflict in [Conflict::Resume, Conflict::Overwrite] {
        let error = open(&root, &request(conflict, 0)).err().unwrap();
        assert_eq!(error.code, "lan:upload_target_busy");
        assert_eq!(std::fs::read(root.join(&first.name)).unwrap(), b"abc");
    }
    drop(first);
    assert_eq!(
        open(&root, &request(Conflict::Resume, 0))
            .err()
            .unwrap()
            .code,
        "lan:upload_offset_mismatch"
    );
    let mut resumed = open(&root, &request(Conflict::Resume, 3)).unwrap();
    resumed.file.write_all(b"def").unwrap();
    drop(resumed);
    assert_eq!(
        std::fs::read(root.join("folder/file.txt")).unwrap(),
        b"abcdef"
    );
    let overwritten = open(&root, &request(Conflict::Overwrite, 0)).unwrap();
    assert_eq!(overwritten.file.metadata().unwrap().len(), 0);
}

#[test]
fn missing_resume_and_invalid_parents_do_not_create_or_remove_a_target() {
    let fixture = Fixture::new();
    assert_eq!(
        open(&fixture.root, &request(Conflict::Resume, 2))
            .err()
            .unwrap()
            .code,
        "lan:upload_offset_mismatch"
    );
    assert!(!fixture.root.join("folder/file.txt").exists());
    std::fs::write(fixture.root.join("blocker"), b"keep").unwrap();
    let mut input = request(Conflict::Overwrite, 0);
    input.relative = "blocker/file".into();
    assert!(open(&fixture.root, &input).is_err());
    assert_eq!(
        std::fs::read(fixture.root.join("blocker")).unwrap(),
        b"keep"
    );
}

#[cfg(unix)]
#[test]
fn upload_and_queries_reject_symbolic_targets_and_parent_directories() {
    let fixture = Fixture::new();
    let root = fixture.root.join("uploads");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(fixture.root.join("outside")).unwrap();
    std::fs::write(fixture.root.join("outside/file.txt"), b"keep").unwrap();
    std::os::unix::fs::symlink(fixture.root.join("outside"), root.join("folder")).unwrap();
    assert!(open(&root, &request(Conflict::Overwrite, 0)).is_err());
    assert!(destination(&root, Path::new("folder/file.txt"), false).is_err());
    std::os::unix::fs::symlink(fixture.root.join("outside/file.txt"), root.join("link")).unwrap();
    let mut input = request(Conflict::Overwrite, 0);
    input.relative = "link".into();
    assert!(open(&root, &input).is_err());
    assert_eq!(
        std::fs::read(fixture.root.join("outside/file.txt")).unwrap(),
        b"keep"
    );
}
