use std::collections::{HashMap, HashSet};
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use super::discovery::Candidate;
use super::model::*;
use crate::error::{AppError, AppResult, CustomErrorCode};

const MAX_FILES: usize = 100_000;
const MAX_TIME: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub(super) struct StorageResource {
    pub summary: AgentSessionSummary,
    pub resource: Candidate,
    pub complete: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

#[derive(Clone, Copy)]
struct FileSize {
    identity: FileIdentity,
    bytes: u64,
    allocated_bytes: u64,
}

#[derive(Default)]
struct SourceSize {
    bytes: u64,
    allocated_bytes: u64,
    incomplete: bool,
}

pub(super) fn snapshot(
    generation: &str,
    sources: &[SessionSource],
    resources: &[StorageResource],
    cancel: &AtomicBool,
) -> AppResult<AgentSessionStorage> {
    let started = Instant::now();
    let mut counted = HashSet::new();
    let mut totals: HashMap<SessionAgent, SourceSize> = HashMap::new();
    let mut items = Vec::with_capacity(resources.len());
    let mut file_count = 0;
    for entry in resources {
        check_budget(cancel, &started, file_count)?;
        let source = totals.entry(entry.summary.agent).or_default();
        source.incomplete |= !entry.complete;
        let paths = resource_paths(entry, cancel);
        let mut owned_bytes = 0_u64;
        let mut owned_allocated = 0_u64;
        let mut owned_files = HashSet::new();
        let mut measured = paths.is_ok();
        match paths {
            Ok((owned, shared)) => {
                for (path, is_owned) in owned
                    .iter()
                    .map(|path| (path, true))
                    .chain(shared.iter().map(|path| (path, false)))
                {
                    check_budget(cancel, &started, file_count)?;
                    file_count += 1;
                    match measure(path) {
                        Ok(size) => {
                            if counted.insert(size.identity) {
                                source.bytes = source.bytes.saturating_add(size.bytes);
                                source.allocated_bytes =
                                    source.allocated_bytes.saturating_add(size.allocated_bytes);
                            }
                            if is_owned && owned_files.insert(size.identity) {
                                owned_bytes = owned_bytes.saturating_add(size.bytes);
                                owned_allocated =
                                    owned_allocated.saturating_add(size.allocated_bytes);
                            }
                        }
                        Err(_) => {
                            measured = false;
                            source.incomplete = true;
                        }
                    }
                }
            }
            Err(error) if error.code == CustomErrorCode::AgentSessionCancelled.as_str() => {
                return Err(error)
            }
            Err(_) => source.incomplete = true,
        }
        // A shared SQLite file cannot be divided into per-session sizes.
        // Its main file and WAL are counted only in the source total.
        let known = measured
            && !matches!(
                entry.summary.agent,
                SessionAgent::Opencode | SessionAgent::Qoder
            );
        items.push(AgentSessionStorageItem {
            key: entry.summary.key.clone(),
            bytes: known.then_some(owned_bytes as f64),
            allocated_bytes: known.then_some(owned_allocated as f64),
        });
    }
    let sources: Vec<_> = sources
        .iter()
        .map(|source| {
            let total = totals.remove(&source.agent).unwrap_or_default();
            AgentSessionStorageSource {
                agent: source.agent,
                bytes: total.bytes as f64,
                allocated_bytes: total.allocated_bytes as f64,
                complete: !total.incomplete,
            }
        })
        .collect();
    let complete = sources.iter().all(|source| source.complete);
    Ok(AgentSessionStorage {
        generation: generation.to_owned(),
        sources,
        items,
        complete,
    })
}

fn resource_paths(
    entry: &StorageResource,
    cancel: &AtomicBool,
) -> AppResult<(Vec<PathBuf>, Vec<PathBuf>)> {
    match entry.summary.agent {
        SessionAgent::Opencode | SessionAgent::Qoder => {
            Ok((Vec::new(), database_paths(&entry.resource.path)?))
        }
        SessionAgent::Codebuddy => {
            let mut owned = vec![entry.resource.path.clone()];
            owned.extend(super::codebuddy::ordered_paths(
                &entry.resource.path,
                cancel,
            )?);
            let shared = entry
                .resource
                .codebuddy
                .as_ref()
                .map(|metadata| database_paths(&metadata.database))
                .transpose()?
                .unwrap_or_default();
            Ok((owned, shared))
        }
        _ => Ok((vec![entry.resource.path.clone()], Vec::new())),
    }
}

fn database_paths(path: &Path) -> AppResult<Vec<PathBuf>> {
    let mut paths = vec![path.to_owned()];
    let mut wal = path.as_os_str().to_os_string();
    wal.push("-wal");
    let wal = PathBuf::from(wal);
    match fs::symlink_metadata(&wal) {
        Ok(_) => paths.push(wal),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    Ok(paths)
}

fn measure(path: &Path) -> AppResult<FileSize> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || path.canonicalize()? != path {
        return Err(AppError::custom(CustomErrorCode::AgentSessionRead));
    }
    Ok(FileSize {
        identity: FileIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
        },
        bytes: metadata.len(),
        allocated_bytes: metadata.blocks().saturating_mul(512),
    })
}

fn check_budget(cancel: &AtomicBool, started: &Instant, count: usize) -> AppResult<()> {
    if cancel.load(Ordering::Acquire) {
        Err(AppError::custom(CustomErrorCode::AgentSessionCancelled))
    } else if started.elapsed() > MAX_TIME || count >= MAX_FILES {
        Err(AppError::custom(CustomErrorCode::AgentSessionLimit))
    } else {
        Ok(())
    }
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;
