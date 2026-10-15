use super::*;
use crate::error::{AppError, AppResult};
use serde_json::json;

fn records(hub: &Diagnostics) -> Vec<DiagnosticOperation> {
    hub.snapshot(0).operations.unwrap()
}

#[test]
fn command_output_is_lossless_redacted_and_file_payload_never_enters_scratch() {
    let hub = Diagnostics::default();
    let mut log = hub.begin("ssh", "exec", "host").unwrap();
    log.add_secret("fake-password");
    let index = log.command("printf 'ordinary'", true).unwrap();
    log.command_bytes(index, false, b"ordinary\r\nfake-");
    log.command_bytes(index, false, b"password\n");
    log.command_bytes(index, true, b"original error\n");
    log.command_end(index, Some(7), None);
    let archive = log.command("tar -cf - files", false).unwrap();
    log.command_bytes(archive, false, b"FILE-CONTENT-NEVER-CAPTURED");
    assert!(log.command_bodies[1].1.bytes.is_empty());
    // Simulate a stream beyond 4 GiB without allocating its contents.
    log.command_bodies[1].1.received = u32::MAX as u64 + 4096;
    log.command_end(archive, Some(0), None);
    log.finish(None);
    let result = records(&hub).remove(0);
    let DiagnosticDetail::Command {
        command,
        stdout,
        stderr,
        exit_status,
        ..
    } = &result.details[0]
    else {
        panic!("missing command")
    };
    assert_eq!(command.text, "printf 'ordinary'");
    assert_eq!(stdout.text, "ordinary\r\n[REDACTED]\n");
    assert_eq!(stderr.text, "original error\n");
    assert_eq!(*exit_status, Some(7));
    let DiagnosticDetail::Command {
        stdout,
        stdout_captured,
        ..
    } = &result.details[1]
    else {
        panic!("missing archive")
    };
    assert!(!stdout_captured);
    assert_eq!(stdout.received_bytes, (u32::MAX as u64 + 4096) as f64);
    let serialized = serde_json::to_string(&result).unwrap();
    assert!(!serialized.contains("fake-password"));
    assert!(!serialized.contains("FILE-CONTENT-NEVER-CAPTURED"));
}

#[test]
fn full_transcript_cannot_displace_progress_error_or_command_limits() {
    let hub = Diagnostics::default();
    let mut log = hub.begin("sftp", "upload", "host").unwrap();
    log.protocol_event(&json!({"result":"x".repeat(recorder::BODY_LIMIT * 2)}));
    for _ in 0..6 {
        log.command("stat file", true);
    }
    log.progress("complete", 99, Some(99));
    log.correlation("transfer-1");
    let error = AppError::external("io:broken_pipe", "original failure");
    log.finish(Some(&error));
    let result = records(&hub).remove(0);
    assert_eq!(result.details.len(), 4);
    assert_eq!(result.discarded_details, 2);
    assert_eq!(result.progress.unwrap().completed, 99.0);
    assert_eq!(result.correlation_id.as_deref(), Some("transfer-1"));
    assert_eq!(result.error, Some(error));
    assert_eq!(result.status, DiagnosticStatus::Failed);
    let trace = result.trace.unwrap();
    assert!(trace.truncated);
    assert_eq!(trace.captured_bytes as usize, recorder::BODY_LIMIT);
}

#[test]
fn synchronous_context_restores_nested_workers_and_does_not_leak_across_threads() {
    let hub = Diagnostics::default();
    let outer = hub.begin("ssh", "outer", "host").unwrap();
    let inner = hub.begin("ssh", "inner", "host").unwrap();
    context::run(Some(outer), || {
        context::event(&json!({"event":"outer-before"}));
        std::thread::spawn(|| assert!(context::record(|_| ()).is_none()))
            .join()
            .unwrap();
        context::run(Some(inner), || {
            context::event(&json!({"event":"inner-only"}));
            Ok(())
        })?;
        context::event(&json!({"event":"outer-after"}));
        Ok(())
    })
    .unwrap();
    assert!(context::record(|_| ()).is_none());
    let records = records(&hub);
    let outer = &records[0].trace.as_ref().unwrap().text;
    assert!(outer.contains("outer-before") && outer.contains("outer-after"));
    assert!(!outer.contains("inner-only"));
    assert!(records[1]
        .trace
        .as_ref()
        .unwrap()
        .text
        .contains("inner-only"));
}

#[test]
fn panic_restores_context_and_reentrant_instrumentation_does_not_panic() {
    let hub = Diagnostics::default();
    let log = hub.begin("ssh", "panic", "host").unwrap();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        context::run(Some(log), || -> AppResult<()> { panic!("isolated worker") })
    }));
    assert!(result.is_err());
    assert!(context::record(|_| ()).is_none());
    assert_eq!(records(&hub)[0].status, DiagnosticStatus::Interrupted);
    let log = hub.begin("ssh", "reentrant", "host").unwrap();
    context::run(Some(log), || {
        context::record(|_| assert_eq!(context::run(None, || Ok(42)).unwrap(), 42));
        Ok(())
    })
    .unwrap();
    assert_eq!(records(&hub)[1].status, DiagnosticStatus::Passed);
}
