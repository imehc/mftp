//! GitHub access for the download channels: the blocking client, the commit
//! sha of a source, the repository tree listing, the per-file fetches that let
//! a collection be pulled without its whole source tarball, and the
//! `downloading` progress event both channels report with.
//!
//! Files are fetched from `raw.githubusercontent.com` rather than the blob
//! API: the API allows 60 unauthenticated requests per hour, which cannot
//! cover a single large collection (全宋诗 needs 255 files) and forced every
//! such sync back to the whole tarball.
//!
//! The same file-level channel is used by desktop and mobile builds.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use serde_json::Value;

use super::ingest::glob_match;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::poetry::catalog::Catalog;
use crate::modules::poetry::catalog::SourceSpec;
use crate::modules::poetry::model::PoetrySyncProgress;

use super::ProgressFn;

/// Every `downloading` event carries the same shape; only the byte counters
/// vary. Shared by the tarball and blob channels so the UI sees one format.
pub(super) fn download_progress(bytes_done: u64, bytes_total: Option<u64>) -> PoetrySyncProgress {
    PoetrySyncProgress {
        collection_id: "download".into(),
        phase: "downloading".into(),
        bytes_done,
        bytes_total,
        imported: 0,
        total: None,
        error: None,
    }
}

/// Resolve the current commit sha of every source referenced by `ids`.
pub(super) fn fetch_source_sha(catalog: &Catalog, source_id: &str) -> AppResult<String> {
    let Some(spec) = catalog.sources.get(source_id) else {
        return Err(
            AppError::custom(CustomErrorCode::PoetrySourceUnknown).with_arg("sourceId", source_id)
        );
    };
    let url = format!(
        "https://api.github.com/repos/{}/commits/{}",
        spec.repo, spec.branch
    );
    // The centralized reqwest adapter keeps provider diagnostics category-only;
    // request URLs and error chains may embed tokens and never pass through.
    let value: Value = api_client()?
        .get(url)
        .send()
        .map_err(|error| AppError::from(error).context("fetch upstream sha"))?
        .json()
        .map_err(|error| AppError::from(error).context("decode commit info"))?;
    value
        .get("sha")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| AppError::custom(CustomErrorCode::PoetryUpstreamResponseInvalid))
}

/// Best-effort upstream commit sha; a flaky API must never block importing
/// data that has already been downloaded.
pub(super) fn resolve_source_sha(catalog: &Catalog, source_id: &str) -> String {
    fetch_source_sha(catalog, source_id).unwrap_or_else(|_| {
        format!(
            "snapshot-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_secs())
                .unwrap_or(0)
        )
    })
}

/// One pooled client for every GitHub API call, so lookups and blob downloads
/// reuse TLS connections instead of handshaking per request.
fn api_client() -> AppResult<reqwest::blocking::Client> {
    static CLIENT: std::sync::OnceLock<reqwest::blocking::Client> = std::sync::OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(60))
        .user_agent("mftp-library-sync")
        .build()
        .map_err(AppError::from)?;
    Ok(CLIENT.get_or_init(|| client).clone())
}

/// Concurrent blob downloads; small enough to stay polite to the API.
const BLOB_WORKERS: usize = 6;

/// A file entry from the git tree API. `size` is absent for directories.
/// The entry `sha` is unused now that files come from `raw.githubusercontent`
/// by path; serde simply ignores it.
#[derive(serde::Deserialize)]
struct TreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    size: u64,
}

#[derive(serde::Deserialize)]
struct TreeResponse {
    #[serde(default)]
    tree: Vec<TreeEntry>,
    #[serde(default)]
    truncated: bool,
}

/// One request returns every path in the repository, which is what lets us
/// pull only the blobs a collection needs instead of the whole tarball.
fn fetch_source_tree(repo: &str, branch: &str) -> AppResult<Vec<TreeEntry>> {
    let url = format!("https://api.github.com/repos/{repo}/git/trees/{branch}?recursive=1");
    let response: TreeResponse = api_client()?
        .get(url)
        .send()
        .map_err(|error| AppError::from(error).context("fetch upstream tree"))?
        .json()
        .map_err(|error| AppError::from(error).context("decode tree info"))?;
    // A truncated listing means we cannot know the full file set safely.
    if response.truncated {
        return Err(AppError::custom(CustomErrorCode::PoetryTreeTruncated));
    }
    Ok(response.tree)
}

/// Blobs a collection needs, in a stable order so progress is monotonic.
fn needed_blobs<'a>(
    tree: &'a [TreeEntry],
    catalog: &Catalog,
    ids: &[String],
) -> Vec<&'a TreeEntry> {
    let mut patterns: Vec<&str> = Vec::new();
    for id in ids {
        let Some(spec) = catalog.collection(id) else {
            continue;
        };
        patterns.extend(spec.paths.iter().map(String::as_str));
        if let Some(authors) = &spec.authors_path {
            patterns.push(authors.as_str());
        }
    }
    let mut matched: Vec<&TreeEntry> = tree
        .iter()
        .filter(|entry| {
            entry.kind == "blob"
                && patterns
                    .iter()
                    .any(|pattern| glob_match(pattern, &entry.path))
        })
        .collect();
    matched.sort_by(|a, b| a.path.cmp(&b.path));
    matched
}

fn write_blob(extract_dir: &Path, entry: &TreeEntry, bytes: &[u8]) -> AppResult<()> {
    let rel = Path::new(&entry.path);
    // Upstream listings are data, not instructions: never let one escape the
    // scratch directory.
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(AppError::custom(CustomErrorCode::PoetryUnsafeTreePath)
            .with_arg("path", entry.path.clone()));
    }
    let target = extract_dir.join(rel);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(AppError::from)?;
    }
    fs::write(&target, bytes)
        .map_err(|error| AppError::from(error).context(format!("write {}", entry.path)))
}

/// Fetch one file with a single retry, mirroring the tarball's tolerance for
/// transient blips. `raw.githubusercontent.com` serves the bytes directly and
/// is not metered by the 60/hour API quota, so a large collection no longer
/// runs out of requests halfway.
fn fetch_blob(
    client: &reqwest::blocking::Client,
    repo: &str,
    branch: &str,
    entry: &TreeEntry,
    cancelled: &AtomicBool,
) -> AppResult<Vec<u8>> {
    let url = format!(
        "https://raw.githubusercontent.com/{repo}/{branch}/{}",
        entry.path
    );
    let mut last_error = None;
    for attempt in 0..2 {
        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError::custom(CustomErrorCode::PoetrySyncCancelled));
        }
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
        match client.get(&url).send().and_then(|response| response.error_for_status()) {
            Ok(response) => match response.bytes() {
                Ok(bytes) => return Ok(bytes.to_vec()),
                Err(error) => {
                    last_error = Some(AppError::from(error).context("download interrupted"))
                }
            },
            Err(error) => {
                last_error = Some(AppError::from(error).context("download failed"));
            }
        }
    }
    Err(last_error
        .unwrap_or_else(|| AppError::external("http:request", "All file download attempts failed")))
}

/// Fetch every file the requested collections need into `extract_dir`.
pub(super) fn fetch_needed_blobs(
    progress: &ProgressFn<'_>,
    spec: &SourceSpec,
    catalog: &Catalog,
    ids: &[String],
    extract_dir: &Path,
    cancelled: &AtomicBool,
) -> AppResult<()> {
    let tree = fetch_source_tree(&spec.repo, &spec.branch)?;
    let needed = needed_blobs(&tree, catalog, ids);
    if needed.is_empty() {
        return Err(AppError::custom(CustomErrorCode::PoetryNoMatchingFiles));
    }

    let client = api_client()?;
    let total: u64 = needed.iter().map(|entry| entry.size).sum();
    progress(download_progress(0, Some(total)));
    let next = AtomicUsize::new(0);
    let done = std::sync::Mutex::new(0u64);
    // Set on the first failure so the other workers stop picking up blobs.
    let failed = AtomicBool::new(false);
    let errors = std::sync::Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..BLOB_WORKERS.min(needed.len()) {
            scope.spawn(|| loop {
                if failed.load(Ordering::SeqCst) {
                    return;
                }
                let Some(entry) = needed.get(next.fetch_add(1, Ordering::SeqCst)) else {
                    return;
                };
                let result = fetch_blob(&client, &spec.repo, &spec.branch, entry, cancelled)
                    .and_then(|bytes| write_blob(extract_dir, entry, &bytes).map(|()| bytes.len()));
                match result {
                    Ok(length) => {
                        // Report under the lock so progress never moves backwards.
                        let mut done = done.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                        *done += length as u64;
                        progress(download_progress(*done, Some(total)));
                    }
                    Err(error) => {
                        failed.store(true, Ordering::SeqCst);
                        if let Ok(mut errors) = errors.lock() {
                            errors.push(error);
                        }
                        return;
                    }
                }
            });
        }
    });
    if let Some(error) = errors
        .into_inner()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .into_iter()
        .next()
    {
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
#[path = "github_tests.rs"]
mod tests;
