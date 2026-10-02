use super::*;
use std::{cell::RefCell, collections::VecDeque, io, rc::Rc, sync::mpsc};

struct Channel {
    bytes: io::Cursor<Vec<u8>>,
    errors: VecDeque<io::ErrorKind>,
    trace: Rc<RefCell<Vec<&'static str>>>,
    fail_flush: bool,
}
impl Read for Channel {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if let Some(error) = self.errors.pop_front() {
            return Err(error.into());
        }
        self.bytes.read(buf)
    }
}
impl Write for Channel {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.trace.borrow_mut().push("write");
        Ok(data.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        if self.fail_flush {
            Err(io::ErrorKind::BrokenPipe.into())
        } else {
            Ok(())
        }
    }
}
impl ShellIo for Channel {
    fn eof(&self) -> bool {
        true
    }
    fn resize(&mut self, _: u32, _: u32) {
        self.trace.borrow_mut().push("resize");
    }
    fn close(&mut self) {
        self.trace.borrow_mut().push("close");
    }
}
impl Drop for Channel {
    fn drop(&mut self) {
        self.trace.borrow_mut().push("drop");
    }
}

fn channel(bytes: Vec<u8>, trace: &Rc<RefCell<Vec<&'static str>>>) -> Channel {
    Channel {
        bytes: io::Cursor::new(bytes),
        errors: VecDeque::new(),
        trace: trace.clone(),
        fail_flush: false,
    }
}

#[test]
fn eof_does_not_truncate_multiple_buffers_of_final_output() {
    let trace = Rc::default();
    let bytes: Vec<_> = (0..100_000).map(|i| (i % 251) as u8).collect();
    let mut channel = channel(bytes.clone(), &trace);
    channel.errors.extend([
        io::ErrorKind::Interrupted,
        io::ErrorKind::WouldBlock,
        io::ErrorKind::TimedOut,
    ]);
    let (_tx, rx) = mpsc::channel();
    let mut output = Vec::new();
    run_shell(
        channel,
        &rx,
        || false,
        |chunk| {
            trace.borrow_mut().push("data");
            output.extend_from_slice(chunk);
        },
    );
    assert_eq!(output, bytes);
    assert_eq!(
        *trace.borrow(),
        vec!["data", "data", "data", "data", "close", "drop"]
    );
}

#[test]
fn stop_preempts_pending_writes_and_releases_channel() {
    let trace = Rc::default();
    let (tx, rx) = mpsc::channel();
    tx.send(ShellJob::Write(vec![1; 128])).unwrap();
    run_shell(
        channel(vec![1], &trace),
        &rx,
        || true,
        |_| panic!("output after stop"),
    );
    assert_eq!(*trace.borrow(), vec!["close", "drop"]);
}

#[test]
fn a_write_backlog_yields_to_output_and_flush_failure_closes() {
    let trace = Rc::default();
    let (tx, rx) = mpsc::channel();
    for _ in 0..128 {
        tx.send(ShellJob::Write(vec![1])).unwrap();
    }
    run_shell(
        channel(vec![1], &trace),
        &rx,
        || false,
        |_| trace.borrow_mut().push("data"),
    );
    assert_eq!(
        trace.borrow().iter().position(|entry| *entry == "data"),
        Some(64)
    );
    trace.borrow_mut().clear();
    let mut channel = channel(vec![1], &trace);
    channel.fail_flush = true;
    tx.send(ShellJob::Write(vec![1])).unwrap();
    run_shell(
        channel,
        &rx,
        || false,
        |_| panic!("read after flush failure"),
    );
    assert_eq!(*trace.borrow(), vec!["write", "close", "drop"]);
}
