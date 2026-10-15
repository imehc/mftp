use super::diagnostics::{call, path, stat, unit, ProtocolError};
use crate::core::diagnostics::context;
use serde_json::json;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant};

pub(super) struct LoggedFile {
    inner: ssh2::File,
    path: PathBuf,
    reads: u64,
    writes: u64,
    read_bytes: u64,
    written_bytes: u64,
    read_requested: u64,
    write_requested: u64,
    offset: u64,
    dirty: bool,
    published: Instant,
}

impl LoggedFile {
    pub(super) fn new(inner: ssh2::File, path: PathBuf) -> Self {
        Self {
            inner,
            path,
            reads: 0,
            writes: 0,
            read_bytes: 0,
            written_bytes: 0,
            read_requested: 0,
            write_requested: 0,
            offset: 0,
            dirty: false,
            published: Instant::now(),
        }
    }
    pub(super) fn stat(&mut self) -> Result<ssh2::FileStat, ssh2::Error> {
        call(
            "sftp.fstat",
            json!({"path":path(&self.path)}),
            || self.inner.stat(),
            stat,
        )
    }
    pub(super) fn close(&mut self) -> Result<(), ssh2::Error> {
        self.report();
        call(
            "sftp.close",
            json!({"path":path(&self.path)}),
            || self.inner.close(),
            unit,
        )
    }
    fn report(&mut self) {
        if !self.dirty {
            return;
        }
        context::event(
            &json!({"event":"fileIo","path":path(&self.path),"readCalls":self.reads,"writeCalls":self.writes,"readRequestedBytes":self.read_requested,"writeRequestedBytes":self.write_requested,"readBytes":self.read_bytes,"writtenBytes":self.written_bytes,"offset":self.offset,"contentCaptured":false}),
        );
        self.dirty = false;
        self.published = Instant::now();
    }
    fn observe(&mut self, operation: &str, result: &io::Result<usize>) {
        self.dirty = true;
        match result {
            Ok(size) => {
                self.offset = self.offset.saturating_add(*size as u64);
                if operation == "read" {
                    self.read_bytes = self.read_bytes.saturating_add(*size as u64);
                } else {
                    self.written_bytes = self.written_bytes.saturating_add(*size as u64);
                }
            }
            Err(error) => context::event(
                &json!({"event":"error","method":format!("sftp.{operation}"),"path":path(&self.path),"offset":self.offset,"error":error.diagnostic()}),
            ),
        }
        if self.published.elapsed() >= Duration::from_millis(500) {
            self.report();
        }
    }
}

impl Read for LoggedFile {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.reads = self.reads.saturating_add(1);
        self.read_requested = self.read_requested.saturating_add(buffer.len() as u64);
        let result = self.inner.read(buffer);
        self.observe("read", &result);
        result
    }
}

impl Write for LoggedFile {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.writes = self.writes.saturating_add(1);
        self.write_requested = self.write_requested.saturating_add(buffer.len() as u64);
        let result = self.inner.write(buffer);
        self.observe("write", &result);
        result
    }
    fn flush(&mut self) -> io::Result<()> {
        self.report();
        call(
            "sftp.flush",
            json!({"path":path(&self.path)}),
            || self.inner.flush(),
            unit,
        )
    }
}

impl Seek for LoggedFile {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.report();
        let result = call(
            "sftp.seek",
            json!({"path":path(&self.path),"position":format!("{position:?}")}),
            || self.inner.seek(position),
            |offset| json!(offset),
        );
        if let Ok(offset) = &result {
            self.offset = *offset;
        }
        result
    }
}

impl Drop for LoggedFile {
    fn drop(&mut self) {
        self.report();
    }
}
