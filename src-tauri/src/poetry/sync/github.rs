//! GitHub API access for the download channels: the blocking client, the
//! commit sha of a source, the repository tree listing, the blob fetches that
//! let a collection be pulled without its whole source tarball, and the
//! `downloading` progress event both channels report with.
//!
//! The same file-level GitHub channel is used by desktop and mobile builds.

use std::fs;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

use serde_json::Value;

use super::ingest::glob_match;
use crate::error::{AppError, AppResult};
use crate::poetry::catalog::Catalog;
use crate::poetry::catalog::SourceSpec;
use crate::poetry::model::PoetrySyncProgress;

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

/// Flatten a reqwest error chain so the UI shows the real cause
/// (dns / connect / tls) instead of a bare "error sending request".
pub(super) fn error_chain(error: &dyn std::error::Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        message.push_str(&format!(": {cause}"));
        source = cause.source();
    }
    message
}

/// Resolve the current commit sha of every source referenced by `ids`.
pub(super) fn fetch_source_sha(catalog: &Catalog, source_id: &str) -> AppResult<String> {
    let Some(spec) = catalog.sources.get(source_id) else {
        return Err(AppError(format!("unknown source: {source_id}")));
    };
    let url = format!(
        "https://api.github.com/repos/{}/commits/{}",
        spec.repo, spec.branch
    );
    let value: Value = api_client()?
        .get(url)
        .send()
        .map_err(|e| AppError(format!("获取上游版本失败：{}", error_chain(&e))))?
        .json()
        .map_err(|e| AppError(format!("decode commit info: {e}")))?;
    value
        .get("sha")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| AppError("commit response missing sha".into()))
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

fn api_client() -> AppResult<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(60))
        .user_agent("mftp-library-sync")
        .build()
        .map_err(|e| AppError(format!("http client: {e}")))
}

/// A file entry from the git tree API. `size` is absent for directories.
#[derive(serde::Deserialize)]
struct TreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
    sha: String,
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
        .map_err(|e| AppError(format!("获取上游文件清单失败：{}", error_chain(&e))))?
        .json()
        .map_err(|e| AppError(format!("decode tree info: {e}")))?;
    // A truncated listing means we cannot know the full file set safely.
    if response.truncated {
        return Err(AppError("upstream tree listing is truncated".into()));
    }
    Ok(response.tree)
}

/// Unauthenticated API calls are capped at 60/hour. Returns `None` when the
/// budget cannot be read, so callers can choose whether to fall back.
fn core_requests_remaining(client: &reqwest::blocking::Client) -> Option<u64> {
    let value: Value = client
        .get("https://api.github.com/rate_limit")
        .send()
        .ok()?
        .json()
        .ok()?;
    value
        .get("resources")?
        .get("core")?
        .get("remaining")?
        .as_u64()
}

/// Requests kept aside for the commit sha lookup, the sync check and a retry,
/// so a blob run never strands the quota at zero.
const RATE_HEADROOM: u64 = 10;

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
        return Err(AppError(format!("unsafe path in tree: {}", entry.path)));
    }
    let target = extract_dir.join(rel);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(AppError::from)?;
    }
    fs::write(&target, bytes).map_err(|e| AppError(format!("write {}: {e}", entry.path)))
}

/// Fetch one blob with a single retry, mirroring the tarball's tolerance for
/// transient blips.
fn fetch_blob(
    client: &reqwest::blocking::Client,
    repo: &str,
    entry: &TreeEntry,
    cancelled: &AtomicBool,
) -> AppResult<Vec<u8>> {
    let url = format!(
        "https://api.github.com/repos/{repo}/git/blobs/{}",
        entry.sha
    );
    let mut last_error = None;
    for attempt in 0..2 {
        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError("cancelled".into()));
        }
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
        match client
            .get(&url)
            // Ask for the file itself rather than a base64 envelope.
            .header("Accept", "application/vnd.github.raw")
            .send()
            .and_then(|response| response.error_for_status())
        {
            Ok(response) => match response.bytes() {
                Ok(bytes) => return Ok(bytes.to_vec()),
                Err(error) => {
                    last_error = Some(AppError(format!("下载中断：{}", error_chain(&error))))
                }
            },
            Err(error) => last_error = Some(AppError(format!("下载失败：{}", error_chain(&error)))),
        }
    }
    Err(last_error.unwrap_or_else(|| AppError("blob download failed".into())))
}

/// Fetch every blob the requested collections need into `extract_dir`.
///
/// Returns `Ok(false)` when the request budget is too small for the file set.
pub(super) fn fetch_needed_blobs(
    progress: &ProgressFn<'_>,
    spec: &SourceSpec,
    catalog: &Catalog,
    ids: &[String],
    extract_dir: &Path,
    cancelled: &AtomicBool,
) -> AppResult<bool> {
    let tree = fetch_source_tree(&spec.repo, &spec.branch)?;
    let needed = needed_blobs(&tree, catalog, ids);
    if needed.is_empty() {
        return Err(AppError("upstream tree has no matching files".into()));
    }

    let client = api_client()?;
    // One call per blob plus the tree we already spent. A run that runs out
    // midway is wasted work, so require the whole set up front.
    let needed_requests = needed.len() as u64 + 1;
    match core_requests_remaining(&client) {
        Some(remaining) if needed_requests + RATE_HEADROOM <= remaining => {}
        _ => return Ok(false),
    }

    let total: u64 = needed.iter().map(|entry| entry.size).sum();
    progress(download_progress(0, Some(total)));
    let mut done: u64 = 0;
    for entry in &needed {
        let bytes = fetch_blob(&client, &spec.repo, entry, cancelled)?;
        write_blob(extract_dir, entry, &bytes)?;
        done += bytes.len() as u64;
        progress(download_progress(done, Some(total)));
    }
    Ok(true)
}

#[cfg(test)]
#[path = "github_tests.rs"]
mod tests;
