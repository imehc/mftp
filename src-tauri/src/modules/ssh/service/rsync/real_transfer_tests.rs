//! Real-transfer acceptance for the formal bridge. Ignored by default: it needs
//! the isolated SSH container, `MFTP_RSYNC_TEST=1`, and a debug app binary that
//! can act as the helper. No user credentials or hosts are involved.

use super::super::auth;
use super::super::path_utils::shell_quote;
use super::super::types::{AuthMaterial, AuthMethod, Manager};
use super::bridge::{BridgeOptions, TEST_HELPER_EXECUTABLE};
use super::real_test_support::{
    app_binary, enabled, leftover_helpers, password_from_env, path_str, remote_output, run_remote,
    task_directories_exist, Cleanup, HOST, PORT, USER,
};
use crate::modules::ssh::{RsyncDirection, RsyncStatus};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

const REMOTE_ROOT: &str = "/home/tester/mftp-formal-stage1";

#[test]
#[ignore = "requires MFTP_RSYNC_TEST=1, the isolated SSH container and a built app binary"]
fn real_upload_and_download_use_the_formal_bridge() {
    if !enabled() {
        return;
    }
    let Some(password) = password_from_env() else {
        return;
    };
    let material = AuthMaterial {
        host: HOST.into(),
        port: PORT,
        username: USER.into(),
        method: AuthMethod::Password(Some(password)),
        identity_files: Vec::new(),
    };
    let root = std::env::temp_dir().join(format!("mftp-stage1-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("src/nested")).expect("local source");
    fs::create_dir_all(root.join("download")).expect("local destination");
    fs::write(root.join("src/alpha.txt"), b"alpha-content").expect("alpha");
    fs::write(root.join("src/nested/beta.txt"), b"beta-content").expect("beta");
    let cleanup = Cleanup {
        root: root.clone(),
        remote_root: REMOTE_ROOT.into(),
        material: material.clone(),
    };

    let app = app_binary();
    TEST_HELPER_EXECUTABLE.get_or_init(|| app.clone());
    let manager = Manager::new(root.join("journal.json"));
    manager.register("stage1", material.clone());
    let local = manager.rsync_local_status(true);
    assert_eq!(local.status, RsyncStatus::Available, "{local:?}");
    let capabilities = manager
        .rsync_capabilities("stage1", true)
        .expect("remote capability probe");
    assert_eq!(capabilities.remote.status, RsyncStatus::Available);
    let local_rsync = PathBuf::from(local.path.expect("local rsync path"));
    let remote_rsync = capabilities.remote.path.expect("remote rsync path");

    let session = auth::connect(&material).expect("remote setup session");
    session.set_timeout(10_000);
    let upload_target = format!("{REMOTE_ROOT}/upload-target");
    let remote_source = format!("{REMOTE_ROOT}/download-source");
    run_remote(
        &session,
        &format!(
            "rm -rf {root} && mkdir -p {root}/download-source/nested && \
             printf %s remote-alpha > {root}/download-source/remote.txt && \
             printf %s remote-beta > {root}/download-source/nested/remote-nested.txt",
            root = shell_quote(REMOTE_ROOT)
        ),
    );

    let upload = manager
        .rsync_run(BridgeOptions {
            local_rsync: &local_rsync,
            remote_rsync: &remote_rsync,
            material: Arc::new(material.clone()),
            direction: RsyncDirection::Upload,
            local_dir: path_str(&root.join("src")),
            remote_dir: &upload_target,
            delete_extraneous: false,
            dry_run: false,
            events: None,
            transfer_id: None,
            transfer: None,
            phase: "stage1-upload",
        })
        .expect("upload");
    assert_eq!(upload.exit_code, 0);
    assert_eq!(
        remote_output(
            &session,
            &format!("cat {}/alpha.txt", shell_quote(&upload_target))
        ),
        "alpha-content"
    );
    assert_eq!(
        remote_output(
            &session,
            &format!("cat {}/nested/beta.txt", shell_quote(&upload_target))
        ),
        "beta-content"
    );

    let download = manager
        .rsync_run(BridgeOptions {
            local_rsync: &local_rsync,
            remote_rsync: &remote_rsync,
            material: Arc::new(material.clone()),
            direction: RsyncDirection::Download,
            local_dir: path_str(&root.join("download")),
            remote_dir: &remote_source,
            delete_extraneous: false,
            dry_run: false,
            events: None,
            transfer_id: None,
            transfer: None,
            phase: "stage1-download",
        })
        .expect("download");
    assert_eq!(download.exit_code, 0);
    assert_eq!(
        fs::read_to_string(root.join("download/remote.txt")).expect("remote alpha"),
        "remote-alpha"
    );
    assert_eq!(
        fs::read_to_string(root.join("download/nested/remote-nested.txt")).expect("remote beta"),
        "remote-beta"
    );

    std::thread::sleep(Duration::from_millis(200));
    assert!(
        !leftover_helpers(),
        "the rsync helper process outlived the task"
    );
    assert!(
        !task_directories_exist(),
        "the rsync task directory outlived the task"
    );
    drop(cleanup);
}

#[test]
#[ignore = "requires MFTP_RSYNC_TEST=1, MFTP_RSYNC_TEST_KEY and the isolated SSH container"]
fn real_key_auth_uploads_through_the_formal_bridge() {
    if !enabled() {
        return;
    }
    let Ok(key_path) = std::env::var("MFTP_RSYNC_TEST_KEY") else {
        eprintln!("MFTP_RSYNC_TEST_KEY is required");
        return;
    };
    let material = AuthMaterial {
        host: HOST.into(),
        port: PORT,
        username: USER.into(),
        method: AuthMethod::Key {
            private_key: fs::read_to_string(key_path).expect("test private key"),
            passphrase: None,
        },
        identity_files: Vec::new(),
    };
    let remote_root = "/home/tester/mftp-formal-stage1-key";
    let root = std::env::temp_dir().join(format!("mftp-stage1-key-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("src")).expect("local source");
    fs::write(root.join("src/key.txt"), b"key-auth").expect("key file");
    let cleanup = Cleanup {
        root: root.clone(),
        remote_root: remote_root.into(),
        material: material.clone(),
    };

    let app = app_binary();
    TEST_HELPER_EXECUTABLE.get_or_init(|| app.clone());
    let manager = Manager::new(root.join("journal.json"));
    manager.register("stage1-key", material.clone());
    let capabilities = manager
        .rsync_capabilities("stage1-key", true)
        .expect("key capability probe");
    assert_eq!(capabilities.remote.status, RsyncStatus::Available);
    let local = manager.rsync_local_status(true);
    let local_rsync = PathBuf::from(local.path.expect("local rsync path"));
    let remote_rsync = capabilities.remote.path.expect("remote rsync path");
    let session = auth::connect(&material).expect("key session");
    run_remote(&session, &format!("mkdir -p {}", shell_quote(remote_root)));
    let target = format!("{remote_root}/target");
    let upload = manager
        .rsync_run(BridgeOptions {
            local_rsync: &local_rsync,
            remote_rsync: &remote_rsync,
            material: Arc::new(material.clone()),
            direction: RsyncDirection::Upload,
            local_dir: path_str(&root.join("src")),
            remote_dir: &target,
            delete_extraneous: false,
            dry_run: false,
            events: None,
            transfer_id: None,
            transfer: None,
            phase: "stage1-key-upload",
        })
        .expect("key-auth upload");
    assert_eq!(upload.exit_code, 0);
    assert_eq!(
        remote_output(&session, &format!("cat {target}/key.txt")),
        "key-auth"
    );
    drop(cleanup);
}

#[test]
#[ignore = "requires MFTP_RSYNC_TEST=1, MFTP_RSYNC_TEST_PASSWORD and a prepared remote state"]
fn real_capability_probe_reports_the_prepared_state() {
    if !enabled() {
        return;
    }
    let Ok(state) = std::env::var("MFTP_RSYNC_TEST_STATE") else {
        eprintln!("MFTP_RSYNC_TEST_STATE is required");
        return;
    };
    let Some(password) = password_from_env() else {
        return;
    };
    let material = AuthMaterial {
        host: HOST.into(),
        port: PORT,
        username: USER.into(),
        method: AuthMethod::Password(Some(password)),
        identity_files: Vec::new(),
    };
    let root = std::env::temp_dir().join(format!("mftp-stage1-state-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("state dir");
    let manager = Manager::new(root.join("journal.json"));
    manager.register("stage1-state", material);
    let remote = manager
        .rsync_capabilities("stage1-state", true)
        .expect("capability probe")
        .remote;
    match state.as_str() {
        "missing" => {
            assert_eq!(remote.status, RsyncStatus::Missing, "{remote:?}");
            assert!(remote.path.is_none());
        }
        "unsupported" => {
            assert_eq!(remote.status, RsyncStatus::Unsupported, "{remote:?}");
            assert_eq!(remote.version.as_deref(), Some("3.0.9"), "{remote:?}");
            assert!(remote.message.is_some());
        }
        "timeout" => {
            assert_eq!(remote.status, RsyncStatus::Timeout, "{remote:?}");
            assert!(remote.message.is_some());
        }
        other => panic!("unknown MFTP_RSYNC_TEST_STATE: {other}"),
    }
    let _ = fs::remove_dir_all(&root);
}
