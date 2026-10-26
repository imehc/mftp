mod delta;
mod migration;
mod model;
mod reader;
mod writer;

pub(crate) use model::*;
pub(crate) use writer::LogService;

use parking_lot::Mutex;
use std::sync::{Arc, Weak};

static RUNTIME: Mutex<Option<Weak<LogService>>> = Mutex::new(None);

pub(crate) fn install_runtime(service: &Arc<LogService>) {
    *RUNTIME.lock() = Some(Arc::downgrade(service));
}

pub(crate) fn runtime(module: &str, message: String) {
    runtime_event(module, "runtime", "failed", message, None);
}

pub(crate) fn runtime_event(
    module: &str,
    action: &str,
    result: &str,
    message: String,
    operation_id: Option<String>,
) {
    let service = RUNTIME.lock().as_ref().and_then(Weak::upgrade);
    let safe = super::diagnostics::Redactor::default().text(&message).0;
    if let Some(service) = service {
        service.runtime_event(module, action, result, safe, operation_id);
    } else {
        eprintln!("{safe}");
    }
}

#[cfg(not(test))]
pub(crate) fn global() -> Option<Arc<LogService>> {
    RUNTIME.lock().as_ref().and_then(Weak::upgrade)
}

#[macro_export]
macro_rules! runtime_log {
    ($($argument:tt)*) => {
        $crate::core::logging::runtime(module_path!(), format!($($argument)*))
    };
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
