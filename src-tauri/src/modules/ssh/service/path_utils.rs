use crate::error::{AppError, AppResult, CustomErrorCode};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub(super) fn uuid_v4() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(super) fn is_protected_remote_path(path: &str) -> bool {
    let trimmed = path.trim();
    trimmed.is_empty() || trimmed == "/" || trimmed == "." || trimmed == ".."
}

/// Quote an argument for a POSIX shell by wrapping in single quotes.
pub(super) fn shell_quote(s: &str) -> String {
    // Close the quote, insert an escaped single quote, reopen: ' -> '\''
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Join a remote parent dir and a name with a single "/".
pub(super) fn join_remote(parent: &str, name: &str) -> String {
    if parent.ends_with('/') {
        format!("{parent}{name}")
    } else {
        format!("{parent}/{name}")
    }
}

/// The parent directory of a remote path (POSIX, "/" separators).
pub(super) fn remote_parent_of(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) | None => "/".to_string(),
        Some(idx) => trimmed[..idx].to_string(),
    }
}

/// The final component of a remote path.
pub(super) fn remote_basename(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(idx) => trimmed[idx + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

pub(super) fn remote_temp_sibling(path: &str) -> String {
    let parent = remote_parent_of(path);
    let name = remote_basename(path);
    join_remote(&parent, &format!(".{name}.mftp-part-{}", uuid_v4()))
}

pub(super) fn local_temp_sibling(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_else(|| "download".into());
    path.with_file_name(format!(".{name}.mftp-part-{}", uuid_v4()))
}

pub(super) fn rename_local_file_overwrite(from: &Path, to: &Path) -> AppResult<()> {
    if to.is_dir() {
        return Err(
            AppError::custom(CustomErrorCode::SftpTargetIsDirectory).with_arg("path", to.display())
        );
    }
    if to.exists() {
        std::fs::remove_file(to)?;
    }
    std::fs::rename(from, to)?;
    Ok(())
}

pub(super) fn create_local_symlink_overwrite(target: &str, link: &Path) -> AppResult<()> {
    if link.is_dir() {
        return Err(AppError::custom(CustomErrorCode::SftpTargetIsDirectory)
            .with_arg("path", link.display()));
    }
    if link.exists() {
        std::fs::remove_file(link)?;
    }
    create_local_symlink(target, link)
}

#[cfg(unix)]
fn create_local_symlink(target: &str, link: &Path) -> AppResult<()> {
    std::os::unix::fs::symlink(target, link)?;
    Ok(())
}

#[cfg(windows)]
fn create_local_symlink(target: &str, link: &Path) -> AppResult<()> {
    std::os::windows::fs::symlink_file(target, link)?;
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn create_local_symlink(_target: &str, link: &Path) -> AppResult<()> {
    Err(AppError::custom(CustomErrorCode::SftpSymlinkUnsupported).with_arg("path", link.display()))
}

/// Build the shell command to extract `archive` into `dest_dir`, choosing the
/// tool by file extension.
pub(super) fn extract_cmd(archive: &str, dest_dir: &str) -> AppResult<String> {
    let lower = archive.to_lowercase();
    let a = shell_quote(archive);
    let d = shell_quote(dest_dir);
    if lower.ends_with(".zip") {
        Ok(format!("unzip -o {a} -d {d}"))
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        Ok(format!("tar -xzf {a} -C {d}"))
    } else if lower.ends_with(".tar.bz2") || lower.ends_with(".tbz2") {
        Ok(format!("tar -xjf {a} -C {d}"))
    } else if lower.ends_with(".tar") {
        Ok(format!("tar -xf {a} -C {d}"))
    } else {
        Err(AppError::custom(CustomErrorCode::SftpArchiveUnsupported))
    }
}

#[allow(dead_code)]
pub fn brief_pause() {
    std::thread::sleep(Duration::from_millis(10));
}
