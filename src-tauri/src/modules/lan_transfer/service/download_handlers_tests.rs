use super::*;
use crate::modules::lan_transfer::service::tests::Fixture;
use crate::storage::Storage;
use std::io::Read;
use std::net::TcpListener;
use std::thread;
use std::time::Duration;

struct Response {
    text: String,
    tasks: Vec<LanTransferTask>,
    results: Vec<String>,
}

fn response(
    data: &[u8],
    method: &str,
    headers: &str,
    mode: &str,
    permission: &str,
    busy: bool,
) -> Response {
    let fixture = Fixture::new();
    std::fs::create_dir_all(&fixture.root).unwrap();
    std::fs::write(fixture.root.join("sample.txt"), data).unwrap();
    let storage = Storage::new(fixture.root.join("db")).unwrap();
    let shares = vec![LanSharedDir {
        id: "share".into(),
        name: "test".into(),
        path: fixture.root.to_string_lossy().into(),
        created_at: 0,
    }];
    let request =
        format!("{method} /download?share=share&path=sample.txt HTTP/1.1\r\n{headers}\r\n");
    let tokens = Arc::new(Mutex::new(HashMap::new()));
    let devices = Arc::new(Mutex::new(HashMap::new()));
    let tasks = Arc::default();
    let active = Arc::new(Mutex::new(usize::from(busy)));
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let (mut server, _) = listener.accept().unwrap();
    let mut text = String::new();
    thread::scope(|scope| {
        scope.spawn(|| {
            let ctx = DownloadContext {
                request: &request,
                first_line: request.lines().next().unwrap(),
                peer_ip: "192.168.1.2",
                shares: &shares,
                security_mode: mode,
                default_permission: permission,
                trusted_ips: &[],
                authorized_tokens: &tokens,
                devices: &devices,
                tasks: &tasks,
                active_transfers: &active,
                max_concurrent_transfers: 1,
                db_path: storage.db_path(),
            };
            if method == "HEAD" {
                handle_download_head(&mut server, ctx);
            } else {
                handle_download(&mut server, ctx);
            }
            drop(server);
        });
        client.read_to_string(&mut text).unwrap();
    });
    assert_eq!(*active.lock(), usize::from(busy));
    let tasks = tasks.lock().rows.values().cloned().collect();
    let results = storage
        .list_activity_logs(10, Some("lan"), None)
        .unwrap()
        .into_iter()
        .map(|log| log.result)
        .collect();
    Response {
        text,
        tasks,
        results,
    }
}

#[test]
fn get_serves_exact_suffix_open_and_full_ranges() {
    for (header, status, range, body) in [
        ("", "200", "", "0123456789"),
        ("Range: bytes=2-4\r\n", "206", "bytes 2-4/10", "234"),
        ("Range: bytes=-3\r\n", "206", "bytes 7-9/10", "789"),
        ("range: bytes=8-\r\n", "206", "bytes 8-9/10", "89"),
        ("Range: bytes=0-99\r\n", "206", "bytes 0-9/10", "0123456789"),
    ] {
        let response = response(b"0123456789", "GET", header, "open", "readWrite", false);
        assert!(
            response.text.starts_with(&format!("HTTP/1.1 {status}")),
            "{}",
            response.text
        );
        assert!(response.text.ends_with(&format!("\r\n\r\n{body}")));
        assert!(response
            .text
            .contains(&format!("Content-Length: {}\r\n", body.len())));
        if !range.is_empty() {
            assert!(response
                .text
                .contains(&format!("Content-Range: {range}\r\n")));
        }
        assert_eq!(response.tasks.len(), 1);
        assert_eq!(response.tasks[0].status, "success");
        assert_eq!(response.tasks[0].transferred, body.len() as u64);
        assert_eq!(response.tasks[0].total, body.len() as u64);
        assert_eq!(response.results, ["success", "success"]);
    }
}

#[test]
fn invalid_ranges_return_416_without_starting_a_transfer() {
    for range in [
        "bytes=10-",
        "bytes=-0",
        "bytes=5-2",
        "bytes=bad",
        "bytes=0-1,3-4",
        "bytes=0-1\r\nRange: bytes=2-3",
    ] {
        let response = response(
            b"0123456789",
            "GET",
            &format!("Range: {range}\r\n"),
            "open",
            "readWrite",
            false,
        );
        assert!(response.text.starts_with("HTTP/1.1 416"), "{range}");
        assert!(response.text.contains("Content-Range: bytes */10\r\n"));
        assert!(response.text.ends_with("Content-Length: 0\r\nConnection: close\r\nContent-Range: bytes */10\r\nAccept-Ranges: bytes\r\n\r\n"));
        assert!(response.tasks.is_empty());
        assert!(response.results.is_empty());
    }
}

#[test]
fn empty_files_and_head_keep_their_metadata_semantics() {
    let empty = response(b"", "GET", "", "open", "readWrite", false);
    assert!(empty.text.starts_with("HTTP/1.1 200"));
    assert!(empty.text.contains("Content-Length: 0\r\n"));
    assert_eq!(empty.tasks[0].status, "success");
    let ranged = response(
        b"",
        "GET",
        "Range: bytes=0-\r\n",
        "open",
        "readWrite",
        false,
    );
    assert!(ranged.text.starts_with("HTTP/1.1 416"));
    assert!(ranged.text.contains("Content-Range: bytes */0\r\n"));
    // HEAD remains metadata-only and ignores Range in this adapter.
    let head = response(
        b"metadata",
        "HEAD",
        "Range: bytes=999-\r\n",
        "open",
        "readWrite",
        false,
    );
    assert!(head.text.starts_with("HTTP/1.1 200"));
    assert!(head.text.contains("Content-Length: 8\r\n"));
    assert!(head.text.ends_with("\r\n\r\n"));
    assert!(head.tasks.is_empty());
}

#[test]
fn authorization_permission_and_concurrency_still_precede_transfer() {
    for (mode, permission, busy, status) in [
        ("confirm", "readWrite", false, "403"),
        ("open", "uploadOnly", false, "403"),
        ("open", "readWrite", true, "429"),
    ] {
        let response = response(
            b"secret",
            "GET",
            "Range: bytes=999-\r\n",
            mode,
            permission,
            busy,
        );
        assert!(
            response.text.starts_with(&format!("HTTP/1.1 {status}")),
            "{}",
            response.text
        );
        assert!(!response.text.contains("Content-Range:"));
        assert!(response.tasks.is_empty());
        assert_eq!(response.results, ["denied"]);
    }
}
