//! Stage 2 acceptance: dry-run preview, delete policy, incremental sync,
//! block-level delta and cancellation. Ignored by default like the stage 1
//! tests; it needs `MFTP_RSYNC_TEST=1`, the isolated SSH container and a built
//! app binary.

use super::super::auth;
use super::super::path_utils::shell_quote;
use super::super::types::{AuthMaterial, AuthMethod, Manager};
use super::bridge::TEST_HELPER_EXECUTABLE;
use super::real_test_support::{
    app_binary, enabled, exec_remote, leftover_helpers, password_from_env, path_str, remote_output,
    run_remote, task_directories_exist, Cleanup, HOST, PORT, USER,
};
use crate::modules::ssh::{RsyncChangeKind, RsyncDirection, RsyncStatus};
use ssh2::Session;
use std::fs;
use std::time::Duration;

const REMOTE_ROOT: &str = "/home/tester/mftp-formal-stage2";

#[test]
#[ignore = "requires MFTP_RSYNC_TEST=1, the isolated SSH container and a built app binary"]
fn real_preview_sync_delete_incremental_and_delta() {
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
    let root = std::env::temp_dir().join(format!("mftp-stage2-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let source = root.join("src");
    fs::create_dir_all(source.join("nested")).expect("local source");
    fs::write(source.join("alpha.txt"), b"alpha-content-stage2").expect("alpha");
    fs::write(source.join("nested/beta.txt"), b"beta-content").expect("beta");
    fs::write(source.join("中文 空格.txt"), b"unicode-content").expect("unicode");
    fs::write(source.join("-lead 'q'.txt"), b"leading-dash").expect("leading dash");
    std::os::unix::fs::symlink("alpha.txt", source.join("link-to-alpha")).expect("symlink");
    let cleanup = Cleanup {
        root: root.clone(),
        remote_root: REMOTE_ROOT.into(),
        material: material.clone(),
    };

    let app = app_binary();
    TEST_HELPER_EXECUTABLE.get_or_init(|| app.clone());
    let manager = Manager::new(root.join("journal.json"));
    manager.register("stage2", material.clone());
    let capabilities = manager
        .rsync_capabilities("stage2", true)
        .expect("capability probe");
    assert_eq!(capabilities.local.status, RsyncStatus::Available);
    assert_eq!(capabilities.remote.status, RsyncStatus::Available);

    let session = auth::connect(&material).expect("remote setup session");
    session.set_timeout(10_000);
    let target = format!("{REMOTE_ROOT}/target");
    let outside = format!("{REMOTE_ROOT}/outside/keep.txt");
    run_remote(
        &session,
        &format!(
            "rm -rf {root} && mkdir -p {target}/extra-dir {outside_dir} && \
             printf old > {target}/alpha.txt && printf extra > {target}/extra.txt && \
             printf child > {target}/extra-dir/child.txt && printf keep > {outside}",
            root = shell_quote(REMOTE_ROOT),
            target = shell_quote(&target),
            outside_dir = shell_quote(&format!("{REMOTE_ROOT}/outside")),
            outside = shell_quote(&outside),
        ),
    );

    let source_dir = path_str(&source);
    let keep_preview = manager
        .rsync_preview("stage2", RsyncDirection::Upload, source_dir, &target, false)
        .expect("preview without delete");
    assert_eq!(keep_preview.deleted, 0, "{keep_preview:?}");
    assert!(keep_preview.added >= 4, "{keep_preview:?}");
    assert!(keep_preview.updated >= 1, "{keep_preview:?}");
    assert!(!keep_preview.truncated);
    assert!(keep_preview
        .items
        .iter()
        .any(|item| item.path == "nested" && item.is_dir));
    assert!(keep_preview
        .items
        .iter()
        .any(|item| item.kind == RsyncChangeKind::Updated && item.path == "alpha.txt"));
    assert!(remote_exists(&session, &format!("{target}/extra.txt")));
    assert_eq!(
        remote_output(&session, &format!("cat {}/alpha.txt", shell_quote(&target))),
        "old",
        "dry-run must not modify the target"
    );

    let delete_preview = manager
        .rsync_preview("stage2", RsyncDirection::Upload, source_dir, &target, true)
        .expect("preview with delete");
    assert!(delete_preview.deleted >= 3, "{delete_preview:?}");
    assert!(delete_preview.items.iter().any(|item| {
        item.kind == RsyncChangeKind::Deleted && item.path == "extra.txt" && !item.is_dir
    }));
    assert!(delete_preview.items.iter().any(|item| {
        item.kind == RsyncChangeKind::Deleted && item.path == "extra-dir" && item.is_dir
    }));
    assert!(remote_exists(
        &session,
        &format!("{target}/extra-dir/child.txt")
    ));

    let result = manager
        .rsync_transfer(
            "stage2",
            &delete_preview.token,
            RsyncDirection::Upload,
            source_dir,
            &target,
            true,
            None,
            Some("stage2-transfer"),
        )
        .expect("sync with delete");
    assert_eq!(result.exit_code, 0);
    assert!(result.changed_items >= 4, "{result:?}");
    assert!(result.transferred_bytes > 0);
    assert_eq!(
        remote_output(&session, &format!("cat {}/alpha.txt", shell_quote(&target))),
        "alpha-content-stage2"
    );
    assert_eq!(
        remote_output(
            &session,
            &format!("cat {}/nested/beta.txt", shell_quote(&target))
        ),
        "beta-content"
    );
    assert_eq!(
        remote_output(
            &session,
            &format!("cat {}", shell_quote(&format!("{target}/中文 空格.txt")))
        ),
        "unicode-content"
    );
    assert_eq!(
        remote_output(
            &session,
            &format!("cat -- {}", shell_quote(&format!("{target}/-lead 'q'.txt")))
        ),
        "leading-dash"
    );
    assert_eq!(
        remote_output(
            &session,
            &format!("readlink {}/link-to-alpha", shell_quote(&target))
        ),
        "alpha.txt"
    );
    assert!(!remote_exists(&session, &format!("{target}/extra.txt")));
    assert!(!remote_exists(&session, &format!("{target}/extra-dir")));
    assert_eq!(
        remote_output(&session, &format!("cat {}", shell_quote(&outside))),
        "keep",
        "delete must stay inside the selected target"
    );

    let unchanged = manager
        .rsync_preview("stage2", RsyncDirection::Upload, source_dir, &target, true)
        .expect("unchanged preview");
    assert_eq!(unchanged.added, 0, "{unchanged:?}");
    assert_eq!(unchanged.updated, 0, "{unchanged:?}");
    assert_eq!(unchanged.deleted, 0, "{unchanged:?}");
    let unchanged_result = manager
        .rsync_transfer(
            "stage2",
            &unchanged.token,
            RsyncDirection::Upload,
            source_dir,
            &target,
            true,
            None,
            None,
        )
        .expect("unchanged sync");
    assert_eq!(unchanged_result.changed_items, 0);
    assert_eq!(unchanged_result.transferred_bytes, 0);

    let big = source.join("large.bin");
    fs::write(&big, random_bytes(4 * 1024 * 1024, 7)).expect("large file");
    sync_once(&manager, source_dir, &target, "stage2-large-initial");
    std::thread::sleep(Duration::from_millis(1100));
    let mut changed = fs::read(&big).expect("large file");
    changed[2 * 1024 * 1024] ^= 0xff;
    fs::write(&big, &changed).expect("large file change");

    let delta_preview = manager
        .rsync_preview("stage2", RsyncDirection::Upload, source_dir, &target, true)
        .expect("delta preview");
    assert!(delta_preview
        .items
        .iter()
        .any(|item| item.kind == RsyncChangeKind::Updated && item.path == "large.bin"));
    let delta = manager
        .rsync_transfer(
            "stage2",
            &delta_preview.token,
            RsyncDirection::Upload,
            source_dir,
            &target,
            true,
            None,
            None,
        )
        .expect("delta sync");
    assert!(
        delta.network_bytes < 1024 * 1024,
        "the 4 MiB file should use block deltas: {delta:?}"
    );
    assert!(
        delta.transferred_bytes >= 4 * 1024 * 1024,
        "progress2 reports logical file bytes: {delta:?}"
    );

    run_remote(
        &session,
        &format!(
            "printf sentinel > {}/cancel-sentinel.txt",
            shell_quote(&target)
        ),
    );
    fs::write(source.join("cancel.txt"), b"cancel-new").expect("cancel file");
    let cancel_preview = manager
        .rsync_preview("stage2", RsyncDirection::Upload, source_dir, &target, true)
        .expect("cancel preview");
    manager.cancel_transfer("stage2-cancel");
    let error = manager
        .rsync_transfer(
            "stage2",
            &cancel_preview.token,
            RsyncDirection::Upload,
            source_dir,
            &target,
            true,
            None,
            Some("stage2-cancel"),
        )
        .expect_err("cancelled transfer must fail");
    assert_eq!(error.code, "sftp:transfer_cancelled");
    assert!(
        remote_exists(&session, &format!("{target}/cancel-sentinel.txt")),
        "cancellation must keep existing target data"
    );
    assert!(!remote_exists(&session, &format!("{target}/cancel.txt")));

    std::thread::sleep(Duration::from_millis(200));
    assert!(!leftover_helpers(), "the rsync helper outlived the task");
    assert!(
        !task_directories_exist(),
        "the task directory was not removed"
    );
    drop(cleanup);
}

fn sync_once(manager: &Manager, source: &str, target: &str, transfer_id: &str) {
    let preview = manager
        .rsync_preview("stage2", RsyncDirection::Upload, source, target, true)
        .expect("preview");
    let result = manager
        .rsync_transfer(
            "stage2",
            &preview.token,
            RsyncDirection::Upload,
            source,
            target,
            true,
            None,
            Some(transfer_id),
        )
        .expect("sync");
    assert_eq!(result.exit_code, 0);
}

fn random_bytes(len: usize, seed: u64) -> Vec<u8> {
    let mut state = seed;
    let mut output = Vec::with_capacity(len);
    for _ in 0..len {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        output.push((state >> 33) as u8);
    }
    output
}

fn remote_exists(session: &Session, path: &str) -> bool {
    let (code, _, stderr) =
        exec_remote(session, &format!("test -e {}", shell_quote(path))).expect("remote test");
    if code != 0 && !stderr.is_empty() {
        panic!("remote test failed for {path}: {stderr}");
    }
    code == 0
}
