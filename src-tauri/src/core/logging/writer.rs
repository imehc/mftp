use super::{
    delta, Event, LogHealth, Payload, EVENT_BYTES, QUEUE_BYTES, RETENTION_MS, SEGMENT_BYTES,
    TOTAL_BYTES,
};
use crate::{
    core::diagnostics::{DiagnosticOperation, Redactor},
    error::{AppError, AppResult},
    models::ActivityLog,
};
#[cfg(not(test))]
use fs2::FileExt;
use parking_lot::Mutex;
use std::{
    fs::{self, File, OpenOptions},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering},
        mpsc, Arc,
    },
    time::Duration,
};

pub(crate) struct LogService {
    pub(super) root: PathBuf,
    sender: Option<mpsc::SyncSender<Message>>,
    pub(super) state: Arc<Shared>,
    pub(super) run_id: String,
    sequence: AtomicU64,
    control: Mutex<()>,
}

pub(super) struct Shared {
    pub error: Mutex<Option<AppError>>,
    pub discarded: AtomicU32,
    pub pending: AtomicUsize,
    pub generation: AtomicU64,
    pub cursor: AtomicU64,
}

enum Message {
    Append {
        bytes: Vec<u8>,
        generation: u64,
    },
    Barrier {
        action: Action,
        done: mpsc::SyncSender<AppResult<()>>,
    },
}

enum Action {
    Flush,
    Clear(Option<i64>),
}

impl LogService {
    pub(crate) fn open(root: PathBuf) -> Arc<Self> {
        let state = Arc::new(Shared {
            error: Mutex::new(None),
            discarded: AtomicU32::new(0),
            pending: AtomicUsize::new(0),
            generation: AtomicU64::new(1),
            cursor: AtomicU64::new(1),
        });
        let run_id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = mpsc::sync_channel(2048);
        let prepared = Writer::open(&root, &run_id).and_then(|writer| {
            let shared = state.clone();
            std::thread::Builder::new()
                .name("mftp-log-writer".into())
                .spawn(move || writer.run(receiver, shared))
                .map(|_| ())
                .map_err(AppError::from)
        });
        let sender = match prepared {
            Ok(()) => Some(sender),
            Err(error) => {
                *state.error.lock() = Some(error);
                None
            }
        };
        Arc::new(Self {
            root,
            sender,
            state,
            run_id,
            sequence: AtomicU64::new(0),
            control: Mutex::new(()),
        })
    }

    pub(crate) fn health(&self) -> LogHealth {
        LogHealth {
            error: self.state.error.lock().clone(),
            discarded: self.state.discarded.load(Ordering::Relaxed),
            malformed: 0,
            pending: self
                .state
                .pending
                .load(Ordering::Relaxed)
                .min(u32::MAX as usize) as u32,
        }
    }

    pub(crate) fn generation(&self) -> u64 {
        self.state.generation.load(Ordering::Acquire)
    }

    pub(crate) fn operation(&self, mut record: ActivityLog) {
        let redactor = Redactor::default();
        record.ip = redactor.text(&record.ip).0;
        record.detail = record.detail.map(|value| redactor.text(&value).0);
        record.error = record.error.map(|error| redactor.error(error));
        self.enqueue(Payload::Operation { record });
    }

    pub(crate) fn diagnostic(
        &self,
        previous: &mut serde_json::Value,
        operation: &DiagnosticOperation,
    ) {
        let Ok(next) = serde_json::to_value(operation) else {
            self.discard();
            return;
        };
        let changes = delta::between(previous, &next);
        if changes.is_empty() {
            return;
        }
        if self.enqueue(Payload::Protocol {
            operation_id: operation.id.clone(),
            changes,
        }) {
            *previous = next;
        }
    }

    pub(crate) fn runtime_event(
        &self,
        module: &str,
        action: &str,
        result: &str,
        message: String,
        operation_id: Option<String>,
    ) {
        self.enqueue(Payload::Runtime {
            module: module.into(),
            action: action.into(),
            result: result.into(),
            message,
            operation_id,
        });
    }

    pub(crate) fn discard(&self) {
        self.state.discarded.fetch_add(1, Ordering::Relaxed);
        self.state.cursor.fetch_add(1, Ordering::Release);
    }

    fn enqueue(&self, payload: Payload) -> bool {
        let event = Event {
            schema_version: 1,
            event_id: uuid::Uuid::new_v4().to_string(),
            run_id: self.run_id.clone(),
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed).to_string(),
            timestamp: crate::storage::now_ms(),
            generation: self.generation(),
            payload,
        };
        let Ok(mut bytes) = serde_json::to_vec(&event) else {
            self.discard();
            return false;
        };
        bytes.push(b'\n');
        if bytes.len() > EVENT_BYTES
            || self
                .state
                .pending
                .try_update(Ordering::AcqRel, Ordering::Acquire, |current| {
                    (current.saturating_add(bytes.len()) <= QUEUE_BYTES)
                        .then_some(current + bytes.len())
                })
                .is_err()
        {
            self.discard();
            return false;
        }
        let length = bytes.len();
        if self.sender.as_ref().is_none_or(|sender| {
            sender
                .try_send(Message::Append {
                    bytes,
                    generation: event.generation,
                })
                .is_err()
        }) {
            self.state.pending.fetch_sub(length, Ordering::AcqRel);
            self.discard();
            return false;
        }
        self.state.cursor.fetch_add(1, Ordering::Release);
        true
    }

    fn barrier(&self, action: Action) -> AppResult<()> {
        let _control = self.control.lock();
        let Some(sender) = &self.sender else {
            return Err(self.health().error.unwrap_or_else(|| {
                AppError::external("logs:unavailable", "Log writer unavailable")
            }));
        };
        let (done, receiver) = mpsc::sync_channel(1);
        sender
            .try_send(Message::Barrier { action, done })
            .map_err(|_| AppError::external("logs:busy", "Log writer queue is full or closed"))?;
        receiver.recv_timeout(Duration::from_secs(5)).map_err(|_| {
            AppError::external(
                "logs:timeout",
                "Log writer did not finish before the deadline",
            )
        })?
    }

    pub(crate) fn flush(&self) -> AppResult<()> {
        self.barrier(Action::Flush)
    }
    pub(crate) fn clear(&self, before: Option<i64>) -> AppResult<()> {
        self.barrier(Action::Clear(before))
    }
}

struct Writer {
    root: PathBuf,
    run_id: String,
    _lock: File,
    file: Option<BufWriter<File>>,
    bytes: u64,
    day: i64,
    segment: u32,
    reported_dropped: u32,
}

impl Writer {
    fn open(root: &Path, run_id: &str) -> AppResult<Self> {
        fs::create_dir_all(root)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join(".writer.lock"))?;
        #[cfg(not(test))]
        lock.try_lock_exclusive().map_err(|_| {
            AppError::external("logs:locked", "Another process owns the log directory")
        })?;
        let mut writer = Self {
            root: root.into(),
            run_id: run_id.into(),
            _lock: lock,
            file: None,
            bytes: 0,
            day: -1,
            segment: 0,
            reported_dropped: 0,
        };
        writer.rotate()?;
        Ok(writer)
    }

    fn run(mut self, receiver: mpsc::Receiver<Message>, state: Arc<Shared>) {
        loop {
            let message = match receiver.recv_timeout(Duration::from_millis(350)) {
                Ok(message) => message,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if let Err(error) = self.flush(false) {
                        *state.error.lock() = Some(error);
                    }
                    continue;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    let _ = self.flush(true);
                    break;
                }
            };
            match message {
                Message::Append { bytes, generation } => {
                    state.pending.fetch_sub(bytes.len(), Ordering::AcqRel);
                    if generation != state.generation.load(Ordering::Acquire) {
                        continue;
                    }
                    let result = self.gap(&state).and_then(|_| self.append(&bytes));
                    match result {
                        Ok(()) => {
                            *state.error.lock() = None;
                        }
                        Err(error) => {
                            state.discarded.fetch_add(1, Ordering::Relaxed);
                            *state.error.lock() = Some(error);
                        }
                    }
                }
                Message::Barrier { action, done } => {
                    let result = match action {
                        Action::Flush => self.flush(true),
                        Action::Clear(before) => {
                            state.generation.fetch_add(1, Ordering::AcqRel);
                            state.cursor.fetch_add(1, Ordering::Release);
                            self.clear(before)
                        }
                    };
                    if let Err(error) = &result {
                        *state.error.lock() = Some(error.clone());
                    }
                    let _ = done.send(result);
                }
            }
        }
    }

    fn gap(&mut self, state: &Shared) -> AppResult<()> {
        let discarded = state.discarded.load(Ordering::Relaxed);
        if discarded == self.reported_dropped {
            return Ok(());
        }
        let event = Event {
            schema_version: 1,
            event_id: uuid::Uuid::new_v4().to_string(),
            run_id: self.run_id.clone(),
            sequence: "gap".into(),
            timestamp: crate::storage::now_ms(),
            generation: state.generation.load(Ordering::Acquire),
            payload: Payload::Gap {
                discarded: u64::from(discarded.wrapping_sub(self.reported_dropped)),
            },
        };
        let mut bytes = serde_json::to_vec(&event)?;
        bytes.push(b'\n');
        self.append(&bytes)?;
        self.reported_dropped = discarded;
        Ok(())
    }

    fn append(&mut self, bytes: &[u8]) -> AppResult<()> {
        let day = crate::storage::now_ms().div_euclid(86_400_000);
        if self.file.is_none()
            || day != self.day
            || self.bytes.saturating_add(bytes.len() as u64) > SEGMENT_BYTES
        {
            self.rotate()?;
        }
        self.prune(bytes.len() as u64)?;
        let Some(file) = &mut self.file else {
            return Err(AppError::external(
                "logs:unavailable",
                "No active log segment",
            ));
        };
        if let Err(error) = file.write_all(bytes) {
            self.file.take();
            return Err(error.into());
        }
        self.bytes += bytes.len() as u64;
        Ok(())
    }

    fn flush(&mut self, sync: bool) -> AppResult<()> {
        if let Some(file) = &mut self.file {
            file.flush()?;
            if sync {
                file.get_ref().sync_all()?;
            }
        }
        Ok(())
    }

    fn rotate(&mut self) -> AppResult<()> {
        self.flush(true)?;
        self.file.take();
        self.segment += 1;
        self.day = crate::storage::now_ms().div_euclid(86_400_000);
        let name = format!(
            "mftp-{}-{}-{:06}.jsonl",
            date(self.day),
            self.run_id,
            self.segment
        );
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.root.join(name))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        self.file = Some(BufWriter::new(file));
        self.bytes = 0;
        self.prune(0)
    }

    fn prune(&mut self, incoming: u64) -> AppResult<()> {
        let mut files = super::reader::files(&self.root)?;
        files.sort_by(|left, right| left.id.cmp(&right.id));
        let mut total: u64 = files
            .iter()
            .filter(|file| !file.protected)
            .map(|file| file.bytes as u64)
            .sum();
        total = total.saturating_add(incoming);
        let cutoff = crate::storage::now_ms().saturating_sub(RETENTION_MS) as f64;
        for file in files {
            if file.protected
                || file.id.contains(&self.run_id)
                    && file.id.ends_with(&format!("-{:06}.jsonl", self.segment))
            {
                continue;
            }
            if file.modified_at < cutoff || total > TOTAL_BYTES {
                fs::remove_file(self.root.join(&file.id))?;
                total = total.saturating_sub(file.bytes as u64);
            }
        }
        if total > TOTAL_BYTES {
            return Err(AppError::external(
                "logs:capacity",
                "Log storage capacity exceeded",
            ));
        }
        Ok(())
    }

    fn clear(&mut self, before: Option<i64>) -> AppResult<()> {
        self.flush(true)?;
        self.file.take();
        for file in super::reader::files(&self.root)? {
            if before.is_none_or(|cutoff| file.modified_at <= cutoff as f64) {
                fs::remove_file(self.root.join(file.id))?;
            }
        }
        self.rotate()
    }
}

pub(super) fn date(days: i64) -> String {
    let shifted = days + 719468;
    let era = shifted.div_euclid(146097);
    let year_day = shifted - era * 146097;
    let year_of_era = (year_day - year_day / 1460 + year_day / 36524 - year_day / 146096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = year_day - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = month_index + if month_index < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}
