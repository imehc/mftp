use super::*;
use crate::modules::bt::repository::BtTaskRow;
use librqbit::{AddTorrent, AddTorrentOptions, CreateTorrentOptions, SessionOptions};
use std::path::PathBuf;

struct Fixture {
    root: PathBuf,
    session: Arc<Session>,
    repository: BtRepository,
}

impl Fixture {
    async fn new() -> Self {
        let root = std::env::temp_dir().join(format!("bt-preview-stop-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let repository = BtRepository::new(crate::storage::Storage::new(root.join("db")).unwrap());
        let session = Session::new_with_opts(
            root.clone(),
            SessionOptions {
                dht: None,
                disable_trackers: true,
                persistence: None,
                listen: None,
                runtime_worker_threads: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        Self {
            root,
            session,
            repository,
        }
    }

    async fn server(&self) -> StreamServer {
        StreamServer::spawn(self.session.clone(), self.repository.clone())
            .await
            .unwrap()
    }

    async fn finish(self) {
        self.session.stop().await;
        drop(self.session);
        drop(self.repository);
        std::fs::remove_dir_all(self.root).unwrap();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn progress_pump_releases_its_captured_resources_before_completion() {
    let fixture = Fixture::new().await;
    let witness = Arc::new(());
    let weak = Arc::downgrade(&witness);
    let events: crate::modules::bt::ports::EventSink = Arc::new(move |_| {
        let _retained = witness.clone();
    });
    let pump = super::super::stats::spawn_progress_pump(
        events,
        fixture.session.clone(),
        fixture.repository.clone(),
    );
    pump.cancel();
    timeout(Duration::from_secs(1), pump.wait()).await.unwrap();
    assert!(weak.upgrade().is_none());
    fixture.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stopping_closes_incomplete_headers_and_listener_and_can_be_repeated() {
    let fixture = Fixture::new().await;
    let mut server = fixture.server().await;
    let mut clients = Vec::new();
    for _ in 0..4 {
        let mut stream = TcpStream::connect(("127.0.0.1", server.port))
            .await
            .unwrap();
        stream.write_all(b"GET /").await.unwrap();
        clients.push(stream);
    }
    timeout(Duration::from_secs(2), server.stop())
        .await
        .unwrap();
    timeout(Duration::from_secs(2), server.stop())
        .await
        .unwrap();
    for mut client in clients {
        let mut byte = [0];
        let result = timeout(Duration::from_secs(1), client.read(&mut byte))
            .await
            .unwrap();
        assert!(matches!(result, Ok(0) | Err(_)));
    }
    assert!(TcpStream::connect(("127.0.0.1", server.port))
        .await
        .is_err());
    fixture.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stopping_a_missing_piece_preview_releases_the_real_stream_permit() {
    let fixture = Fixture::new().await;
    let path = fixture.root.join("clip.bin");
    std::fs::write(&path, vec![1; 32768]).unwrap();
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
    let mut partial = vec![1; 16384];
    partial.extend(vec![0; 16384]);
    std::fs::write(&path, &partial).unwrap();
    let handle = fixture
        .session
        .add_torrent(
            AddTorrent::from_bytes(bytes),
            Some(AddTorrentOptions {
                paused: true,
                overwrite: true,
                output_folder: Some(fixture.root.to_string_lossy().into_owned()),
                ..Default::default()
            }),
        )
        .await
        .unwrap()
        .into_handle()
        .unwrap();
    timeout(Duration::from_secs(5), handle.wait_until_initialized())
        .await
        .unwrap()
        .unwrap();
    let hash = handle.info_hash().as_string();
    fixture
        .repository
        .upsert_bt_task(&BtTaskRow {
            info_hash: hash.clone(),
            label: "clip".into(),
            dest_dir: String::new(),
            mode: "download".into(),
            pinned: false,
            created_at: 0,
            work_dir: fixture.root.to_string_lossy().into_owned(),
            file_indices: vec![0],
            package_mode: "direct".into(),
            status: "active".into(),
            output_path: None,
            export_path: None,
            total_bytes: Some(32768),
            error: None,
        })
        .unwrap();
    let mut server = fixture.server().await;
    let mut client = TcpStream::connect(("127.0.0.1", server.port))
        .await
        .unwrap();
    client
        .write_all(format!("GET /{}/stream/{hash}/0 HTTP/1.1\r\n\r\n", server.token).as_bytes())
        .await
        .unwrap();
    let mut header = Vec::new();
    timeout(Duration::from_secs(1), async {
        while !header.ends_with(b"\r\n\r\n") {
            header.push(client.read_u8().await.unwrap());
        }
        let mut first_piece = vec![0; 16384];
        client.read_exact(&mut first_piece).await.unwrap();
        assert_eq!(first_piece, vec![1; 16384]);
    })
    .await
    .unwrap();
    assert!(timeout(Duration::from_millis(20), handle.clone().stream(0))
        .await
        .is_err());
    timeout(Duration::from_secs(1), server.stop())
        .await
        .unwrap();
    let next_preview = timeout(Duration::from_secs(1), handle.clone().stream(0))
        .await
        .unwrap()
        .unwrap();
    drop(next_preview);
    assert!(handle.is_paused());
    let mut body = Vec::new();
    let _ = timeout(Duration::from_secs(1), client.read_to_end(&mut body))
        .await
        .unwrap();
    assert!(body.is_empty());
    assert_eq!(std::fs::read(&path).unwrap(), partial);
    drop(handle);
    fixture.finish().await;
}
