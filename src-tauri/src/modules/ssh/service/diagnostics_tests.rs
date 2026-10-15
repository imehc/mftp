use super::super::test_support::{material, Fixture};
use super::*;
use crate::core::diagnostics::{DiagnosticStatus, Diagnostics};
use crate::error::{AppError, AppResult, CustomErrorCode};

#[test]
fn sdk_instrumentation_preserves_values_errors_and_known_credentials() {
    let hub = Diagnostics::default();
    let mut log = hub.begin("sftp", "list", "host").unwrap();
    log.add_secret("fake-password");
    context::run(Some(log), || {
        assert_eq!(
            call(
                "test.value",
                json!({"path":"ordinary"}),
                || Ok::<_, std::io::Error>(42),
                |value| json!(value)
            )
            .unwrap(),
            42
        );
        let original = ssh2::Error::new(ssh2::ErrorCode::SFTP(3), "Denied: fake-password");
        let error = call::<(), _>("sftp.stat", json!({}), || Err(original), unit).unwrap_err();
        assert_eq!(error.code(), ssh2::ErrorCode::SFTP(3));
        assert_eq!(error.message(), "Denied: fake-password");
        Ok(())
    })
    .unwrap();
    let snapshot = hub.snapshot(0);
    let trace = &snapshot.operations.as_ref().unwrap()[0]
        .trace
        .as_ref()
        .unwrap()
        .text;
    assert!(trace.contains("\"code\":3"));
    assert!(trace.contains("Denied: [REDACTED]"));
    assert!(trace.contains("\"value\":42"));
    assert!(!trace.contains("fake-password"));
}

#[test]
fn transfer_controls_correlate_without_finishing_the_original_worker() {
    let fixture = Fixture::new();
    let manager = &fixture.manager;
    let hub = manager.diagnostics.clone();
    manager.register("one", material());
    let (log, lease) = manager.diagnostic(
        &OperationContext::new("sftp", "upload", "one"),
        Some("task"),
    );
    let guard = manager.transfer_guard(Some("task")).unwrap();
    for action in ["pause_transfer", "resume_transfer", "cancel_transfer"] {
        let (control, _) = manager.diagnostic(&OperationContext::new("sftp", action, "task"), None);
        context::run(control, || match action {
            "pause_transfer" => manager.pause_transfer("task"),
            "resume_transfer" => manager.resume_transfer("task"),
            _ => {
                manager.cancel_transfer("task");
                Ok(())
            }
        })
        .unwrap();
    }
    let operations = hub.snapshot(0).operations.unwrap();
    assert_eq!(operations[0].status, DiagnosticStatus::Running);
    assert!(operations
        .iter()
        .all(|entry| entry.correlation_id.as_deref() == Some("task")));
    assert!(operations[1..]
        .iter()
        .all(|entry| entry.status == DiagnosticStatus::Passed));
    manager.disconnect("one");
    // Disconnecting drops the session's transfer correlation, but the shared
    // panel keeps its records for as long as the app is running.
    assert!(!hub.snapshot(0).operations.unwrap().is_empty());
    let result: AppResult<()> = context::run(log, || Err(guard.check().unwrap_err()));
    assert_eq!(
        result.unwrap_err().code,
        CustomErrorCode::SftpTransferCancelled.as_str()
    );
    drop(lease);
    assert!(manager.logs.transfers.lock().is_empty());
    assert_eq!(
        hub.snapshot(0).operations.unwrap()[0].status,
        DiagnosticStatus::Failed
    );
}

#[test]
fn reconnect_keeps_recording_into_the_shared_panel() {
    let fixture = Fixture::new();
    let manager = &fixture.manager;
    let hub = manager.diagnostics.clone();
    let mut auth = material();
    auth.method = AuthMethod::Password(Some("fake-passphrase".into()));
    manager.register("session", auth.clone());
    let mut workers = Vec::new();
    for _ in 0..20 {
        workers.push(
            manager
                .diagnostic(&OperationContext::new("sftp", "upload", "session"), None)
                .0,
        );
    }
    // Reconnecting replaces the session credentials but never starts a second
    // panel: records accumulate in the one the app already shares.
    manager.register("session", auth);
    assert_eq!(hub.snapshot(0).operations.unwrap().len(), 20);
    assert!(manager
        .diagnostic(&OperationContext::new("sftp", "upload", "session"), None)
        .0
        .is_none());
    let error = AppError::external("ssh:remote_exit", "fake-passphrase: original error")
        .with_arg("path", "/ordinary/fake-passphrase");
    let safe = manager.error_redactor("session").error(error);
    assert_eq!(safe.code, "ssh:remote_exit");
    assert_eq!(safe.message, "[REDACTED]: original error");
    assert_eq!(safe.args["path"], "/ordinary/[REDACTED]");
}

#[cfg(unix)]
#[test]
fn non_utf8_paths_remain_explicit_and_redact_credentials_before_encoding() {
    use std::os::unix::ffi::OsStringExt;
    let hub = Diagnostics::default();
    let mut log = hub.begin("sftp", "list", "host").unwrap();
    log.add_secret("fake-password");
    context::run(Some(log), || {
        let p =
            std::path::PathBuf::from(std::ffi::OsString::from_vec(b"\xff-fake-password".to_vec()));
        call::<_, std::io::Error>(
            "sftp.realpath",
            json!({"path":path(&p)}),
            || Ok(p.clone()),
            |value| path(value),
        )
        .unwrap();
        Ok(())
    })
    .unwrap();
    let text = hub
        .snapshot(0)
        .operations
        .unwrap()
        .remove(0)
        .trace
        .unwrap()
        .text;
    assert!(text.contains("\"encoding\":\"hex\""));
    assert!(text.contains("ff 2d 5b 52 45 44 41 43 54 45 44 5d"));
    assert!(!text.contains("fake-password"));
}
