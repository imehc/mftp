use super::tasks::SharedTasks;
use super::LanTransferManager;
use crate::core::operations::Operations;
use crate::modules::lan_transfer::{LanSharedDir, LanTransferSettings, LanTransferTask};
use crate::storage::Storage;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::{Duration, Instant};

pub(super) struct Fixture {
    pub(super) manager: Arc<LanTransferManager>,
    pub(super) operations: Arc<Operations>,
    pub(super) root: PathBuf,
}

impl Fixture {
    pub(super) fn new() -> Self {
        let root = std::env::temp_dir().join(format!("mftp-lan-{}", uuid::Uuid::new_v4()));
        let operations = Arc::new(Operations::default());
        Self {
            manager: Arc::new(LanTransferManager::new(operations.clone())),
            operations,
            root,
        }
    }

    pub(super) fn settings(&self) -> LanTransferSettings {
        LanTransferSettings {
            device_name: "MFTP lifecycle test".into(),
            port: 0,
            bind_host: String::new(),
            download_dir: self.root.join("downloads").to_string_lossy().into(),
            auto_start: false,
            security_mode: "open".into(),
            default_permission: "readWrite".into(),
            max_concurrent_transfers: 1,
        }
    }

    fn start(&self) -> u16 {
        self.manager
            .start(self.settings(), vec![], vec![], self.root.join("test.db"))
            .unwrap()
            .port
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.manager.stop();
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn concurrent_starts_share_one_runtime_and_stop_allows_restart() {
    let fixture = Fixture::new();
    let barrier = Arc::new(Barrier::new(6));
    let mut starts = Vec::new();
    for _ in 0..6 {
        let manager = fixture.manager.clone();
        let barrier = barrier.clone();
        let settings = fixture.settings();
        let db = fixture.root.join("test.db");
        starts.push(thread::spawn(move || {
            barrier.wait();
            manager
                .start(settings, vec![], vec![], db)
                .unwrap()
                .port
                .unwrap()
        }));
    }
    let ports: Vec<_> = starts
        .into_iter()
        .map(|start| start.join().unwrap())
        .collect();
    assert!(ports.iter().all(|port| *port == ports[0]));
    fixture.manager.stop();
    fixture.manager.stop();
    assert!(!fixture.manager.status().running);
    assert!(TcpStream::connect(("127.0.0.1", ports[0])).is_err());
    let port = fixture.start();
    let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    client
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .unwrap();
    let mut response = String::new();
    client.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 200 OK"));
}

#[test]
fn maintenance_waits_for_server_and_rejects_restart_until_released() {
    let fixture = Fixture::new();
    fixture.start();
    tauri::async_runtime::block_on(async {
        let mut pending = Box::pin(fixture.operations.maintenance(Duration::from_secs(2)));
        assert!(futures_util::poll!(&mut pending).is_pending());
        assert_eq!(
            fixture
                .manager
                .start(
                    fixture.settings(),
                    vec![],
                    vec![],
                    fixture.root.join("test.db")
                )
                .unwrap_err()
                .code,
            "app:maintenance_in_progress"
        );
        fixture.manager.stop();
        let maintenance = pending.await.unwrap();
        assert!(!fixture.manager.status().running);
        assert_eq!(
            fixture
                .manager
                .start(
                    fixture.settings(),
                    vec![],
                    vec![],
                    fixture.root.join("test.db")
                )
                .unwrap_err()
                .code,
            "app:maintenance_in_progress"
        );
        drop(maintenance);
    });
    fixture.start();
}

#[test]
fn failed_start_releases_admission_and_shutdown_permanently_rejects_starts() {
    let fixture = Fixture::new();
    std::fs::create_dir_all(&fixture.root).unwrap();
    let file = fixture.root.join("not-a-directory");
    std::fs::write(&file, b"original").unwrap();
    let mut settings = fixture.settings();
    settings.download_dir = file.to_string_lossy().into();
    assert!(fixture
        .manager
        .start(settings, vec![], vec![], fixture.root.join("test.db"))
        .is_err());
    assert!(fixture.operations.wait_idle(Duration::from_millis(50)));
    assert!(!fixture.manager.status().running);
    fixture.start();
    fixture.manager.shutdown();
    assert_eq!(
        fixture
            .manager
            .start(
                fixture.settings(),
                vec![],
                vec![],
                fixture.root.join("test.db")
            )
            .unwrap_err()
            .code,
        "app:shutting_down"
    );
    assert!(fixture.operations.wait_idle(Duration::from_millis(50)));
    assert_eq!(std::fs::read(file).unwrap(), b"original");
}

#[test]
fn stopping_incomplete_upload_closes_connection_and_finishes_database_logging() {
    let fixture = Fixture::new();
    let storage = Storage::new(fixture.root.clone()).unwrap();
    let status = fixture
        .manager
        .start(fixture.settings(), vec![], vec![], storage.db_path().into())
        .unwrap();
    let mut client = TcpStream::connect(("127.0.0.1", status.port.unwrap())).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    client.write_all(b"POST /api/upload?name=partial.txt HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\nabc").unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while !fixture
        .manager
        .list_tasks()
        .iter()
        .any(|task| task.transferred == 3)
    {
        assert!(
            Instant::now() < deadline,
            "upload never reached the body read"
        );
        thread::sleep(Duration::from_millis(5));
    }
    fixture.manager.stop();
    let mut response = Vec::new();
    let closed = client.read_to_end(&mut response);
    assert!(closed.is_ok() || closed.unwrap_err().kind() == std::io::ErrorKind::ConnectionReset);
    assert_eq!(
        std::fs::read(fixture.root.join("downloads/partial.txt")).unwrap(),
        b"abc"
    );
    let logs = storage.list_activity_logs(100, Some("lan"), None).unwrap();
    assert!(logs
        .iter()
        .any(|log| log.request_type == "upload" && log.result == "failed"));
    assert!(fixture.operations.wait_idle(Duration::from_millis(50)));
}

pub(super) fn transfer_tasks(total: u64) -> SharedTasks {
    let tasks = SharedTasks::default();
    super::tasks::upsert_task(
        &tasks,
        LanTransferTask {
            id: "task".into(),
            direction: "download".into(),
            file_name: "sample".into(),
            ip: "127.0.0.1".into(),
            status: "running".into(),
            transferred: 0,
            total,
            started_at: 0,
            updated_at: 0,
            error: None,
        },
    );
    tasks
}

#[test]
fn cancelling_an_idle_upload_releases_the_file_and_slot_and_server_can_restart() {
    let fixture = Fixture::new();
    let storage = Storage::new(fixture.root.join("db")).unwrap();
    let status = fixture
        .manager
        .start(fixture.settings(), vec![], vec![], storage.db_path().into())
        .unwrap();
    let port = status.port.unwrap();
    let mut client = TcpStream::connect(("127.0.0.1", port)).unwrap();
    client
        .set_read_timeout(Some(Duration::from_millis(150)))
        .unwrap();
    client
        .write_all(b"POST /api/upload?name=partial.txt&conflict=resume HTTP/1.1\r\nContent-Len")
        .unwrap();
    let pending = client.read(&mut [0]).unwrap_err();
    assert!(matches!(
        pending.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
    ));
    client.write_all(b"gth: 100\r\n\r\nabc").unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    let id = loop {
        if let Some(task) = fixture
            .manager
            .list_tasks()
            .into_iter()
            .find(|task| task.transferred == 3 && task.status == "running")
        {
            break task.id;
        }
        assert!(Instant::now() < deadline, "upload did not start");
        thread::sleep(Duration::from_millis(5));
    };
    let pending = client.read(&mut [0]).unwrap_err();
    assert!(matches!(
        pending.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
    ));
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    // Leave the sending peer open and silent: cancellation itself must wake read.
    fixture.manager.cancel_task(&id);
    // The worker may observe cancellation and buffer an error response before
    // shutdown reaches the socket; it must still close without more peer data.
    let mut canceled_response = Vec::new();
    if let Err(error) = client.read_to_end(&mut canceled_response) {
        assert_eq!(error.kind(), std::io::ErrorKind::ConnectionReset);
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let logs = storage.list_activity_logs(20, Some("lan"), None).unwrap();
        if logs
            .iter()
            .filter(|log| log.request_type == "upload" && log.result == "canceled")
            .count()
            == 2
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "cancelled worker did not finish logging: {logs:?}"
        );
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(fixture.manager.list_tasks()[0].status, "canceled");
    assert_eq!(
        fixture.manager.list_tasks()[0].error,
        Some(crate::error::AppError::custom(
            crate::error::CustomErrorCode::LanTransferCancelled
        ))
    );
    assert!(fixture.manager.status().running);
    let mut resumed = TcpStream::connect(("127.0.0.1", port)).unwrap();
    resumed
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    resumed.write_all(b"POST /api/upload?name=partial.txt&conflict=resume HTTP/1.1\r\nContent-Length: 3\r\nContent-Range: bytes 3-5/6\r\n\r\ndef").unwrap();
    let mut response = String::new();
    resumed.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert_eq!(
        std::fs::read(fixture.root.join("downloads/partial.txt")).unwrap(),
        b"abcdef"
    );
    fixture.manager.stop();
    assert!(fixture.operations.wait_idle(Duration::from_millis(50)));
    let new_port = fixture.start();
    assert!(fixture.manager.list_tasks().is_empty());
    fixture.manager.cancel_task(&id);
    let mut fresh = TcpStream::connect(("127.0.0.1", new_port)).unwrap();
    fresh
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    fresh.write_all(b"GET / HTTP/1.1\r\n\r\n").unwrap();
    let mut response = String::new();
    fresh.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 200"));
}

#[test]
fn start_validation_reports_stable_codes() {
    let fixture = Fixture::new();
    assert_eq!(
        super::selected_bind_host("not-an-ip").unwrap_err().code,
        "lan:ip_invalid"
    );
    assert_eq!(
        super::selected_bind_host("8.8.8.8").unwrap_err().code,
        "lan:bind_ip_not_lan"
    );
    assert!(super::selected_bind_host("").unwrap().is_none());
    let shares = vec![LanSharedDir {
        id: "s".into(),
        name: "gone".into(),
        path: fixture.root.join("missing-share").to_string_lossy().into(),
        created_at: 0,
    }];
    let error = fixture
        .manager
        .start(
            fixture.settings(),
            shares,
            vec![],
            fixture.root.join("test.db"),
        )
        .unwrap_err();
    assert_eq!(error.code, "lan:shared_dir_unavailable");
    assert_eq!(error.args.get("name").map(String::as_str), Some("gone"));
    assert!(!fixture.manager.status().running);
    assert!(fixture.operations.wait_idle(Duration::from_millis(50)));
}
