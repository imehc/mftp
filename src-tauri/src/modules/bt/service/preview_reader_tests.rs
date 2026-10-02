use super::super::workers::Workers;
use super::*;
use std::future::Future;
use std::task::Poll;
use std::time::Duration;

#[tokio::test]
async fn original_file_seek_and_read_use_the_requested_range_without_copying() {
    let path = std::env::temp_dir().join(format!("bt-reader-{}", uuid::Uuid::new_v4()));
    std::fs::write(&path, b"0123456789").unwrap();
    let (workers, worker) = Workers::new();
    let (mut reader, total) = Reader::open(path.clone(), &worker).await.unwrap();
    assert_eq!(total, 10);
    reader.seek(3, &worker).await.unwrap();
    let (buffer, count) = reader.read(vec![0; 64], 4, &worker).await.unwrap();
    assert_eq!(&buffer[..count], b"3456");
    drop(reader);
    drop(worker);
    workers.wait().await;
    assert_eq!(std::fs::read(&path).unwrap(), b"0123456789");
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn cancelling_a_pending_file_read_waits_for_the_real_io_worker() {
    let path = std::env::temp_dir().join(format!("bt-reader-stop-{}", uuid::Uuid::new_v4()));
    std::fs::write(&path, b"original").unwrap();
    let file = Arc::new(parking_lot::Mutex::new(std::fs::File::open(&path).unwrap()));
    let weak = Arc::downgrade(&file);
    // Hold the real reader's lock to deterministically suspend its IO worker.
    let locked = file.lock();
    let (workers, worker) = Workers::new();
    let mut reader = Reader::File(file.clone());
    let mut reading = Box::pin(reader.read(vec![0; 64], 64, &worker));
    std::future::poll_fn(|cx| {
        assert!(reading.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    drop(reading);
    drop(reader);
    drop(worker);
    workers.cancel();
    assert!(
        tokio::time::timeout(Duration::from_millis(20), workers.wait())
            .await
            .is_err()
    );
    drop(locked);
    drop(file);
    tokio::time::timeout(Duration::from_secs(2), workers.wait())
        .await
        .unwrap();
    assert!(weak.upgrade().is_none());
    std::fs::remove_file(path).unwrap();
}
