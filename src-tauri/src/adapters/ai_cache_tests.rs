use super::*;
use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
};
use tokio::sync::Notify;

#[derive(Default)]
struct Native {
    values: Mutex<HashMap<String, String>>,
    reads: AtomicUsize,
    writes: AtomicUsize,
    fail: AtomicBool,
    hold: AtomicBool,
    entered: Notify,
    release: Notify,
}

impl Native {
    async fn authenticate(&self) -> AppResult<()> {
        if self.hold.load(Ordering::SeqCst) {
            self.entered.notify_one();
            self.release.notified().await;
        }
        if self.fail.load(Ordering::SeqCst) {
            return Err(AppError::external(
                "credential:store",
                "Native authentication rejected",
            ));
        }
        Ok(())
    }
}

impl AiCredentials for Arc<Native> {
    async fn save(&self, reference: String, value: String) -> AppResult<()> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.authenticate().await?;
        self.values.lock().insert(reference, value);
        Ok(())
    }
    async fn read(&self, reference: String) -> AppResult<Option<String>> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        self.authenticate().await?;
        Ok(self.values.lock().get(&reference).cloned())
    }
    async fn clear(&self, reference: String) -> AppResult<()> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(AppError::external(
                "credential:store",
                "Native removal rejected",
            ));
        }
        self.values.lock().remove(&reference);
        Ok(())
    }
}

fn fixture() -> (Arc<Native>, Arc<CachedCredentials<Arc<Native>>>) {
    let native = Arc::new(Native::default());
    native.values.lock().insert("a".into(), "secret-a".into());
    native.values.lock().insert("b".into(), "secret-b".into());
    let cache = Arc::new(CachedCredentials::new(native.clone()));
    (native, cache)
}

#[tokio::test(start_paused = true)]
async fn absolute_expiry_wipes_without_another_read() {
    let (native, cache) = fixture();
    cache.read("a".into()).await.unwrap();
    tokio::time::advance(REUSE_DURATION - Duration::from_secs(1)).await;
    cache.read("a".into()).await.unwrap();
    assert_eq!(native.reads.load(Ordering::SeqCst), 1);
    tokio::time::advance(Duration::from_secs(1)).await;
    tokio::task::yield_now().await;
    assert!(
        cache.state.lock().entry.is_none(),
        "expiry must wipe idle plaintext"
    );
    cache.read("a".into()).await.unwrap();
    assert_eq!(native.reads.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn reads_enforce_expiry_even_before_timer_is_polled() {
    let (native, cache) = fixture();
    cache.read("a".into()).await.unwrap();
    cache.state.lock().expiry.take().unwrap().abort();
    tokio::time::advance(REUSE_DURATION).await;
    cache.read("a".into()).await.unwrap();
    assert_eq!(native.reads.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn reference_isolation_keeps_only_one_credential() {
    let (native, cache) = fixture();
    for reference in ["a", "b", "a"] {
        let result = cache.read(reference.into()).await.unwrap();
        assert!(result.as_deref() == Some(format!("secret-{reference}").as_str()));
    }
    assert_eq!(native.reads.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn concurrent_reads_share_one_successful_authentication() {
    let (native, cache) = fixture();
    native.hold.store(true, Ordering::SeqCst);
    let first = tokio::spawn({
        let cache = cache.clone();
        async move { cache.read("a".into()).await }
    });
    native.entered.notified().await;
    let second = tokio::spawn({
        let cache = cache.clone();
        async move { cache.read("a".into()).await }
    });
    tokio::task::yield_now().await;
    native.hold.store(false, Ordering::SeqCst);
    native.release.notify_one();
    assert!(first.await.unwrap().unwrap().is_some());
    assert!(second.await.unwrap().unwrap().is_some());
    assert_eq!(native.reads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn background_denies_reads_and_resume_does_not_restore_cache() {
    let (native, cache) = fixture();
    cache.read("a".into()).await.unwrap();
    cache.set_foreground(false);
    assert!(cache.state.lock().entry.is_none());
    assert_eq!(
        cache.read("a".into()).await.unwrap_err().code,
        "ai:authentication_expired"
    );
    assert_eq!(native.reads.load(Ordering::SeqCst), 1);
    cache.set_foreground(true);
    cache.read("a".into()).await.unwrap();
    assert_eq!(native.reads.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn late_authentication_cannot_survive_background_and_resume() {
    let (native, cache) = fixture();
    native.hold.store(true, Ordering::SeqCst);
    let read = tokio::spawn({
        let cache = cache.clone();
        async move { cache.read("a".into()).await }
    });
    native.entered.notified().await;
    cache.set_foreground(false);
    cache.set_foreground(true);
    native.release.notify_one();
    assert_eq!(
        read.await.unwrap().unwrap_err().code,
        "ai:authentication_expired"
    );
    assert!(cache.state.lock().entry.is_none());
}

#[tokio::test]
async fn late_save_cannot_repopulate_after_background() {
    let (native, cache) = fixture();
    native.hold.store(true, Ordering::SeqCst);
    let save = tokio::spawn({
        let cache = cache.clone();
        async move { cache.save("a".into(), "replacement".into()).await }
    });
    native.entered.notified().await;
    cache.set_foreground(false);
    cache.set_foreground(true);
    native.release.notify_one();
    assert_eq!(
        save.await.unwrap().unwrap_err().code,
        "ai:authentication_expired"
    );
    assert!(cache.state.lock().entry.is_none());
}

#[tokio::test]
async fn save_reuses_new_value_but_failed_replacement_retires_old_cache() {
    let (native, cache) = fixture();
    cache.save("a".into(), "replacement".into()).await.unwrap();
    assert!(cache.read("a".into()).await.unwrap().as_deref() == Some("replacement"));
    assert_eq!(native.reads.load(Ordering::SeqCst), 0);
    native.fail.store(true, Ordering::SeqCst);
    assert!(cache
        .save("a".into(), "failed-secret".into())
        .await
        .is_err());
    assert!(cache.state.lock().entry.is_none());
    assert!(cache.read("a".into()).await.is_err());
}

#[tokio::test]
async fn deletion_failure_invalidates_but_retired_reference_cleanup_preserves_replacement() {
    let (native, cache) = fixture();
    cache.save("b".into(), "replacement".into()).await.unwrap();
    cache.clear("a".into()).await.unwrap();
    assert!(cache.read("b".into()).await.unwrap().is_some());
    assert_eq!(native.reads.load(Ordering::SeqCst), 0);
    native.fail.store(true, Ordering::SeqCst);
    assert!(cache.clear("b".into()).await.is_err());
    assert!(cache.state.lock().entry.is_none());
    cache.set_foreground(false);
    native.fail.store(false, Ordering::SeqCst);
    cache.clear("b".into()).await.unwrap();
    assert!(!native.values.lock().contains_key("b"));
}

#[tokio::test]
async fn missing_and_failed_authentication_are_not_cached() {
    let (native, cache) = fixture();
    assert!(cache.read("missing".into()).await.unwrap().is_none());
    native
        .values
        .lock()
        .insert("missing".into(), "new-secret".into());
    native.fail.store(true, Ordering::SeqCst);
    assert!(cache.read("missing".into()).await.is_err());
    assert!(cache.state.lock().entry.is_none());
    native.fail.store(false, Ordering::SeqCst);
    assert!(cache.read("missing".into()).await.unwrap().is_some());
    assert_eq!(native.reads.load(Ordering::SeqCst), 3);
}

#[tokio::test(start_paused = true)]
async fn old_timer_cannot_clear_a_newer_replacement_and_drop_releases_state() {
    let (_, cache) = fixture();
    cache.read("a".into()).await.unwrap();
    tokio::time::advance(Duration::from_secs(100)).await;
    cache.save("b".into(), "replacement".into()).await.unwrap();
    tokio::time::advance(Duration::from_secs(200)).await;
    tokio::task::yield_now().await;
    assert!(cache.state.lock().entry.is_some());
    let weak = Arc::downgrade(&cache.state);
    drop(cache);
    assert!(
        weak.upgrade().is_none(),
        "timer must not retain the secret owner"
    );
}
