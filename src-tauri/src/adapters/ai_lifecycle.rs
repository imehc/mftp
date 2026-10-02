//! Synchronous Activity lifecycle bridge. ProcessLifecycleOwner debounces
//! pauses, so Tauri's process events cannot enforce immediate cache invalidation.

use jni::{
    objects::JClass,
    sys::{jboolean, JNI_TRUE},
    JNIEnv,
};
use parking_lot::Mutex;
use std::sync::{Arc, Weak};

use super::{android::AndroidKeychain, cache::CachedCredentials};

struct Lifecycle {
    foreground: bool,
    cache: Weak<CachedCredentials<AndroidKeychain>>,
}

static LIFECYCLE: Mutex<Lifecycle> = Mutex::new(Lifecycle {
    foreground: false,
    cache: Weak::new(),
});

pub(super) fn register(cache: &Arc<CachedCredentials<AndroidKeychain>>) {
    let mut lifecycle = LIFECYCLE.lock();
    lifecycle.cache = Arc::downgrade(cache);
    // Keep registration ordered with native callbacks, including an onResume
    // that arrives before Tauri finishes installing application services.
    cache.set_foreground(lifecycle.foreground);
}

#[no_mangle]
pub extern "system" fn Java_com_imehc_mftp_AiCredentialLifecycle_setForeground(
    _env: JNIEnv<'_>,
    _class: JClass<'_>,
    foreground: jboolean,
) {
    let mut lifecycle = LIFECYCLE.lock();
    lifecycle.foreground = foreground == JNI_TRUE;
    if let Some(cache) = lifecycle.cache.upgrade() {
        cache.set_foreground(lifecycle.foreground);
    }
}
