use super::super::{workers::Workers, Engine};
use super::*;
use crate::modules::bt::{
    ports::{BtEvent, EventSink, FileAccess},
    repository::{BtRepository, BtTaskRow},
    BtControlAction,
};
use librqbit::{AddTorrent, AddTorrentOptions, CreateTorrentOptions, Session, SessionOptions};
use std::future::Future;
use std::sync::Arc;
use std::task::Poll;
use std::time::Duration;

struct Files;
impl FileAccess for Files {
    fn download_dir(&self) -> AppResult<PathBuf> {
        unreachable!("test specifies destination")
    }
    fn open(&self, _: &Path) -> AppResult<()> {
        Ok(())
    }
}

struct Fixture {
    manager: Arc<BtManager>,
    root: PathBuf,
    hash: String,
    source: PathBuf,
}
impl Fixture {
    async fn new(events: EventSink) -> Self {
        let root =
            std::env::temp_dir().join(format!("bt-export-lifetime-{}", uuid::Uuid::new_v4()));
        let download = root.join("download");
        std::fs::create_dir_all(&download).unwrap();
        let source = download.join("original.txt");
        std::fs::write(&source, b"original data").unwrap();
        let torrent = librqbit::create_torrent(
            &source,
            CreateTorrentOptions::default(),
            &librqbit::spawn_utils::BlockingSpawner::new(1),
        )
        .await
        .unwrap();
        let session = Session::new_with_opts(
            download.clone(),
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
        let handle = session
            .add_torrent(
                AddTorrent::from_bytes(torrent.as_bytes().unwrap()),
                Some(AddTorrentOptions {
                    paused: true,
                    overwrite: true,
                    output_folder: Some(download.to_string_lossy().into_owned()),
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
        let hash = handle.info_hash().as_string();
        let repository = BtRepository::new(crate::storage::Storage::new(root.join("db")).unwrap());
        repository
            .upsert_bt_task(&BtTaskRow {
                info_hash: hash.clone(),
                label: "original".into(),
                dest_dir: String::new(),
                mode: "download".into(),
                pinned: false,
                created_at: 0,
                work_dir: download.to_string_lossy().into_owned(),
                file_indices: vec![0],
                package_mode: "direct".into(),
                status: "completed".into(),
                output_path: Some(source.to_string_lossy().into_owned()),
                export_path: None,
                total_bytes: Some(13),
                error: None,
            })
            .unwrap();
        let manager = Arc::new(BtManager::new(
            repository,
            root.join("bt"),
            events,
            Arc::new(Files),
        ));
        let (pump, worker) = Workers::new();
        drop(worker);
        *manager.engine.lock().await = Some(Engine {
            session,
            pump,
            stream_server: None,
            stopping: false,
        });
        Self {
            manager,
            root,
            hash,
            source,
        }
    }

    async fn finish(self) {
        self.manager.shutdown().await;
        drop(self.manager);
        std::fs::remove_dir_all(self.root).unwrap();
    }
}

async fn assert_pending(future: impl Future) {
    let mut future = Box::pin(future);
    std::future::poll_fn(|cx| {
        assert!(future.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_export_awaiter_keeps_remove_and_reset_blocked_until_notification_finishes() {
    let (started, ready) = tokio::sync::oneshot::channel();
    let started = parking_lot::Mutex::new(Some(started));
    let (release, released) = std::sync::mpsc::channel();
    let released = parking_lot::Mutex::new(released);
    let fixture = Fixture::new(Arc::new(move |event| {
        if matches!(
            event,
            BtEvent::Task(super::super::BtTaskEvent::ExportCompleted { .. })
        ) {
            started.lock().take().unwrap().send(()).unwrap();
            released.lock().recv().unwrap();
        }
    }))
    .await;
    let manager = fixture.manager.clone();
    let hash = fixture.hash.to_uppercase();
    let destination = fixture.root.join("exported");
    let target_dir = destination.to_string_lossy().into_owned();
    let task = tokio::spawn(async move { manager.export_task(&hash, target_dir).await });
    tokio::time::timeout(Duration::from_secs(3), ready)
        .await
        .unwrap()
        .unwrap();
    task.abort();
    assert!(tokio::time::timeout(Duration::from_secs(1), task)
        .await
        .unwrap()
        .unwrap_err()
        .is_cancelled());
    assert_pending(
        fixture
            .manager
            .control(&fixture.hash, BtControlAction::Remove, true),
    )
    .await;
    assert_pending(fixture.manager.maintenance()).await;
    release.send(()).unwrap();
    let maintenance = tokio::time::timeout(Duration::from_secs(2), fixture.manager.maintenance())
        .await
        .unwrap()
        .unwrap();
    let row = fixture
        .manager
        .repository
        .get_bt_task(&fixture.hash)
        .unwrap()
        .unwrap();
    assert_eq!(
        std::fs::read(row.export_path.unwrap()).unwrap(),
        b"original data"
    );
    assert_eq!(std::fs::read(&fixture.source).unwrap(), b"original data");
    assert_eq!(std::fs::read_dir(destination).unwrap().count(), 1);
    drop(maintenance);
    fixture.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn destination_failure_preserves_the_engine_task_and_releases_admission_for_retry() {
    let fixture = Fixture::new(Arc::new(|_| {})).await;
    let error = fixture
        .manager
        .export_task(&fixture.hash, fixture.source.to_string_lossy().into_owned())
        .await
        .unwrap_err();
    assert_eq!(error.kind, crate::error::AppErrorKind::External);
    let session = fixture.manager.engine_running().unwrap();
    let hash = super::super::parse_info_hash(&fixture.hash).unwrap();
    assert!(super::super::find_handle(&session, &hash)
        .unwrap()
        .is_some());
    let row = fixture
        .manager
        .repository
        .get_bt_task(&fixture.hash)
        .unwrap()
        .unwrap();
    assert!(row.export_path.is_none());
    let exported = fixture
        .manager
        .export_task(
            &fixture.hash,
            fixture.root.join("exported").to_string_lossy().into_owned(),
        )
        .await
        .unwrap();
    assert!(exported.exported);
    drop(session);
    fixture.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_busy_stream_permit_does_not_indefinitely_hold_task_admission() {
    let fixture = Fixture::new(Arc::new(|_| {})).await;
    let session = fixture.manager.engine_running().unwrap();
    let hash = super::super::parse_info_hash(&fixture.hash).unwrap();
    let handle = super::super::find_handle(&session, &hash).unwrap().unwrap();
    let preview = handle.clone().stream(0).await.unwrap();
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        fixture.manager.playability(&fixture.hash, 0, true),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(!result.ready);
    let control = tokio::time::timeout(
        Duration::from_secs(1),
        fixture
            .manager
            .control(&fixture.hash, BtControlAction::Pause, false),
    )
    .await
    .unwrap();
    assert!(control.is_err());
    assert!(handle.is_paused());
    drop(preview);
    let ready = fixture
        .manager
        .playability(&fixture.hash, 0, true)
        .await
        .unwrap();
    assert!(ready.ready);
    drop(handle);
    drop(session);
    fixture.finish().await;
}
