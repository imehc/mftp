pub(crate) mod context;
mod model;
mod recorder;
mod recorder_protocol;
mod redaction;
pub(crate) use model::*;
pub(crate) use recorder::DiagnosticRecorder;
pub(crate) use redaction::Redactor;

use parking_lot::Mutex;
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicU32, AtomicUsize, Ordering},
        Arc, OnceLock,
    },
};

const OPERATION_LIMIT: usize = 20;
const ACTIVE_LIMIT: usize = 32;

pub(super) struct RecordCell {
    latest: Mutex<DiagnosticOperation>,
    terminal: OnceLock<DiagnosticOperation>,
}

pub(super) struct Scope {
    cursor: AtomicU32,
    records: Mutex<VecDeque<Arc<RecordCell>>>,
    discarded: AtomicU32,
    changed: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl Scope {
    /// Publish a new revision and tell listeners to re-read. The cursor is the
    /// authoritative signal; the notification is only a hint that may be
    /// coalesced, so a missed one costs latency, never data.
    pub(super) fn changed(&self) {
        self.cursor.fetch_add(1, Ordering::Release);
        if let Some(changed) = &self.changed {
            changed();
        }
    }
}

/// Process-wide activity panel for work against external services. It keeps
/// only the current operation and the recent results of this session, entirely
/// in memory: nothing is written to disk, exported, or retained once the panel
/// is cleared, the window closes, or the app exits.
pub(crate) struct Diagnostics {
    scope: Arc<Scope>,
    active: Arc<AtomicUsize>,
}

impl Default for Diagnostics {
    fn default() -> Self {
        Self::with_listener(None)
    }
}

impl Diagnostics {
    /// `changed` runs whenever the panel gains a new revision. The app uses it
    /// to push an event so the UI can update without polling; core stays free
    /// of any transport or runtime dependency.
    pub(crate) fn with_listener(changed: Option<Arc<dyn Fn() + Send + Sync>>) -> Self {
        Self {
            scope: Arc::new(Scope {
                cursor: AtomicU32::new(1),
                records: Mutex::new(VecDeque::new()),
                discarded: AtomicU32::new(0),
                changed,
            }),
            active: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// Discard every record on explicit clear, main-window destruction or exit. A worker that
    /// is still running keeps its recorder but stops being retained; the next
    /// operation to begin is recorded normally.
    pub(crate) fn clear(&self) {
        self.scope.records.lock().clear();
        self.scope.discarded.store(0, Ordering::Release);
        self.scope.changed();
    }

    pub(crate) fn snapshot(&self, after: u32) -> DiagnosticSnapshot {
        // Read the cursor before records. Publications bump it only after data is
        // visible; an overlapping write may repeat next time, but can never be lost.
        let cursor = self.scope.cursor.load(Ordering::Acquire);
        let operations = (cursor != after).then(|| {
            let records: Vec<_> = self.scope.records.lock().iter().cloned().collect();
            records
                .iter()
                .map(|cell| {
                    cell.terminal
                        .get()
                        .cloned()
                        .unwrap_or_else(|| cell.latest.lock().clone())
                })
                .collect()
        });
        DiagnosticSnapshot {
            cursor,
            discarded: self.scope.discarded.load(Ordering::Relaxed),
            operations,
        }
    }

    pub(crate) fn begin(
        &self,
        source: &str,
        action: &str,
        target: &str,
    ) -> Option<DiagnosticRecorder> {
        // Decide admission under the records lock, but notify listeners only
        // after releasing it: a listener immediately re-reads the snapshot,
        // which needs this same lock, and the notification leaves the process.
        let admitted = {
            let mut records = self.scope.records.try_lock()?;
            let room = if records.len() >= OPERATION_LIMIT {
                match records
                    .iter()
                    .position(|cell| cell.terminal.get().is_some())
                {
                    Some(index) => {
                        records.remove(index);
                        self.scope.discarded.fetch_add(1, Ordering::Relaxed);
                        true
                    }
                    // Every retained operation is still running; none may be
                    // dropped to make room.
                    None => false,
                }
            } else {
                true
            };
            let admitted = room
                && self
                    .active
                    .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                        (value < ACTIVE_LIMIT).then_some(value + 1)
                    })
                    .is_ok();
            admitted.then(|| {
                let recorder = DiagnosticRecorder::new(
                    Arc::downgrade(&self.scope),
                    self.active.clone(),
                    source,
                    action,
                    target,
                );
                records.push_back(recorder.cell.clone());
                recorder
            })
        };
        if admitted.is_none() {
            self.scope.discarded.fetch_add(1, Ordering::Relaxed);
        }
        self.scope.changed();
        admitted
    }
}

#[cfg(test)]
mod protocol_tests;
#[cfg(test)]
mod tests;
