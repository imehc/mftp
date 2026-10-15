use super::diagnostics::{call, path, stat, unit};
use super::logged_file::LoggedFile;
use serde_json::json;
use ssh2::{Error, FileStat, OpenFlags, OpenType, RenameFlags, Sftp};
use std::path::{Path, PathBuf};

// A thin SDK boundary: results/errors are returned unchanged. No retries,
// credential lookup, lifecycle decisions or file-content capture happen here.
pub(super) struct LoggedSftp(Sftp);

impl LoggedSftp {
    pub(super) fn new(sftp: Sftp) -> Self {
        Self(sftp)
    }
    pub(super) fn realpath(&self, value: &Path) -> Result<PathBuf, Error> {
        call(
            "sftp.realpath",
            json!({"path":path(value)}),
            || self.0.realpath(value),
            |value| path(value),
        )
    }
    pub(super) fn readlink(&self, value: &Path) -> Result<PathBuf, Error> {
        call(
            "sftp.readlink",
            json!({"path":path(value)}),
            || self.0.readlink(value),
            |value| path(value),
        )
    }
    pub(super) fn stat(&self, value: &Path) -> Result<FileStat, Error> {
        call(
            "sftp.stat",
            json!({"path":path(value)}),
            || self.0.stat(value),
            stat,
        )
    }
    pub(super) fn lstat(&self, value: &Path) -> Result<FileStat, Error> {
        call(
            "sftp.lstat",
            json!({"path":path(value)}),
            || self.0.lstat(value),
            stat,
        )
    }
    pub(super) fn readdir(&self, value: &Path) -> Result<Vec<(PathBuf, FileStat)>, Error> {
        call(
            "sftp.readdir",
            json!({"path":path(value)}),
            || self.0.readdir(value),
            |entries| json!({"entries":entries.iter().take(128).map(|(p,s)| json!({"path":path(p),"stat":stat(s)})).collect::<Vec<_>>(), "entriesOmitted":entries.len().saturating_sub(128)}),
        )
    }
    pub(super) fn mkdir(&self, value: &Path, mode: i32) -> Result<(), Error> {
        call(
            "sftp.mkdir",
            json!({"path":path(value),"mode":mode}),
            || self.0.mkdir(value, mode),
            unit,
        )
    }
    pub(super) fn rmdir(&self, value: &Path) -> Result<(), Error> {
        call(
            "sftp.rmdir",
            json!({"path":path(value)}),
            || self.0.rmdir(value),
            unit,
        )
    }
    pub(super) fn unlink(&self, value: &Path) -> Result<(), Error> {
        call(
            "sftp.unlink",
            json!({"path":path(value)}),
            || self.0.unlink(value),
            unit,
        )
    }
    pub(super) fn rename(
        &self,
        from: &Path,
        to: &Path,
        flags: Option<RenameFlags>,
    ) -> Result<(), Error> {
        call(
            "sftp.rename",
            json!({"from":path(from),"to":path(to),"flags":flags.map(|flags|flags.bits())}),
            || self.0.rename(from, to, flags),
            unit,
        )
    }
    pub(super) fn symlink(&self, target: &Path, link: &Path) -> Result<(), Error> {
        call(
            "sftp.symlink",
            json!({"target":path(target),"link":path(link)}),
            || self.0.symlink(target, link),
            unit,
        )
    }
    pub(super) fn open_mode(
        &self,
        value: &Path,
        flags: OpenFlags,
        mode: i32,
        kind: OpenType,
    ) -> Result<LoggedFile, Error> {
        call(
            "sftp.open",
            json!({"path":path(value),"flags":flags.bits(),"mode":mode,"type":match kind { OpenType::File => "file", OpenType::Dir => "directory" }}),
            || self.0.open_mode(value, flags, mode, kind),
            unit,
        )
        .map(|file| LoggedFile::new(file, value.to_owned()))
    }
    pub(super) fn open(&self, value: &Path) -> Result<LoggedFile, Error> {
        self.open_mode(value, OpenFlags::READ, 0o644, OpenType::File)
    }
    pub(super) fn create(&self, value: &Path) -> Result<LoggedFile, Error> {
        self.open_mode(
            value,
            OpenFlags::WRITE | OpenFlags::TRUNCATE,
            0o644,
            OpenType::File,
        )
    }
}
