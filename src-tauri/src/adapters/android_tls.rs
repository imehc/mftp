//! Initialize Android's system trust manager before Tauri starts any services.

use jni::{errors::ThrowRuntimeExAndDefault, objects::JClass, objects::JObject, EnvUnowned};

#[no_mangle]
pub extern "system" fn Java_com_imehc_mftp_NativeTls_initialize<'caller>(
    mut env: EnvUnowned<'caller>,
    _class: JClass<'caller>,
    context: JObject<'caller>,
) {
    // The verifier retains the application context and class loader, never an
    // Activity. JNI errors must not unwind across the foreign-call boundary.
    env.with_env(|env| rustls_platform_verifier::android::init_with_env(env, context))
        .resolve::<ThrowRuntimeExAndDefault>();
}
