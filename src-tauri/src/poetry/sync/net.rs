//! Desktop network channel: resolve upstream commit shas, stream codeload
//! tarballs to temp files with progress + cancellation, and hand the
//! extracted trees over to the ingest pipeline.
//!
//! reqwest is a desktop-only dependency, so everything touching it lives
//! behind `#[cfg(desktop)]`.

use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;

use super::ingest::{extract_selected, import_extracted_dir};
use crate::error::{AppError, AppResult};
use crate::poetry::catalog::Catalog;
use crate::poetry::model::PoetrySyncProgress;

use super::{PoetryLibrary, ProgressFn};

/// Resolve the current commit sha of every source referenced by `ids`.
#[cfg(desktop)]
pub(super) fn fetch_source_sha(catalog: &Catalog, source_id: &str) -> AppResult<String> {
    let Some(spec) = catalog.sources.get(source_id) else {
        return Err(AppError(format!("unknown source: {source_id}")));
    };
    let url = format!(
        "https://api.github.com/repos/{}/commits/{}",
        spec.repo, spec.branch
    );
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .user_agent("mftp-library-sync")
        .build()
        .map_err(|e| AppError(format!("http client: {e}")))?;
    let value: Value = client
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

#[cfg(not(desktop))]
pub(super) fn fetch_source_sha(_catalog: &Catalog, _source_id: &str) -> AppResult<String> {
    Err(AppError("library downloads require the desktop app".into()))
}

/// Flatten a reqwest error chain so the UI shows the real cause
/// (dns / connect / tls) instead of a bare "error sending request".
fn error_chain(error: &dyn std::error::Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        message.push_str(&format!(": {cause}"));
        source = cause.source();
    }
    message
}

#[cfg(test)]
mod probe {
    use super::*;

    // Opt-in network probe: MFTP_NET_PROBE=1 cargo test probe -- --nocapture
    #[test]
    fn codeload_reachable() {
        if std::env::var("MFTP_NET_PROBE").is_err() {
            return;
        }
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .user_agent("mftp-library-sync")
            .build()
            .expect("client builds");
        match client
            .get("https://codeload.github.com/chinese-poetry/chinese-poetry/tar.gz/refs/heads/master")
            .send()
        {
            Ok(response) => println!("status = {}", response.status()),
            Err(error) => {
                println!("chain = {}", error_chain(&error));
                panic!("probe failed");
            }
        }
    }
}

pub(super) fn run_network_sync(
    library: &Arc<PoetryLibrary>,
    progress: &ProgressFn<'_>,
    ids: &[String],
    cancelled: &AtomicBool,
) -> AppResult<()> {
    let catalog = Catalog::load().map_err(AppError)?;

    // Resolve upstream shas first; fall back to timestamps so a flaky API
    // never blocks importing data that will be downloaded anyway.
    let mut shas = std::collections::HashMap::<String, String>::new();
    for source_id in catalog.sources_for(ids) {
        let sha = fetch_source_sha(&catalog, source_id).unwrap_or_else(|_| {
            format!(
                "snapshot-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|duration| duration.as_secs())
                    .unwrap_or(0)
            )
        });
        shas.insert(source_id.to_string(), sha);
    }

    let tmp = library.tmp_dir();
    fs::create_dir_all(&tmp).map_err(AppError::from)?;
    let result = download_and_import(library, progress, &catalog, ids, &shas, &tmp, cancelled);
    let _ = fs::remove_dir_all(&tmp);
    result
}

fn download_and_import(
    library: &Arc<PoetryLibrary>,
    progress: &ProgressFn<'_>,
    catalog: &Catalog,
    ids: &[String],
    shas: &std::collections::HashMap<String, String>,
    tmp: &Path,
    cancelled: &AtomicBool,
) -> AppResult<()> {
    for source_id in catalog.sources_for(ids) {
        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError("cancelled".into()));
        }
        let Some(spec) = catalog.sources.get(source_id) else {
            continue;
        };
        let archive_path = tmp.join(format!("{source_id}.tar.gz"));
        download_tarball(
            progress,
            spec.repo.clone(),
            spec.branch.clone(),
            &archive_path,
            cancelled,
        )?;

        let extract_dir = tmp.join(format!("extract-{source_id}"));
        let _ = fs::remove_dir_all(&extract_dir);
        fs::create_dir_all(&extract_dir).map_err(AppError::from)?;
        extract_selected(&archive_path, &extract_dir, catalog, ids, cancelled)?;

        let sha = shas.get(source_id).cloned().unwrap_or_default();
        import_extracted_dir(
            library,
            progress,
            &extract_dir,
            ids,
            &|_| sha.clone(),
            cancelled,
        )?;
        let _ = fs::remove_dir_all(&extract_dir);
        let _ = fs::remove_file(&archive_path);
    }
    Ok(())
}

pub(super) fn download_tarball(
    progress: &ProgressFn<'_>,
    repo: String,
    branch: String,
    dest: &Path,
    cancelled: &AtomicBool,
) -> AppResult<()> {
    let url = format!("https://codeload.github.com/{repo}/tar.gz/refs/heads/{branch}");
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        // codeload has no Accept-Ranges: a dropped connection restarts from
        // zero, so a generous read timeout beats aggressive failure.
        // (no overall timeout: multi-hundred-MB downloads must not be cut off)
        .user_agent("mftp-library-sync")
        .build()
        .map_err(|e| AppError(format!("http client: {e}")))?;

    // One automatic retry: transient connect/DNS blips should not force a
    // full restart from the UI.
    let mut last_error: Option<AppError> = None;
    for attempt in 0..2 {
        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError("cancelled".into()));
        }
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_secs(2));
            progress(PoetrySyncProgress {
                collection_id: "download".into(),
                phase: "downloading".into(),
                bytes_done: 0,
                bytes_total: None,
                imported: 0,
                total: None,
                error: None,
            });
        }
        let response = client
            .get(url.clone())
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|e| AppError(format!("下载失败：{}", error_chain(&e))));
        match response {
            Ok(mut response) => {
                let part_path = dest.with_extension("part");
                return match stream_to_file(&mut response, &part_path, progress, cancelled) {
                    Ok(()) => {
                        // Only completed downloads get promoted.
                        fs::rename(&part_path, dest).map_err(AppError::from)
                    }
                    Err(error) => {
                        let _ = fs::remove_file(&part_path);
                        Err(error)
                    }
                };
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| AppError("download failed".into())))
}

fn stream_to_file(
    response: &mut reqwest::blocking::Response,
    part_path: &Path,
    progress: &ProgressFn<'_>,
    cancelled: &AtomicBool,
) -> AppResult<()> {
    let mut file =
        fs::File::create(part_path).map_err(|e| AppError(format!("create temp file: {e}")))?;
    let mut buffer = [0u8; 64 * 1024];
    let mut done: u64 = 0;
    let mut last_report: u64 = 0;
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError("cancelled".into()));
        }
        match response.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                file.write_all(&buffer[..n])
                    .map_err(|e| AppError(format!("write temp file: {e}")))?;
                done += n as u64;
                if done - last_report >= 256 * 1024 {
                    last_report = done;
                    progress(PoetrySyncProgress {
                        collection_id: "download".into(),
                        phase: "downloading".into(),
                        bytes_done: done,
                        bytes_total: response.content_length(),
                        imported: 0,
                        total: None,
                        error: None,
                    });
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(AppError(format!("下载中断：{}", error_chain(&error)))),
        }
    }
    file.sync_all().map_err(AppError::from)
}
