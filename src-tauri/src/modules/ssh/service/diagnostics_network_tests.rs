//! Opt-in loopback acceptance. Never resolve SSH config or use an agent/default
//! identity. The fixture must be an explicitly supplied temporary sshd directory.
use super::super::test_support::Fixture;
use super::*;
use crate::core::diagnostics::{
    DiagnosticDetail, DiagnosticOperation, DiagnosticStatus, Diagnostics,
};
use crate::error::{AppError, AppResult};
use std::{fs, time::Duration};

fn setup() -> (Fixture, Arc<Diagnostics>) {
    let root = std::path::PathBuf::from(
        std::env::var("MFTP_SSH_TEST_FIXTURE").expect("explicit isolated fixture required"),
    );
    assert!(root
        .to_string_lossy()
        .starts_with("/private/tmp/mftp-ssh-diagnostics-"));
    let config: Value =
        serde_json::from_slice(&fs::read(root.join("fixture.json")).unwrap()).unwrap();
    let fixture = Fixture::new();
    fixture.manager.register(
        "session",
        AuthMaterial {
            host: "127.0.0.1".into(),
            port: config["port"].as_u64().unwrap().try_into().unwrap(),
            username: config["username"].as_str().unwrap().into(),
            method: AuthMethod::Key {
                private_key: fs::read_to_string(root.join("client")).unwrap(),
                passphrase: None,
            },
            identity_files: vec![],
        },
    );
    let hub = fixture.manager.diagnostics.clone();
    (fixture, hub)
}

fn run<T>(
    manager: &Manager,
    action: &'static str,
    transfer: Option<&str>,
    operation: impl FnOnce() -> AppResult<T>,
) -> AppResult<T> {
    let (log, _lease) =
        manager.diagnostic(&OperationContext::new("sftp", action, "session"), transfer);
    context::run(log, operation)
}

fn operations(hub: &Diagnostics) -> Vec<DiagnosticOperation> {
    hub.snapshot(0).operations.unwrap()
}

#[test]
#[ignore = "requires explicit isolated loopback sshd fixture"]
fn loopback_exec_sftp_and_binary_payload_capture() {
    let (fixture, hub) = setup();
    let manager = &fixture.manager;
    let result = run(manager, "exec", None, || {
        manager.exec(
            "session",
            "printf ' ordinary\\n'; printf 'original error\\n' >&2; exit 7",
        )
    })
    .unwrap();
    assert_eq!(result, (7, " ordinary\n".into(), "original error\n".into()));
    let record = operations(&hub).remove(0);
    let DiagnosticDetail::Command {
        command,
        stdout,
        stderr,
        exit_status,
        ..
    } = &record.details[0]
    else {
        panic!("missing exec")
    };
    assert!(command.text.contains("exit 7"));
    assert_eq!(stdout.text, result.1);
    assert_eq!(stderr.text, result.2);
    assert_eq!(*exit_status, Some(7));
    let trace = record.trace.unwrap().text;
    for method in [
        "ssh.tcpConnect",
        "ssh.handshake",
        "ssh.authenticate",
        "ssh.exec",
        "ssh.exitStatus",
    ] {
        assert!(trace.contains(method), "{method}");
    }

    let remote_dir = fixture.root.join("remote");
    let remote = remote_dir.join("target");
    let renamed = remote_dir.join("renamed");
    let local = fixture.root.join("upload");
    let downloaded = fixture.root.join("downloaded");
    let payload = b"FILE-CONTENT-NEVER-CAPTURED\x00\xff".repeat(20000);
    fs::write(&local, &payload).unwrap();
    run(manager, "mkdir", None, || {
        manager.sftp_mkdir("session", remote_dir.to_str().unwrap())
    })
    .unwrap();
    run(manager, "upload", Some("upload-id"), || {
        manager.sftp_upload(
            "session",
            local.to_str().unwrap(),
            remote.to_str().unwrap(),
            None,
            Some("upload-id"),
        )
    })
    .unwrap();
    run(manager, "rename", None, || {
        manager.sftp_rename(
            "session",
            remote.to_str().unwrap(),
            renamed.to_str().unwrap(),
        )
    })
    .unwrap();
    let entries = run(manager, "list", None, || {
        manager.sftp_list("session", remote_dir.to_str().unwrap())
    })
    .unwrap();
    assert!(!entries.is_empty());
    run(manager, "download", Some("download-id"), || {
        manager.sftp_download(
            "session",
            renamed.to_str().unwrap(),
            downloaded.to_str().unwrap(),
            None,
            Some("download-id"),
        )
    })
    .unwrap();
    assert_eq!(fs::read(downloaded).unwrap(), payload);
    let missing = run(manager, "missing", None, || {
        manager.sftp_list("session", remote_dir.join("missing").to_str().unwrap())
    });
    assert!(missing.is_err());
    let operations = operations(&hub);
    let raw = serde_json::to_string(&operations).unwrap();
    assert!(!raw.contains("FILE-CONTENT-NEVER-CAPTURED"));
    let material = manager.material("session").unwrap();
    let AuthMethod::Key { private_key, .. } = &material.method else {
        unreachable!()
    };
    for line in private_key
        .lines()
        .filter(|line| !line.starts_with("-----"))
    {
        assert!(!raw.contains(line));
    }
    let upload = operations
        .iter()
        .find(|entry| entry.action == "upload")
        .unwrap();
    assert_eq!(
        upload.progress.as_ref().unwrap().completed,
        payload.len() as f64
    );
    assert_eq!(upload.correlation_id.as_deref(), Some("upload-id"));
    assert!(upload.trace.as_ref().unwrap().text.contains("writtenBytes"));
    assert!(operations
        .last()
        .unwrap()
        .trace
        .as_ref()
        .unwrap()
        .text
        .contains("\"domain\":\"sftp\""));
    manager.disconnect("session");
}

#[test]
#[ignore = "requires explicit isolated loopback sshd fixture"]
fn loopback_archive_stdout_and_cancellation_preserve_capture_boundaries() {
    let (fixture, hub) = setup();
    let manager = &fixture.manager;
    run(manager, "archive", None, || {
        let material = manager.material("session")?;
        let session = super::super::auth::connect(&material)?;
        let mut received = Vec::new();
        super::super::remote_command_io::execute(
            &session,
            "printf 'ARCHIVE-PAYLOAD'",
            false,
            || Ok(false),
            |bytes| {
                received.extend_from_slice(bytes);
                Ok(())
            },
        )
        .map_err(super::super::transfer_retry::AttemptError::into_error)?;
        assert_eq!(received, b"ARCHIVE-PAYLOAD");
        Ok(())
    })
    .unwrap();
    let record = operations(&hub).remove(0);
    let DiagnosticDetail::Command {
        stdout,
        stdout_captured,
        ..
    } = &record.details[0]
    else {
        panic!("missing archive")
    };
    assert!(!stdout_captured);
    assert_eq!(stdout.received_bytes, 15.0);
    assert!(stdout.text.is_empty());
    let (tx, rx) = std::sync::mpsc::channel();
    let worker_manager = manager.clone();
    let worker = std::thread::spawn(move || {
        run(&worker_manager, "cancelled_exec", Some("cancel-id"), || {
            let guard = worker_manager.transfer_guard(Some("cancel-id")).unwrap();
            let material = worker_manager.material("session")?;
            let session = super::super::auth::connect(&material)?;
            tx.send(()).unwrap();
            super::super::remote_command_io::execute(
                &session,
                "sleep 10",
                true,
                || worker_manager.command_control("session", &material, Some(&guard)),
                |_| Ok(()),
            )
            .map_err(super::super::transfer_retry::AttemptError::into_error)?;
            Ok(())
        })
    });
    rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let (control, _) = manager.diagnostic(
        &OperationContext::new("sftp", "cancel_transfer", "cancel-id"),
        None,
    );
    context::run(control, || {
        manager.cancel_transfer("cancel-id");
        Ok(())
    })
    .unwrap();
    let error = worker.join().unwrap().unwrap_err();
    assert_eq!(error.code, "sftp:transfer_cancelled");
    let records = operations(&hub);
    assert_eq!(
        records
            .iter()
            .find(|entry| entry.action == "cancelled_exec")
            .unwrap()
            .status,
        DiagnosticStatus::Failed
    );
    assert_eq!(
        records
            .iter()
            .find(|entry| entry.action == "cancel_transfer")
            .unwrap()
            .status,
        DiagnosticStatus::Passed
    );
    manager.disconnect("session");
}

#[test]
#[ignore = "requires explicit isolated loopback sshd fixture"]
fn loopback_shell_lifecycle_and_authentication_failure_are_observed() {
    let (fixture, hub) = setup();
    let manager = &fixture.manager;
    let (tx, rx) = std::sync::mpsc::channel();
    run(manager, "open_shell", None, || {
        manager.open_shell(
            Arc::new(move |event| {
                if matches!(event, super::super::super::ports::SshEvent::Closed { .. }) {
                    let _ = tx.send(());
                }
            }),
            "session",
            80,
            24,
        )
    })
    .unwrap();
    manager
        .write("session", b"printf 'TERMINAL-CONTENT-NEVER-CAPTURED'\n")
        .unwrap();
    run(manager, "disconnect", None, || {
        manager.disconnect("session");
        Ok(())
    })
    .unwrap();
    rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let records = operations(&hub);
    assert!(records
        .iter()
        .all(|record| record.status != DiagnosticStatus::Running));
    let text = serde_json::to_string(&records).unwrap();
    assert!(!text.contains("TERMINAL-CONTENT-NEVER-CAPTURED"));
    assert!(text.contains("shellWorkerExited"));
    let (fixture, hub) = setup();
    let manager = &fixture.manager;
    let mut auth = (*manager.material("session").unwrap()).clone();
    auth.method = AuthMethod::Password(Some("FAKE-PASSWORD-DO-NOT-LOG".into()));
    let mut log = hub.begin("ssh", "auth_failure", "127.0.0.1").unwrap();
    register_secrets(|secret| log.add_secret(secret), &auth);
    let error: AppError = context::run(Some(log), || super::super::auth::connect(&auth))
        .err()
        .unwrap();
    assert!(!error.code.is_empty());
    let text = serde_json::to_string(&operations(&hub)).unwrap();
    assert!(!text.contains("FAKE-PASSWORD-DO-NOT-LOG"));
    assert!(text.contains("ssh.authenticate"));
    manager.disconnect("session");
}
