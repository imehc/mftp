use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::{Read, Seek, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, UNIX_EPOCH};

use rusqlite::{limits::Limit, Connection, OpenFlags};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult, CustomErrorCode};

const MAX_BYTES: u64 = 512 * 1024 * 1024;
const MAX_TIME: Duration = Duration::from_secs(30);

pub(super) fn run<T>(
    connection: &Connection,
    cancel: &AtomicBool,
    operation: impl FnOnce() -> AppResult<T>,
) -> AppResult<T> {
    check(cancel, Instant::now())?;
    let interrupt = connection.get_interrupt_handle();
    let timed_out = AtomicBool::new(false);
    std::thread::scope(|scope| {
        let (done, receive) = std::sync::mpsc::channel();
        let timeout = &timed_out;
        let worker = std::thread::Builder::new()
            .name("agent-sqlite-cancel".into())
            .spawn_scoped(scope, move || {
                let start = Instant::now();
                loop {
                    match receive.recv_timeout(Duration::from_millis(20)) {
                        Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    if start.elapsed() > MAX_TIME {
                        timeout.store(true, Ordering::Release);
                    }
                    if cancel.load(Ordering::Acquire) || timeout.load(Ordering::Acquire) {
                        interrupt.interrupt();
                    }
                }
            })?;
        let result = operation();
        let _ = done.send(());
        worker
            .join()
            .map_err(|_| error(CustomErrorCode::AgentSessionRead))?;
        if cancel.load(Ordering::Acquire) {
            return Err(error(CustomErrorCode::AgentSessionCancelled));
        }
        if timed_out.load(Ordering::Acquire) {
            return Err(error(CustomErrorCode::AgentSessionLimit));
        }
        result.map_err(|cause| {
            if cause.code == "db:sqlite"
                && cause
                    .args
                    .get("sourceCode")
                    .and_then(|value| value.parse::<i32>().ok())
                    .is_some_and(|value| value & 0xff == rusqlite::ffi::SQLITE_TOOBIG)
            {
                error(CustomErrorCode::AgentSessionLimit)
            } else {
                cause
            }
        })
    })
}

pub(super) struct Snapshot {
    connection: Connection,
    _directory: PrivateDirectory,
    revision: String,
}

struct PrivateDirectory(PathBuf);

impl PrivateDirectory {
    fn create() -> AppResult<Self> {
        let path = std::env::temp_dir().join(format!("mftp-agent-sqlite-{}", uuid::Uuid::new_v4()));
        DirBuilder::new().mode(0o700).create(&path)?;
        Ok(Self(path))
    }
}

impl Drop for PrivateDirectory {
    fn drop(&mut self) {
        // This owned UUID directory contains only our snapshot, never a source.
        if let Err(error) = fs::remove_dir_all(&self.0) {
            crate::runtime_log!("Agent SQLite snapshot cleanup failed: {:?}", error.kind());
        }
    }
}

fn error(code: CustomErrorCode) -> AppError {
    AppError::custom(code)
}

fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

fn stamp(path: &Path, header: usize, digest: &mut Sha256) -> AppResult<(u64, f64)> {
    let mut file = File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err(error(CustomErrorCode::AgentSessionLimit));
    }
    let modified = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    digest.update(format!(
        "{}:{}:{}:{}:{}:{}",
        metadata.dev(),
        metadata.ino(),
        metadata.len(),
        modified.as_nanos(),
        metadata.ctime(),
        metadata.ctime_nsec()
    ));
    let mut bytes = vec![0; header.min(metadata.len() as usize)];
    file.read_exact(&mut bytes)?;
    digest.update(&bytes);
    Ok((metadata.len(), modified.as_secs_f64() * 1000.0))
}

pub(super) fn fingerprint(path: &Path) -> AppResult<(String, f64)> {
    let mut digest = Sha256::new();
    let (mut total, mut modified) = stamp(path, 100, &mut digest)?;
    for (suffix, header) in [("-wal", 32), ("-journal", 32)] {
        let path = sidecar(path, suffix);
        match fs::symlink_metadata(&path) {
            Ok(_) => {
                digest.update(suffix);
                let (size, timestamp) = stamp(&path, header, &mut digest)?;
                total = total.saturating_add(size);
                modified = modified.max(timestamp);
                // A live rollback journal cannot be recovered without copying
                // its complete transaction. Retry after the source settles.
                if suffix == "-journal" && size > 0 {
                    return Err(error(CustomErrorCode::AgentSessionChanged));
                }
            }
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {
                digest.update(suffix.as_bytes())
            }
            Err(cause) => return Err(cause.into()),
        }
    }
    if total > MAX_BYTES {
        return Err(error(CustomErrorCode::AgentSessionLimit));
    }
    let revision = digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok((revision, modified))
}

fn content_headers(path: &Path) -> AppResult<String> {
    let mut digest = Sha256::new();
    for (path, header) in [(path.to_owned(), 100), (sidecar(path, "-wal"), 32)] {
        let mut file = match File::open(&path) {
            Ok(file) => file,
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {
                digest.update(b"absent");
                continue;
            }
            Err(cause) => return Err(cause.into()),
        };
        let length = file.metadata()?.len();
        digest.update(length.to_be_bytes());
        let mut bytes = vec![0; header.min(length as usize)];
        file.read_exact(&mut bytes)?;
        digest.update(bytes);
    }
    Ok(super::revision::hex(&digest.finalize()))
}

fn check(cancel: &AtomicBool, start: Instant) -> AppResult<()> {
    if cancel.load(Ordering::Acquire) {
        return Err(error(CustomErrorCode::AgentSessionCancelled));
    }
    if start.elapsed() > MAX_TIME {
        return Err(error(CustomErrorCode::AgentSessionLimit));
    }
    Ok(())
}

fn copy(source: &Path, destination: &Path, cancel: &AtomicBool, start: Instant) -> AppResult<()> {
    let mut input = File::open(source)?;
    let length = input.metadata()?.len();
    if length > MAX_BYTES {
        return Err(error(CustomErrorCode::AgentSessionLimit));
    }
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(destination)?;
    let mut remaining = length;
    let mut buffer = [0; 64 * 1024];
    while remaining > 0 {
        check(cancel, start)?;
        let available = remaining.min(buffer.len() as u64) as usize;
        let count = input.read(&mut buffer[..available])?;
        if count == 0 {
            return Err(error(CustomErrorCode::AgentSessionChanged));
        }
        output.write_all(&buffer[..count])?;
        remaining -= count as u64;
    }
    output.flush()?;
    Ok(())
}

fn word(bytes: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn checksum(bytes: &[u8], little: bool, mut sums: [u32; 2]) -> [u32; 2] {
    for words in bytes.as_chunks::<8>().0 {
        let read = |offset: usize| {
            let bytes = [
                words[offset],
                words[offset + 1],
                words[offset + 2],
                words[offset + 3],
            ];
            if little {
                u32::from_le_bytes(bytes)
            } else {
                u32::from_be_bytes(bytes)
            }
        };
        sums[0] = sums[0].wrapping_add(read(0)).wrapping_add(sums[1]);
        sums[1] = sums[1].wrapping_add(read(4)).wrapping_add(sums[0]);
    }
    sums
}

fn validate(path: &Path, cancel: &AtomicBool, start: Instant) -> AppResult<()> {
    let mut header = [0; 100];
    File::open(path)?
        .read_exact(&mut header)
        .map_err(|_| error(CustomErrorCode::AgentSessionFormat))?;
    let encoded_size = u16::from_be_bytes([header[16], header[17]]);
    let page_size = if encoded_size == 1 {
        65536
    } else {
        u32::from(encoded_size)
    };
    if &header[..16] != b"SQLite format 3\0"
        || !(512..=65536).contains(&page_size)
        || !page_size.is_power_of_two()
    {
        return Err(error(CustomErrorCode::AgentSessionFormat));
    }
    let wal_path = sidecar(path, "-wal");
    let mut wal = match OpenOptions::new().read(true).write(true).open(&wal_path) {
        Ok(file) => file,
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(cause) => return Err(cause.into()),
    };
    let length = wal.metadata()?.len();
    if length == 0 {
        return Ok(());
    }
    let frame_size = u64::from(page_size) + 24;
    if length < 32 {
        return Err(error(CustomErrorCode::AgentSessionChanged));
    }
    let mut wal_header = [0; 32];
    wal.read_exact(&mut wal_header)?;
    let magic = word(&wal_header, 0);
    if !matches!(magic, 0x377f0682 | 0x377f0683)
        || word(&wal_header, 4) != 3007000
        || word(&wal_header, 8) != page_size
    {
        return Err(error(CustomErrorCode::AgentSessionFormat));
    }
    let little = magic == 0x377f0682;
    let mut sums = checksum(&wal_header[..24], little, [0; 2]);
    if sums != [word(&wal_header, 24), word(&wal_header, 28)] {
        return Err(error(CustomErrorCode::AgentSessionFormat));
    }
    let mut frame = vec![0; frame_size as usize];
    let mut committed_length = 32;
    for _ in 0..(length - 32) / frame_size {
        check(cancel, start)?;
        wal.read_exact(&mut frame)?;
        if frame[8..16] != wal_header[16..24] {
            // WAL restart reuses the file without truncating old generations.
            // SQLite ignores that physical tail; retain the committed prefix.
            break;
        }
        if word(&frame, 0) == 0 {
            return Err(error(CustomErrorCode::AgentSessionChanged));
        }
        sums = checksum(&frame[..8], little, sums);
        sums = checksum(&frame[24..], little, sums);
        if sums != [word(&frame, 16), word(&frame, 20)] {
            return Err(error(CustomErrorCode::AgentSessionFormat));
        }
        if word(&frame, 4) != 0 {
            committed_length = wal.stream_position()?;
        }
    }
    wal.set_len(committed_length)?;
    Ok(())
}

impl Snapshot {
    pub(super) fn open(path: &Path, cancel: &AtomicBool) -> AppResult<Self> {
        Self::open_inner(path, cancel, |_| Ok(()))
    }

    fn open_inner(
        path: &Path,
        cancel: &AtomicBool,
        between_copies: impl FnOnce(&Path) -> AppResult<()>,
    ) -> AppResult<Self> {
        let start = Instant::now();
        check(cancel, start)?;
        let (revision, _) = fingerprint(path)?;
        let headers = content_headers(path)?;
        let directory = PrivateDirectory::create()?;
        let copied = directory.0.join("snapshot.sqlite");
        copy(path, &copied, cancel, start)?;
        between_copies(&copied)?;
        let wal = sidecar(path, "-wal");
        match fs::symlink_metadata(&wal) {
            Ok(_) => copy(&wal, &sidecar(&copied, "-wal"), cancel, start)?,
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {}
            Err(cause) => return Err(cause.into()),
        }
        if fingerprint(path)?.0 != revision || content_headers(&copied)? != headers {
            return Err(error(CustomErrorCode::AgentSessionChanged));
        }
        validate(&copied, cancel, start)?;
        check(cancel, start)?;
        // SQLite may create SHM or recover WAL only inside this private copy.
        let connection = Connection::open_with_flags(
            &copied,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|_| error(CustomErrorCode::AgentSessionFormat))?;
        connection.set_limit(Limit::SQLITE_LIMIT_LENGTH, 32 * 1024 * 1024)?;
        connection.busy_timeout(Duration::from_millis(250))?;
        connection
            .execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-8192; BEGIN DEFERRED")?;
        let result: String = run(&connection, cancel, || {
            connection
                .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
                .map_err(|cause| {
                    error(
                        if cause.sqlite_error_code() == Some(rusqlite::ErrorCode::TooBig) {
                            CustomErrorCode::AgentSessionLimit
                        } else {
                            CustomErrorCode::AgentSessionFormat
                        },
                    )
                })
        })?;
        if result != "ok" {
            return Err(error(CustomErrorCode::AgentSessionFormat));
        }
        check(cancel, start)?;
        Ok(Self {
            connection,
            _directory: directory,
            revision,
        })
    }

    pub(super) fn revision(&self) -> &str {
        &self.revision
    }

    pub(super) fn connection(&self) -> &Connection {
        &self.connection
    }

    #[cfg(test)]
    pub(super) fn directory(&self) -> &Path {
        &self._directory.0
    }

    #[cfg(test)]
    pub(super) fn open_between_copies(
        path: &Path,
        cancel: &AtomicBool,
        hook: impl FnOnce(&Path) -> AppResult<()>,
    ) -> AppResult<Self> {
        Self::open_inner(path, cancel, hook)
    }
}
