const LINE_LIMIT: usize = 4096;

/// Observe only complete, bounded UTF-8 comment lines discarded by eventsource-stream.
/// Comment contents never leave this parser; ordinary bytes are not evidence of activity.
pub(super) struct SseComments {
    line: Vec<u8>,
    oversized: bool,
    after_cr: bool,
    first_line: bool,
}

impl SseComments {
    pub(super) fn new() -> Self {
        Self {
            line: Vec::new(),
            oversized: false,
            after_cr: false,
            first_line: true,
        }
    }

    pub(super) fn observe(&mut self, bytes: &[u8]) -> bool {
        let mut heartbeat = false;
        for &byte in bytes {
            if self.after_cr && byte == b'\n' {
                self.after_cr = false;
                continue;
            }
            self.after_cr = byte == b'\r';
            if matches!(byte, b'\r' | b'\n') {
                if !self.oversized {
                    if let Ok(line) = std::str::from_utf8(&self.line) {
                        let line = if self.first_line {
                            line.strip_prefix('\u{feff}').unwrap_or(line)
                        } else {
                            line
                        };
                        heartbeat |= line.starts_with(':');
                    }
                }
                self.line.clear();
                self.oversized = false;
                self.first_line = false;
            } else if self.line.len() < LINE_LIMIT {
                self.line.push(byte);
            } else {
                self.oversized = true;
            }
        }
        heartbeat
    }
}

#[cfg(test)]
#[path = "sse_tests.rs"]
mod tests;
