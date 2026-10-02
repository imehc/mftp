use super::*;
use crate::modules::lan_transfer::service::tests::Fixture;
use crate::storage::Storage;
use std::io::{Read, Write};
use std::net::Shutdown;

struct Harness {
    context: ServerContext,
    storage: Storage,
    fixture: Fixture,
}

struct CloseOnDrop(TcpStream);

impl Drop for CloseOnDrop {
    fn drop(&mut self) {
        // Scoped threads are joined after this guard, including assertion failures.
        let _ = self.0.shutdown(Shutdown::Both);
    }
}

impl Harness {
    fn new() -> Self {
        let fixture = Fixture::new();
        let storage = Storage::new(fixture.root.join("db")).unwrap();
        let context = ServerContext {
            device_name: "test".into(),
            download_dir: fixture.root.join("uploads").to_string_lossy().into(),
            shares: vec![],
            security_mode: "open".into(),
            default_permission: "readWrite".into(),
            max_concurrent_transfers: 2,
            trusted_ips: vec![],
            confirmation_code: None,
            authorized_tokens: Arc::new(Mutex::new(HashMap::new())),
            blocked_sessions: Arc::new(Mutex::new(HashSet::new())),
            pending_auth: Arc::new(Mutex::new(HashMap::new())),
            devices: Arc::new(Mutex::new(HashMap::new())),
            tasks: Arc::default(),
            active_transfers: Arc::new(Mutex::new(0)),
            auth_attempts: Arc::new(Mutex::new(HashMap::new())),
            db_path: storage.db_path().into(),
        };
        Self {
            context,
            storage,
            fixture,
        }
    }

    fn exchange(&self, parts: &[&[u8]]) -> String {
        let active_before = *self.context.active_transfers.lock();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (server, _) = listener.accept().unwrap();
        let mut output = String::new();
        thread::scope(|scope| {
            let _close = CloseOnDrop(client.try_clone().unwrap());
            scope.spawn(|| handle_connection(server, "127.0.0.1".into(), &self.context));
            for (index, part) in parts.iter().enumerate() {
                client.write_all(part).unwrap();
                if index + 1 < parts.len() {
                    client
                        .set_read_timeout(Some(Duration::from_millis(30)))
                        .unwrap();
                    let error = client.read(&mut [0]).unwrap_err();
                    assert!(matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ));
                }
            }
            client.shutdown(Shutdown::Write).unwrap();
            client
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            client.read_to_string(&mut output).unwrap();
        });
        assert_eq!(*self.context.active_transfers.lock(), active_before);
        output
    }
}

#[test]
fn split_headers_and_body_complete_before_upload_response() {
    let harness = Harness::new();
    let response = harness.exchange(&[
        b"POST /api/upload?name=file&conflict=resume HTTP/1.1\r\nContent-Len",
        b"gth: 6\r\nContent-Range: bytes 0-5/6\r\n\r\nab",
        b"cdef",
    ]);
    assert!(response.starts_with("HTTP/1.1 200"));
    assert_eq!(
        std::fs::read(harness.fixture.root.join("uploads/file")).unwrap(),
        b"abcdef"
    );
    assert!(harness
        .context
        .tasks
        .lock()
        .rows
        .values()
        .all(|task| task.status == "success" && task.transferred == 6));
}

#[test]
fn full_cookie_headers_authorize_without_accepting_body_cookie_spoofing() {
    let mut harness = Harness::new();
    harness.context.security_mode = "confirm".into();
    harness.context.authorized_tokens.lock().insert(
        "test-token".into(),
        AuthorizedSession {
            last_seen: std::time::Instant::now(),
            permission: "uploadOnly".into(),
        },
    );
    let response = harness.exchange(&[
        b"POST /api/upload?name=file HTTP/1.1\r\nContent-Length: 1\r\n\r\nx\r\nCookie: mftp_token=test-token\r\n",
    ]);
    assert!(response.starts_with("HTTP/1.1 403"));
    assert!(harness.context.tasks.lock().rows.is_empty());
    assert!(!harness.fixture.root.join("uploads/file").exists());
    let response = harness.exchange(&[
        b"POST /api/upload?name=file HTTP/1.1\r\nContent-Length: 1\r\nCook",
        b"ie: mftp_token=test-token\r\n\r\nx",
    ]);
    assert!(response.starts_with("HTTP/1.1 200"));
    assert_eq!(
        std::fs::read(harness.fixture.root.join("uploads/file")).unwrap(),
        b"x"
    );
}

#[test]
fn ambiguous_framing_and_short_bodies_have_one_error_response() {
    let harness = Harness::new();
    for request in [
        "POST /api/upload?name=file HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nx",
        "POST /api/upload?name=file HTTP/1.1\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\nx",
        "POST /api/upload?name=file HTTP/1.1\r\nContent-Length: 1\r\nExpect: 100-continue\r\n\r\n",
        "POST /api/upload?name=file HTTP/1.1\r\nContent-Length: 1\r\n\r\nextra",
    ] {
        let response = harness.exchange(&[request.as_bytes()]);
        assert!(response.starts_with("HTTP/1.1 400"));
        assert_eq!(response.matches("HTTP/1.1").count(), 1);
        assert!(harness.context.tasks.lock().rows.is_empty());
        assert!(!harness.fixture.root.join("uploads/file").exists());
    }
    let response =
        harness.exchange(&[b"POST /api/upload?name=file HTTP/1.1\r\nContent-Length: 6\r\n\r\nabc"]);
    assert!(response.starts_with("HTTP/1.1 400"));
    assert_eq!(response.matches("HTTP/1.1").count(), 1);
    assert_eq!(
        std::fs::read(harness.fixture.root.join("uploads/file")).unwrap(),
        b"abc"
    );
    assert!(harness
        .context
        .tasks
        .lock()
        .rows
        .values()
        .all(|task| task.status == "failed"));
    let logs = harness
        .storage
        .list_activity_logs(20, Some("lan"), None)
        .unwrap();
    assert!(logs.iter().all(|log| log.result == "failed"));
}

#[test]
fn metadata_errors_are_not_successful_empty_queries() {
    let harness = Harness::new();
    std::fs::create_dir_all(&harness.context.download_dir).unwrap();
    std::fs::write(harness.fixture.root.join("uploads/parent"), b"keep").unwrap();
    for endpoint in ["upload-exists", "upload-offset"] {
        let response = harness.exchange(&[format!(
            "GET /api/{endpoint}?name=parent%2Fchild&size=3 HTTP/1.1\r\n\r\n"
        )
        .as_bytes()]);
        assert!(response.starts_with("HTTP/1.1 400"));
    }
}

#[test]
fn segmented_range_is_applied_before_download_starts() {
    let mut harness = Harness::new();
    std::fs::write(harness.fixture.root.join("sample"), b"0123456789").unwrap();
    harness.context.shares.push(LanSharedDir {
        id: "share".into(),
        name: "test".into(),
        path: harness.fixture.root.to_string_lossy().into(),
        created_at: 0,
    });
    let response = harness.exchange(&[
        b"GET /download?share=share&path=sample HTTP/1.1\r\nRan",
        b"ge: bytes=-3\r\n\r\n",
    ]);
    assert!(response.starts_with("HTTP/1.1 206"));
    assert!(response.contains("Content-Range: bytes 7-9/10\r\n"));
    assert!(response.ends_with("\r\n\r\n789"));
}

#[test]
fn cancelling_a_backpressured_download_finishes_its_worker_without_stopping_other_clients() {
    let mut harness = Harness::new();
    let file = std::fs::File::create(harness.fixture.root.join("large")).unwrap();
    // A sparse file exceeds TCP buffering without allocating a large fixture in memory.
    let total = 256 * 1024 * 1024;
    file.set_len(total).unwrap();
    drop(file);
    harness.context.shares.push(LanSharedDir {
        id: "share".into(),
        name: "test".into(),
        path: harness.fixture.root.to_string_lossy().into(),
        created_at: 0,
    });
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (server, _) = listener.accept().unwrap();
    let (done, finished) = std::sync::mpsc::channel();
    thread::scope(|scope| {
        let _close = CloseOnDrop(client.try_clone().unwrap());
        scope.spawn(|| {
            handle_connection(server, "127.0.0.1".into(), &harness.context);
            done.send(()).unwrap();
        });
        client
            .write_all(b"GET /download?share=share&path=large HTTP/1.1\r\n\r\n")
            .unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        let id = loop {
            let task = harness
                .context
                .tasks
                .lock()
                .rows
                .values()
                .find(|task| task.direction == "download" && task.transferred > 0)
                .cloned();
            if let Some(task) = task {
                break task.id;
            }
            if std::time::Instant::now() >= deadline {
                let _ = client.shutdown(Shutdown::Both);
                panic!("download did not start");
            }
            thread::sleep(Duration::from_millis(5));
        };
        // The peer intentionally never drains the response. Allow the socket's
        // send window to fill, then prove another connection can still complete.
        assert!(finished.recv_timeout(Duration::from_millis(100)).is_err());
        let other = harness
            .exchange(&[b"POST /api/upload?name=other HTTP/1.1\r\nContent-Length: 1\r\n\r\nx"]);
        assert!(other.starts_with("HTTP/1.1 200"));
        super::super::tasks::cancel_task(&harness.context.tasks, &id);
        let completion = finished.recv_timeout(Duration::from_secs(2));
        if completion.is_err() {
            let _ = client.shutdown(Shutdown::Both);
        }
        completion.unwrap();
        let task = harness.context.tasks.lock().rows[&id].clone();
        assert_eq!(task.status, "canceled");
        assert_eq!(
            task.error,
            Some(crate::error::AppError::custom(
                crate::error::CustomErrorCode::LanTransferCancelled
            ))
        );
        assert!(task.transferred > 0 && task.transferred < total);
    });
    assert_eq!(*harness.context.active_transfers.lock(), 0);
    let logs = harness
        .storage
        .list_activity_logs(20, Some("lan"), None)
        .unwrap();
    let downloads: Vec<_> = logs
        .iter()
        .filter(|log| log.request_type == "download")
        .collect();
    assert!(!downloads.is_empty());
    assert!(downloads.iter().all(|log| log.result == "canceled"));
    assert_eq!(
        std::fs::read(harness.fixture.root.join("uploads/other")).unwrap(),
        b"x"
    );
}

#[test]
fn upload_conflicts_return_409_without_rewriting_the_existing_file() {
    let harness = Harness::new();
    std::fs::create_dir_all(&harness.context.download_dir).unwrap();
    let path = harness.fixture.root.join("uploads/file");
    std::fs::write(&path, b"original").unwrap();
    let response = harness.exchange(&[
        b"POST /api/upload?name=file&conflict=resume HTTP/1.1\r\nContent-Length: 1\r\n\r\nx",
    ]);
    assert!(response.starts_with("HTTP/1.1 409"));
    assert!(harness.context.tasks.lock().rows.is_empty());
    assert_eq!(std::fs::read(&path).unwrap(), b"original");

    let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    fs2::FileExt::try_lock_exclusive(&file).unwrap();
    let response = harness.exchange(&[
        b"POST /api/upload?name=file&conflict=overwrite HTTP/1.1\r\nContent-Length: 1\r\n\r\nx",
    ]);
    assert!(response.starts_with("HTTP/1.1 409"));
    assert!(harness.context.tasks.lock().rows.is_empty());
    assert_eq!(std::fs::read(path).unwrap(), b"original");
}

#[test]
fn browse_and_download_pre_errors_use_mapped_status_not_ok_200() {
    let mut harness = Harness::new();
    std::fs::create_dir_all(harness.fixture.root.join("share")).unwrap();
    std::fs::write(harness.fixture.root.join("share/file.txt"), b"content").unwrap();
    harness.context.shares.push(LanSharedDir {
        id: "share".into(),
        name: "share".into(),
        path: harness.fixture.root.join("share").to_string_lossy().into(),
        created_at: 0,
    });

    // Unknown share is a 400 JSON error, not a 200 with an inline message.
    let response = harness.exchange(&[b"GET /api/browse?share=nope&path= HTTP/1.1\r\n\r\n"]);
    assert!(response.starts_with("HTTP/1.1 400"), "{response}");
    assert!(response.contains("application/json"));
    assert!(response.contains("\"error\""));

    // Traversal past the share root is refused with a mapped status.
    let response =
        harness.exchange(&[b"GET /api/browse?share=share&path=../../etc HTTP/1.1\r\n\r\n"]);
    assert!(response.starts_with("HTTP/1.1 400"), "{response}");

    // Downloading a missing path surfaces the OS not-found as 404, not 200.
    let response = harness.exchange(&[b"GET /download?share=share&path=missing HTTP/1.1\r\n\r\n"]);
    assert!(response.starts_with("HTTP/1.1 404"), "{response}");
    assert!(harness.context.tasks.lock().rows.is_empty());

    // A valid download still succeeds.
    let response = harness.exchange(&[b"GET /download?share=share&path=file.txt HTTP/1.1\r\n\r\n"]);
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert!(response.ends_with("content"));
}
