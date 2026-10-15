//! Synchronous worker context. Never install this across an await or assume
//! inheritance by spawned threads; move a recorder explicitly into each worker.
use super::DiagnosticRecorder;
use crate::error::AppResult;
use std::cell::RefCell;

thread_local! {
    static CURRENT: RefCell<Option<DiagnosticRecorder>> = const { RefCell::new(None) };
}

struct Restore(Option<DiagnosticRecorder>);

impl Drop for Restore {
    fn drop(&mut self) {
        CURRENT.with(|slot| {
            if let Ok(mut slot) = slot.try_borrow_mut() {
                *slot = self.0.take();
            }
        });
    }
}

pub(crate) fn run<T>(
    recorder: Option<DiagnosticRecorder>,
    operation: impl FnOnce() -> AppResult<T>,
) -> AppResult<T> {
    let previous = CURRENT.with(|slot| {
        slot.try_borrow_mut()
            .ok()
            .map(|mut slot| std::mem::replace(&mut *slot, recorder))
    });
    let Some(previous) = previous else {
        return operation();
    };
    let _restore = Restore(previous);
    let result = operation();
    record(|log| log.finish(result.as_ref().err()));
    result
}

pub(crate) fn record<T>(publish: impl FnOnce(&mut DiagnosticRecorder) -> T) -> Option<T> {
    CURRENT.with(|slot| slot.try_borrow_mut().ok()?.as_mut().map(publish))
}

pub(crate) fn event(event: &impl serde::Serialize) {
    record(|log| log.protocol_event(event));
}
