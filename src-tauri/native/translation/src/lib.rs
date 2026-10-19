//! A synchronous, in-process translation boundary. Call only on a blocking worker.

use std::ffi::{c_char, c_void, CStr, CString};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

#[repr(C)]
pub struct Parameters {
    pub context: u32,
    pub output: u32,
    pub threads: u32,
    pub seed: u32,
    pub top_k: i32,
    pub top_p: f32,
    pub temperature: f32,
    pub repeat_penalty: f32,
    pub legacy_stq: u8,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Failure {
    Cancelled,
    InputLimit,
    OutputLimit,
    Engine(String),
}

unsafe extern "C" {
    fn mftp_translate(
        path: *const c_char,
        prompt: *const c_char,
        parameters: *const Parameters,
        cancel: unsafe extern "C" fn(*mut c_void) -> bool,
        output: unsafe extern "C" fn(*mut c_void, *const c_char, usize) -> bool,
        user: *mut c_void,
        error: *mut c_char,
        capacity: usize,
    ) -> i32;
    fn mftp_translation_release();
}

/// Frees the model kept loaded between calls. Blocks until a running `translate` returns.
pub fn release() {
    // Takes no arguments; native code serializes it with `translate`.
    unsafe { mftp_translation_release() }
}

struct Callbacks<'a, F> {
    cancel: &'a AtomicBool,
    output: F,
    panicked: bool,
}

unsafe extern "C" fn cancelled<F>(data: *mut c_void) -> bool {
    // C++ uses the borrowed callback state synchronously and never retains it.
    let callbacks = unsafe { &*(data.cast::<Callbacks<'_, F>>()) };
    callbacks.cancel.load(Ordering::Acquire) || callbacks.panicked
}

unsafe extern "C" fn emit<F: FnMut(&[u8]) -> bool>(
    data: *mut c_void,
    bytes: *const c_char,
    length: usize,
) -> bool {
    let callbacks = unsafe { &mut *(data.cast::<Callbacks<'_, F>>()) };
    let chunk = unsafe { std::slice::from_raw_parts(bytes.cast::<u8>(), length) };
    // A consumer panic must not unwind through the C++ stack and its resources.
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (callbacks.output)(chunk))) {
        Ok(keep_going) => keep_going,
        Err(_) => {
            callbacks.panicked = true;
            false
        }
    }
}

/// The model and context stay loaded for the next call with the same path; call `release`
/// to free them. Per-request state (KV cache, sampler, callbacks) never outlives the call.
/// Output is tokenizer bytes and may split UTF-8 characters across callbacks.
pub fn translate<F: FnMut(&[u8]) -> bool>(
    path: &Path,
    prompt: &str,
    parameters: &Parameters,
    cancel: &AtomicBool,
    output: F,
) -> Result<(), Failure> {
    let path = path
        .to_str()
        .ok_or_else(|| Failure::Engine("Model path is not UTF-8".into()))?;
    let path = CString::new(path).map_err(|_| Failure::Engine("Invalid model path".into()))?;
    let prompt = CString::new(prompt).map_err(|_| Failure::Engine("Input contains NUL".into()))?;
    let mut callbacks = Callbacks {
        cancel,
        output,
        panicked: false,
    };
    let mut error = [0 as c_char; 4096];
    // All pointers and the callback state remain live for this synchronous call.
    // Native code owns its model/context and does not store Rust references.
    let result = unsafe {
        mftp_translate(
            path.as_ptr(),
            prompt.as_ptr(),
            parameters,
            cancelled::<F>,
            emit::<F>,
            (&mut callbacks as *mut Callbacks<'_, F>).cast(),
            error.as_mut_ptr(),
            error.len(),
        )
    };
    if callbacks.panicked {
        return Err(Failure::Engine(
            "Translation output consumer panicked".into(),
        ));
    }
    match result {
        0 => Ok(()),
        1 => Err(Failure::Cancelled),
        2 => Err(Failure::InputLimit),
        3 => Err(Failure::OutputLimit),
        _ => Err(Failure::Engine(
            unsafe { CStr::from_ptr(error.as_ptr()) }
                .to_string_lossy()
                .into_owned(),
        )),
    }
}

#[cfg(test)]
mod tests;
