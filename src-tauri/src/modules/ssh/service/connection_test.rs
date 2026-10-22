use super::auth::connect;
use super::diagnostics::{call, unit};
use super::logged_sftp::LoggedSftp;
use super::types::AuthMaterial;
use crate::error::AppResult;
use crate::modules::ssh::SshConnectionTest;
use serde_json::json;
use std::path::Path;
use std::time::Instant;

/// Ephemeral end-to-end check for an unsaved host configuration: authenticate,
/// open the SFTP subsystem and read the login directory. The session is dropped
/// on return, so no auth material, cache or registered session outlives the
/// test. Protocol calls reuse the shared execution-log points.
pub(crate) fn test_connection(material: &AuthMaterial) -> AppResult<SshConnectionTest> {
    let started = Instant::now();
    let session = connect(material)?;
    let sftp = call("ssh.sftp", json!({}), || session.sftp(), unit)?;
    let sftp = LoggedSftp::new(sftp);
    let home = sftp.realpath(Path::new("."))?;
    let elapsed = started.elapsed().as_millis();
    Ok(SshConnectionTest {
        host: material.host.clone(),
        port: material.port,
        username: material.username.clone(),
        home: home.to_string_lossy().into_owned(),
        latency_ms: u32::try_from(elapsed).unwrap_or(u32::MAX),
    })
}
