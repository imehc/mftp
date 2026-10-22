//! Shared fixtures for the ignored real-transfer tests. Credentials are read
//! from test-only environment variables and never leave the isolated container.

use super::super::auth;
use super::super::path_utils::shell_quote;
use super::super::types::AuthMaterial;
use ssh2::Session;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

pub(super) const HOST: &str = "127.0.0.1";
pub(super) const PORT: u16 = 2222;
pub(super) const USER: &str = "tester";

pub(super) fn enabled() -> bool {
    std::env::var("MFTP_RSYNC_TEST").ok().as_deref() == Some("1")
}

pub(super) fn password_from_env() -> Option<String> {
    match std::env::var("MFTP_RSYNC_TEST_PASSWORD") {
        Ok(password) => Some(password),
        Err(_) => {
            eprintln!("MFTP_RSYNC_TEST_PASSWORD is required");
            None
        }
    }
}

pub(super) struct Cleanup {
    pub(super) root: PathBuf,
    pub(super) remote_root: String,
    pub(super) material: AuthMaterial,
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
        if let Ok(session) = auth::connect(&self.material) {
            let _ = exec_remote(
                &session,
                &format!("rm -rf {}", shell_quote(&self.remote_root)),
            );
        }
    }
}

pub(super) fn app_binary() -> PathBuf {
    let path = std::env::current_exe()
        .expect("test executable")
        .parent()
        .and_then(Path::parent)
        .map(|target| target.join("mftp"))
        .expect("target directory");
    assert!(
        path.is_file(),
        "build the app binary first: cargo build --bin mftp ({})",
        path.display()
    );
    path
}

pub(super) fn path_str(path: &Path) -> &str {
    path.to_str().expect("utf-8 test path")
}

pub(super) fn exec_remote(
    session: &Session,
    command: &str,
) -> Result<(i32, String, String), String> {
    let mut channel = session
        .channel_session()
        .map_err(|error| error.to_string())?;
    channel.exec(command).map_err(|error| error.to_string())?;
    let mut stdout = String::new();
    let mut stderr = String::new();
    channel
        .read_to_string(&mut stdout)
        .map_err(|error| error.to_string())?;
    channel
        .stderr()
        .read_to_string(&mut stderr)
        .map_err(|error| error.to_string())?;
    channel.wait_close().map_err(|error| error.to_string())?;
    let code = channel.exit_status().map_err(|error| error.to_string())?;
    Ok((code, stdout, stderr))
}

pub(super) fn run_remote(session: &Session, command: &str) {
    let (code, stdout, stderr) = exec_remote(session, command).expect("remote command");
    assert_eq!(code, 0, "command failed: {command}\n{stdout}\n{stderr}");
}

pub(super) fn remote_output(session: &Session, command: &str) -> String {
    let (code, stdout, stderr) = exec_remote(session, command).expect("remote command");
    assert_eq!(code, 0, "command failed: {command}\n{stdout}\n{stderr}");
    stdout.trim().to_string()
}

pub(super) fn leftover_helpers() -> bool {
    std::process::Command::new("pgrep")
        .args(["-f", "mftp-rsync-bridge"])
        .output()
        .is_ok_and(|output| output.status.success())
}

pub(super) fn task_directories_exist() -> bool {
    let mut bases = vec![std::env::temp_dir(), PathBuf::from("/tmp")];
    bases.dedup();
    bases.iter().any(|base| {
        fs::read_dir(base).is_ok_and(|entries| {
            entries.flatten().any(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                name.starts_with("mftp-rsync-") && name.len() == 23
            })
        })
    })
}
