use super::*;
use crate::modules::lan_transfer::service::tasks::SharedTasks;
use crate::modules::lan_transfer::service::tests::Fixture;

fn head(length: u64, range: &str) -> String {
    format!("POST /api/upload?name=file.txt&conflict=resume HTTP/1.1\r\nContent-Length: {length}\r\n{range}\r\n")
}

#[test]
fn successive_chunks_stop_at_their_own_end_and_resume_without_truncation() {
    let fixture = Fixture::new();
    let tasks = SharedTasks::default();
    let root = fixture.root.to_str().unwrap();
    for (start, initial, tail) in [
        (0, b"a".as_slice(), b"bcNEXT".as_slice()),
        (3, b"d", b"efNEXT"),
    ] {
        let mut reader = Cursor::new(tail);
        save_upload(
            &head(
                3,
                &format!("Content-Range: bytes {start}-{}/6\r\n", start + 2),
            ),
            initial,
            &mut reader,
            root,
            &tasks,
            "peer",
        )
        .unwrap();
        assert_eq!(reader.position(), 2);
    }
    assert_eq!(
        std::fs::read(fixture.root.join("file.txt")).unwrap(),
        b"abcdef"
    );
    assert_eq!(tasks.lock().rows.len(), 2);
    assert!(tasks
        .lock()
        .rows
        .values()
        .all(|task| task.status == "success" && task.total == 3 && task.transferred == 3));
}

#[test]
fn malformed_or_oversized_initial_bodies_cannot_touch_existing_files() {
    let fixture = Fixture::new();
    std::fs::create_dir_all(&fixture.root).unwrap();
    std::fs::write(fixture.root.join("file.txt"), b"original").unwrap();
    let tasks = SharedTasks::default();
    for request in [
        head(2, "Content-Range: bytes 0-2/3\r\n"),
        head(2, ""),
        head(0, ""),
    ] {
        assert!(save_upload(
            &request.replace("resume", "overwrite"),
            b"abc",
            &mut Cursor::new(b""),
            fixture.root.to_str().unwrap(),
            &tasks,
            "peer"
        )
        .is_err());
        assert_eq!(
            std::fs::read(fixture.root.join("file.txt")).unwrap(),
            b"original"
        );
    }
    assert!(tasks.lock().rows.is_empty());
}

#[test]
fn early_eof_finishes_failed_then_allows_resume_from_actual_bytes() {
    let fixture = Fixture::new();
    let tasks = SharedTasks::default();
    let root = fixture.root.to_str().unwrap();
    let error = save_upload(
        &head(6, ""),
        b"ab",
        &mut Cursor::new(b"c"),
        root,
        &tasks,
        "peer",
    )
    .unwrap_err();
    assert_eq!(error.code, "io:unexpected_eof");
    let task = tasks.lock().rows.values().next().unwrap().clone();
    assert_eq!((task.status.as_str(), task.transferred), ("failed", 3));
    assert_eq!(task.error, Some(error));
    assert_eq!(
        upload_offset_json("GET /?name=file.txt&size=6 HTTP/1.1", root).unwrap(),
        r#"{"offset":3,"complete":false}"#
    );
    save_upload(
        &head(3, "Content-Range: bytes 3-5/6\r\n"),
        b"def",
        &mut Cursor::new(b""),
        root,
        &tasks,
        "peer",
    )
    .unwrap();
    assert_eq!(
        std::fs::read(fixture.root.join("file.txt")).unwrap(),
        b"abcdef"
    );
}

#[test]
fn cancellation_during_body_read_keeps_partial_bytes_and_releases_file_lock() {
    struct CancellingReader(SharedTasks);
    impl Read for CancellingReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.0.lock().rows.values_mut().next().unwrap().status = "canceled".into();
            buffer[0] = b'x';
            Ok(1)
        }
    }
    let fixture = Fixture::new();
    let tasks = SharedTasks::default();
    let root = fixture.root.to_str().unwrap();
    let error = save_upload(
        &head(6, ""),
        b"abc",
        &mut CancellingReader(tasks.clone()),
        root,
        &tasks,
        "peer",
    )
    .unwrap_err();
    assert_eq!(error.code, "lan:transfer_cancelled");
    let task = tasks.lock().rows.values().next().unwrap().clone();
    assert_eq!((task.status.as_str(), task.transferred), ("canceled", 3));
    assert_eq!(task.error, Some(error));
    assert_eq!(
        std::fs::read(fixture.root.join("file.txt")).unwrap(),
        b"abc"
    );
    save_upload(
        &head(3, "Content-Range: bytes 3-5/6\r\n"),
        b"def",
        &mut Cursor::new(b""),
        root,
        &tasks,
        "peer",
    )
    .unwrap();
}

#[test]
fn offset_queries_distinguish_missing_empty_wrong_size_and_invalid_parents() {
    let fixture = Fixture::new();
    let tasks = SharedTasks::default();
    let root = fixture.root.to_str().unwrap();
    let query = "GET /?name=file.txt&size=0 HTTP/1.1";
    assert_eq!(
        upload_offset_json(query, root).unwrap(),
        r#"{"offset":0,"complete":false}"#
    );
    assert!(!fixture.root.exists());
    save_upload(
        &head(0, ""),
        b"",
        &mut Cursor::new(b""),
        root,
        &tasks,
        "peer",
    )
    .unwrap();
    assert_eq!(
        upload_offset_json(query, root).unwrap(),
        r#"{"offset":0,"complete":true}"#
    );
    std::fs::write(fixture.root.join("file.txt"), b"longer").unwrap();
    assert_eq!(
        upload_offset_json("GET /?name=file.txt&size=3 HTTP/1.1", root).unwrap(),
        r#"{"offset":6,"complete":true}"#
    );
    assert!(upload_offset_json("GET /?name=file.txt%2Fchild&size=3 HTTP/1.1", root).is_err());
    assert!(upload_target_exists("GET /?name=file.txt%2Fchild HTTP/1.1", root).is_err());
}

fn save_upload(
    head: &str,
    initial_body: &[u8],
    stream: &mut impl Read,
    download_dir: &str,
    tasks: &SharedTasks,
    peer_ip: &str,
) -> AppResult<String> {
    // Fault-injected readers do not own a network socket; production always does.
    super::save_upload_inner(
        head,
        initial_body,
        stream,
        download_dir,
        tasks,
        peer_ip,
        None,
    )
}
