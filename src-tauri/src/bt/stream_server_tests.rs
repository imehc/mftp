use super::{parse_range, resolve_range, split_route};

#[test]
fn parses_ranges_and_routes() {
    assert_eq!(parse_range("bytes=10-20"), Some((10, Some(20))));
    assert_eq!(parse_range("bytes=10-"), Some((10, None)));
    assert_eq!(parse_range("bytes=-20"), Some((u64::MAX, Some(20))));
    assert_eq!(
        split_route(&format!("{}/3", "a".repeat(40))),
        Some(("a".repeat(40), 3))
    );
}

#[test]
fn resolves_ranges_without_crossing_file_end() {
    assert_eq!(resolve_range(100, None), Some((0, 99, 200)));
    assert_eq!(
        resolve_range(100, Some((90, Some(200)))),
        Some((90, 99, 206))
    );
    assert_eq!(resolve_range(100, Some((100, None))), None);
    assert_eq!(
        resolve_range(100, Some((u64::MAX, Some(20)))),
        Some((80, 99, 206))
    );
    assert_eq!(resolve_range(100, Some((50, Some(20)))), None);
}

#[test]
fn parses_case_insensitive_headers_and_rejects_invalid_ranges() {
    let request = super::parse_request(b"HEAD /file HTTP/1.1\r\nrange: bytes=2-4\r\n\r\n").unwrap();
    assert_eq!(request.method, "HEAD");
    assert_eq!(request.range, Some((2, Some(4))));
    for range in ["bytes=0-1,3-4", "bytes=0-bad", "garbage"] {
        let request =
            super::parse_request(format!("GET / HTTP/1.1\r\nRange: {range}\r\n\r\n").as_bytes())
                .unwrap();
        assert!(request.invalid_range);
    }
}

async fn response(method: &str, range: Option<(u64, Option<u64>)>, data: &[u8]) -> Vec<u8> {
    use tokio::io::AsyncReadExt;
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let mut client = tokio::net::TcpStream::connect(listener.local_addr().unwrap())
        .await
        .unwrap();
    let (mut socket, _) = listener.accept().await.unwrap();
    let request = super::Request {
        path: String::new(),
        range,
        invalid_range: false,
        method: method.into(),
    };
    let source = super::Source {
        reader: Box::new(std::io::Cursor::new(data.to_vec())),
        total: data.len() as u64,
        name: "file.txt".into(),
        stalled_after: std::time::Duration::from_secs(1),
    };
    let server = tokio::spawn(async move {
        super::respond_with_range(&mut socket, source, request).await;
    });
    let mut output = Vec::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        client.read_to_end(&mut output),
    )
    .await
    .unwrap()
    .unwrap();
    server.await.unwrap();
    output
}

#[tokio::test]
async fn serves_exact_ranges_head_empty_files_and_no_cache_headers() {
    let output = response("GET", Some((2, Some(4))), b"0123456789").await;
    let text = String::from_utf8(output).unwrap();
    assert!(text.starts_with("HTTP/1.1 206"));
    assert!(text.contains("Content-Range: bytes 2-4/10"));
    assert!(text.contains("Cache-Control: no-store"));
    assert!(text.ends_with("\r\n\r\n234"));
    let head = String::from_utf8(response("HEAD", None, b"content").await).unwrap();
    assert!(head.contains("Content-Length: 7"));
    assert!(head.ends_with("\r\n\r\n"));
    let empty = String::from_utf8(response("GET", None, b"").await).unwrap();
    assert!(empty.starts_with("HTTP/1.1 200"));
    assert!(empty.contains("Content-Length: 0"));
    let invalid = String::from_utf8(response("GET", Some((99, None)), b"test").await).unwrap();
    assert!(invalid.starts_with("HTTP/1.1 416"));
    assert!(invalid.contains("Content-Range: bytes */4"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn paused_preview_reads_verified_pieces_without_resuming_or_copying() {
    use librqbit::{AddTorrent, AddTorrentOptions, CreateTorrentOptions, Session, SessionOptions};
    use std::time::Duration;
    use tokio::io::AsyncReadExt;
    let root = std::env::temp_dir().join(format!("bt-paused-preview-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("clip.txt");
    let mut complete = vec![b'a'; 16384];
    complete.extend(vec![b'b'; 16384]);
    std::fs::write(&path, &complete).unwrap();
    let torrent = librqbit::create_torrent(
        &path,
        CreateTorrentOptions {
            piece_length: Some(16384),
            ..Default::default()
        },
        &librqbit::spawn_utils::BlockingSpawner::new(1),
    )
    .await
    .unwrap();
    let bytes = torrent.as_bytes().unwrap();
    let mut partial = vec![b'a'; 16384];
    partial.extend(vec![0; 16384]);
    std::fs::write(&path, &partial).unwrap();
    let session = Session::new_with_opts(
        root.clone(),
        SessionOptions {
            dht: None,
            disable_trackers: true,
            persistence: None,
            listen: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let handle = session
        .add_torrent(
            AddTorrent::from_bytes(bytes),
            Some(AddTorrentOptions {
                paused: true,
                overwrite: true,
                output_folder: Some(root.to_string_lossy().into_owned()),
                ..Default::default()
            }),
        )
        .await
        .unwrap()
        .into_handle()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), handle.wait_until_initialized())
        .await
        .unwrap()
        .unwrap();
    let mut source = super::torrent_source(handle.clone(), 0).await.unwrap();
    let mut prefix = vec![0; 16384];
    tokio::time::timeout(
        Duration::from_secs(2),
        source.reader.read_exact(&mut prefix),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(prefix, vec![b'a'; 16384]);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), source.reader.read_u8())
            .await
            .is_err()
    );
    assert!(handle.is_paused());
    assert_eq!(std::fs::read(&path).unwrap(), partial);
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
    drop(source);
    session.stop().await;
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn completed_preview_reads_current_original_without_a_torrent_handle() {
    use tokio::io::AsyncReadExt;
    let root = std::env::temp_dir().join(format!("bt-completed-preview-{}", uuid::Uuid::new_v4()));
    let downloads = root.join("downloads");
    std::fs::create_dir_all(&downloads).unwrap();
    let path = downloads.join("original.txt");
    std::fs::write(&path, b"original").unwrap();
    let exported = root.join("exported.txt");
    std::fs::write(&exported, b"stale export").unwrap();
    let storage = crate::storage::Storage::new(root.join("db")).unwrap();
    let hash = "a".repeat(40);
    storage
        .upsert_bt_task(&crate::storage::bt::BtTaskRow {
            info_hash: hash.clone(),
            label: "original".into(),
            dest_dir: String::new(),
            mode: "download".into(),
            pinned: false,
            created_at: 0,
            work_dir: downloads.to_string_lossy().into_owned(),
            file_indices: vec![0],
            package_mode: "direct".into(),
            status: "completed".into(),
            output_path: Some(path.to_string_lossy().into_owned()),
            export_path: Some(exported.to_string_lossy().into_owned()),
            total_bytes: Some(8),
            last_error: None,
        })
        .unwrap();
    let session = librqbit::Session::new_with_opts(
        downloads.clone(),
        librqbit::SessionOptions {
            dht: None,
            disable_trackers: true,
            persistence: None,
            listen: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    for contents in [b"original", b"new data"] {
        std::fs::write(&path, contents).unwrap();
        let mut source = super::file_source(&session, &storage, &hash, "original.txt".into())
            .await
            .unwrap();
        let mut bytes = Vec::new();
        source.reader.read_to_end(&mut bytes).await.unwrap();
        assert_eq!(bytes, contents);
    }
    assert!(
        super::file_source(&session, &storage, &hash, "../exported.txt".into())
            .await
            .is_err()
    );
    storage.delete_bt_task(&hash).unwrap();
    assert!(
        super::file_source(&session, &storage, &hash, "original.txt".into())
            .await
            .is_err()
    );
    session.stop().await;
    drop(storage);
    std::fs::remove_dir_all(root).unwrap();
}
