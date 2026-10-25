use super::{
    model::*,
    redaction::{sensitive, Redactor},
    RecordCell, Scope,
};
use crate::error::AppError;
use parking_lot::Mutex;
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, OnceLock, Weak,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub(super) const BODY_LIMIT: usize = 32 * 1024;
pub(super) const VIEW_LIMIT: usize = 96 * 1024;
const HEADER_LIMIT: usize = 8 * 1024;
const DETAIL_LIMIT: usize = 4;

pub(super) struct RawBody {
    pub(super) bytes: Vec<u8>,
    pub(super) received: u64,
    pub(super) end: DiagnosticBodyEnd,
}

impl RawBody {
    pub(super) fn new() -> Self {
        Self {
            bytes: Vec::new(),
            received: 0,
            end: DiagnosticBodyEnd::Receiving,
        }
    }
    pub(super) fn append(&mut self, bytes: &[u8]) {
        self.received = self.received.saturating_add(bytes.len() as u64);
        self.bytes.extend_from_slice(
            &bytes[..bytes.len().min(BODY_LIMIT.saturating_sub(self.bytes.len()))],
        );
    }
    pub(super) fn view(&self, redactor: &Redactor) -> DiagnosticText {
        let truncated = self.received > self.bytes.len() as u64;
        let partial = truncated
            || !matches!(
                self.end,
                DiagnosticBodyEnd::Complete | DiagnosticBodyEnd::ProtocolEnd
            );
        let (bytes, redacted) = redactor.bytes(&self.bytes, partial);
        let (text, encoding) = display_bytes(bytes);
        let truncated = truncated || text.len() > VIEW_LIMIT;
        let text = bounded(&text, VIEW_LIMIT);
        DiagnosticText {
            text,
            encoding: encoding.into(),
            received_bytes: self.received as f64,
            captured_bytes: self.bytes.len() as u32,
            redacted,
            truncated,
            end: self.end,
        }
    }
}

// A domain worker owns this recorder. Only sanitized immutable views are shared.
pub(crate) struct DiagnosticRecorder {
    active: Arc<AtomicUsize>,
    pub(super) cell: Arc<RecordCell>,
    scope: Weak<Scope>,
    pub(super) local: DiagnosticOperation,
    pub(super) redactor: Redactor,
    pub(super) bodies: Vec<RawBody>,
    pub(super) command_bodies: Vec<(usize, RawBody, RawBody)>,
    pub(super) trace: RawBody,
    start: Instant,
    pub(super) published: Instant,
    pub(super) finished: bool,
}

impl DiagnosticRecorder {
    pub(super) fn new(
        scope: Weak<Scope>,
        active: Arc<AtomicUsize>,
        source: &str,
        action: &str,
        target: &str,
    ) -> Self {
        let redactor = Redactor::default();
        let metadata_truncated = source.len() > 64 || action.len() > 64 || target.len() > 512;
        let (target, redacted) = redactor.text(target);
        let local = DiagnosticOperation {
            id: uuid::Uuid::new_v4().to_string(),
            source: bounded(source, 64),
            action: bounded(action, 64),
            target: bounded(&target, 512),
            correlation_id: None,
            trace: None,
            progress: None,
            discarded_details: 0,
            metadata_truncated,
            redacted,
            started_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as f64,
            elapsed_ms: 0,
            status: DiagnosticStatus::Running,
            phase: DiagnosticPhase::Preparing,
            details: Vec::new(),
            error: None,
        };
        Self {
            active,
            cell: Arc::new(RecordCell {
                latest: Mutex::new(local.clone()),
                terminal: OnceLock::new(),
            }),
            scope,
            local,
            redactor,
            bodies: Vec::new(),
            command_bodies: Vec::new(),
            trace: RawBody::new(),
            start: Instant::now(),
            published: Instant::now(),
            finished: false,
        }
    }

    pub(crate) fn id(&self) -> &str {
        &self.local.id
    }

    pub(crate) fn add_secret(&mut self, secret: &str) {
        self.redactor.add_secret(secret);
    }

    pub(crate) fn target(&mut self, target: &str) {
        let (safe, redacted) = self.redactor.text(target);
        self.local.metadata_truncated |= safe.len() > 512;
        self.local.redacted |= redacted;
        self.local.target = bounded(&safe, 512);
        self.publish();
    }

    fn headers(&self, headers: Vec<(String, Vec<u8>)>) -> (Vec<DiagnosticHeader>, bool) {
        let mut result = Vec::new();
        let mut length = 0;
        let mut truncated = false;
        for (name, value) in headers {
            if result.len() >= 64 || length + name.len() + value.len() > HEADER_LIMIT {
                truncated = true;
                continue;
            }
            length += name.len() + value.len();
            let (value, redacted) = if sensitive(&name) {
                (b"[REDACTED]".to_vec(), true)
            } else if name.eq_ignore_ascii_case("location") {
                self.redactor.url_bytes(&value)
            } else {
                self.redactor.bytes(&value, false)
            };
            let (value, encoding) = display_bytes(value);
            result.push(DiagnosticHeader {
                name,
                value,
                encoding: encoding.into(),
                redacted,
            });
        }
        (result, truncated)
    }

    pub(crate) fn http_request(
        &mut self,
        method: &str,
        url: &str,
        headers: Vec<(String, Vec<u8>)>,
        body: &[u8],
    ) {
        if self.local.details.len() >= DETAIL_LIMIT {
            return;
        }
        let mut raw = RawBody::new();
        raw.append(body);
        raw.end = DiagnosticBodyEnd::Complete;
        let (headers, headers_truncated) = self.headers(headers);
        let safe_url = self.redactor.url(url);
        self.local.redacted |= safe_url != url;
        self.local.metadata_truncated |= safe_url.len() > 4096 || method.len() > 16;
        self.local.details.push(DiagnosticDetail::HttpRequest {
            method: bounded(method, 16),
            url: bounded(&safe_url, 4096),
            headers,
            headers_truncated,
            body: raw.view(&self.redactor),
        });
        self.bodies.push(raw);
        self.local.phase = DiagnosticPhase::Sending;
        self.publish();
    }

    pub(crate) fn http_response(&mut self, status: u16, headers: Vec<(String, Vec<u8>)>) {
        if self.local.details.len() >= DETAIL_LIMIT {
            return;
        }
        let raw = RawBody::new();
        let (headers, headers_truncated) = self.headers(headers);
        self.local.details.push(DiagnosticDetail::HttpResponse {
            status,
            headers,
            headers_truncated,
            body: raw.view(&self.redactor),
        });
        self.bodies.push(raw);
        self.local.phase = DiagnosticPhase::Receiving;
        self.publish();
    }

    #[cfg(desktop)]
    pub(crate) fn request_start(
        &mut self,
        method: &str,
        url: &str,
        headers: Vec<(String, Vec<u8>)>,
    ) {
        self.http_request(method, url, headers, &[]);
        if let Some(index) = self
            .local
            .details
            .iter()
            .position(|detail| matches!(detail, DiagnosticDetail::HttpRequest { .. }))
        {
            self.bodies[index].end = DiagnosticBodyEnd::Receiving;
            self.publish();
        }
    }

    #[cfg(desktop)]
    pub(crate) fn request_bytes(&mut self, bytes: &[u8]) {
        if let Some(index) = self
            .local
            .details
            .iter()
            .position(|detail| matches!(detail, DiagnosticDetail::HttpRequest { .. }))
        {
            self.bodies[index].append(bytes);
        }
    }

    #[cfg(desktop)]
    pub(crate) fn request_end(&mut self, end: DiagnosticBodyEnd) {
        if let Some(index) = self
            .local
            .details
            .iter()
            .position(|detail| matches!(detail, DiagnosticDetail::HttpRequest { .. }))
        {
            self.bodies[index].end = end;
            self.publish();
        }
    }

    pub(crate) fn response_bytes(&mut self, bytes: &[u8]) {
        if self.scope.upgrade().is_none() {
            self.bodies.clear();
            return;
        }
        if let Some(index) = self
            .local
            .details
            .iter()
            .position(|detail| matches!(detail, DiagnosticDetail::HttpResponse { .. }))
        {
            if let Some(body) = self.bodies.get_mut(index) {
                body.append(bytes);
            }
        }
        // Batch high-frequency chunks; the final publication is never throttled.
        if self.published.elapsed() >= Duration::from_millis(100) {
            self.publish();
        }
    }

    pub(crate) fn response_end(&mut self, end: DiagnosticBodyEnd) {
        if let Some(index) = self
            .local
            .details
            .iter()
            .position(|detail| matches!(detail, DiagnosticDetail::HttpResponse { .. }))
        {
            if let Some(body) = self.bodies.get_mut(index) {
                body.end = end;
            }
        }
        self.publish();
    }

    /// Count intentionally unrecorded binary payloads without retaining their bytes.
    /// Callers add an explicit protocol note explaining why capture was omitted.
    pub(crate) fn response_omitted_bytes(&mut self, length: usize) {
        if let Some(index) = self
            .local
            .details
            .iter()
            .position(|detail| matches!(detail, DiagnosticDetail::HttpResponse { .. }))
        {
            if let Some(body) = self.bodies.get_mut(index) {
                body.received = body.received.saturating_add(length as u64);
            }
        }
    }

    pub(crate) fn transport_error(&mut self, error: &dyn std::fmt::Display) {
        if self.local.details.len() >= DETAIL_LIMIT {
            return;
        }
        let mut raw = RawBody::new();
        raw.append(error.to_string().as_bytes());
        raw.end = DiagnosticBodyEnd::Complete;
        self.local.details.push(DiagnosticDetail::TransportError {
            body: raw.view(&self.redactor),
        });
        self.bodies.push(raw);
        self.publish();
    }

    fn refresh(&mut self) {
        self.refresh_protocol();
        self.local.elapsed_ms = self.start.elapsed().as_millis().min(u32::MAX as u128) as u32;
        for (detail, raw) in self.local.details.iter_mut().zip(&self.bodies) {
            let body = match detail {
                DiagnosticDetail::HttpRequest { body, .. }
                | DiagnosticDetail::HttpResponse { body, .. }
                | DiagnosticDetail::TransportError { body } => body,
                DiagnosticDetail::Command { .. } => continue,
            };
            *body = raw.view(&self.redactor);
        }
    }

    pub(super) fn publish(&mut self) {
        let Some(scope) = self.scope.upgrade() else {
            return;
        };
        self.refresh();
        // Snapshot readers must never hold up a transport worker. Skipped interim
        // views are replaced by the next cumulative view; the terminal has its own slot.
        let published = if let Some(mut view) = self.cell.latest.try_lock() {
            *view = self.local.clone();
            self.published = Instant::now();
            true
        } else {
            false
        };
        // Notify after releasing the cell lock: listeners immediately re-read the
        // snapshot, which needs that same lock, and the notification itself leaves
        // this process for the UI.
        if published {
            scope.changed();
        }
    }

    pub(crate) fn finish(&mut self, error: Option<&AppError>) {
        self.complete(
            if error.is_some() {
                DiagnosticStatus::Failed
            } else {
                DiagnosticStatus::Passed
            },
            error,
        );
    }

    #[cfg(desktop)]
    pub(crate) fn unverified(&mut self) {
        self.complete(DiagnosticStatus::Unverified, None);
    }

    fn complete(&mut self, status: DiagnosticStatus, error: Option<&AppError>) {
        if self.finished {
            return;
        }
        self.finished = true;
        for body in &mut self.bodies {
            if body.end == DiagnosticBodyEnd::Receiving {
                body.end = DiagnosticBodyEnd::Interrupted;
            }
        }
        self.end_protocol();
        self.refresh();
        self.local.status = status;
        self.local.phase = DiagnosticPhase::Finished;
        self.local.error = error.map(|error| {
            let mut safe = error.clone();
            let (message, redacted) = self.redactor.text(&safe.message);
            self.local.redacted |= redacted;
            self.local.metadata_truncated |= message.len() > 2048 || safe.args.len() > 32;
            safe.message = bounded(&message, 2048);
            safe.args = safe
                .args
                .into_iter()
                .take(32)
                .map(|(key, value)| {
                    let (value, redacted) = if sensitive(&key) {
                        ("[REDACTED]".into(), true)
                    } else {
                        self.redactor.text(&value)
                    };
                    self.local.redacted |= redacted;
                    self.local.metadata_truncated |= key.len() > 128 || value.len() > 512;
                    (bounded(&key, 128), bounded(&value, 512))
                })
                .collect();
            safe
        });
        let _ = self.cell.terminal.set(self.local.clone());
        if let Some(scope) = self.scope.upgrade() {
            scope.changed();
        }
    }
}

impl Drop for DiagnosticRecorder {
    fn drop(&mut self) {
        self.complete(DiagnosticStatus::Interrupted, None);
        self.active.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(super) fn bounded(value: &str, limit: usize) -> String {
    let mut end = value.len().min(limit);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].into()
}

fn display_bytes(bytes: Vec<u8>) -> (String, &'static str) {
    match String::from_utf8(bytes) {
        Ok(text) => (text, "utf8"),
        // Hex preserves invalid UTF-8 bytes exactly after credential redaction.
        Err(error) => (
            error
                .into_bytes()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<Vec<_>>()
                .join(" "),
            "hex",
        ),
    }
}
