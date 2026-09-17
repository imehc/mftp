//! Desktop sync orchestration: pick the file-level or tarball channel per
//! source, stream codeload tarballs to temp files with progress and
//! cancellation, and hand the extracted trees over to the ingest pipeline.
//!
//! GitHub API access lives in `github`; reqwest is a desktop-only dependency,
//! so everything touching it lives behind `#[cfg(desktop)]`.

#[cfg(desktop)]
use std::fs;
#[cfg(desktop)]
use std::io::{Read, Write};
#[cfg(desktop)]
use std::path::Path;
use std::sync::atomic::AtomicBool;
#[cfg(desktop)]
use std::sync::atomic::Ordering;
use std::sync::Arc;

#[cfg(desktop)]
use super::github::{download_progress, error_chain, fetch_needed_blobs, resolve_source_sha};
#[cfg(desktop)]
use super::ingest::{extract_selected, import_extracted_dir};
use crate::error::{AppError, AppResult};
use crate::poetry::catalog::Catalog;

use super::{PoetryLibrary, ProgressFn};

#[cfg(all(test, desktop))]
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

#[cfg(desktop)]
pub(super) fn run_network_sync(
    library: &Arc<PoetryLibrary>,
    progress: &ProgressFn<'_>,
    ids: &[String],
    cancelled: &AtomicBool,
) -> AppResult<()> {
    let catalog = Catalog::load().map_err(AppError)?;

    // Announce the job before any network work: resolving upstream shas and
    // the connect/TLS handshake both take seconds on a slow route, and the UI
    // keys its toast and busy state off progress events. Without this the
    // page looks frozen until the first 256 KiB have been streamed.
    progress(download_progress(0, None));

    let tmp = library.tmp_dir();
    fs::create_dir_all(&tmp).map_err(AppError::from)?;
    let result = download_and_import(library, progress, &catalog, ids, &tmp, cancelled);
    let _ = fs::remove_dir_all(&tmp);
    result
}

#[cfg(not(desktop))]
pub(super) fn run_network_sync(
    _library: &Arc<PoetryLibrary>,
    _progress: &ProgressFn<'_>,
    _ids: &[String],
    _cancelled: &AtomicBool,
) -> AppResult<()> {
    Err(AppError("library downloads require the desktop app".into()))
}

#[cfg(desktop)]
fn download_and_import(
    library: &Arc<PoetryLibrary>,
    progress: &ProgressFn<'_>,
    catalog: &Catalog,
    ids: &[String],
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
        let extract_dir = tmp.join(format!("extract-{source_id}"));
        let _ = fs::remove_dir_all(&extract_dir);
        fs::create_dir_all(&extract_dir).map_err(AppError::from)?;

        // Pull only the blobs the selected collections need. Any failure or a
        // request budget too small for the file set falls back to the whole
        // tarball, so behaviour never degrades below the previous release.
        let blobs = fetch_needed_blobs(progress, spec, catalog, ids, &extract_dir, cancelled);
        if !matches!(blobs, Ok(true)) {
            if cancelled.load(Ordering::SeqCst) {
                return Err(AppError("cancelled".into()));
            }
            if let Err(error) = &blobs {
                eprintln!("poetry blob fetch fell back to tarball: {}", error.0);
            }
            // A partial blob run may have left files behind; the tarball
            // extractor expects an empty root.
            let _ = fs::remove_dir_all(&extract_dir);
            fs::create_dir_all(&extract_dir).map_err(AppError::from)?;
            let archive_path = tmp.join(format!("{source_id}.tar.gz"));
            download_tarball(
                progress,
                spec.repo.clone(),
                spec.branch.clone(),
                &archive_path,
                cancelled,
            )?;
            extract_selected(&archive_path, &extract_dir, catalog, ids, cancelled)?;
            let _ = fs::remove_file(&archive_path);
        }

        // Resolved after the download so a slow GitHub API never delays the
        // transfer the user is waiting on. Only used to stamp the installed
        // collections below.
        let sha = resolve_source_sha(catalog, source_id);
        import_extracted_dir(
            library,
            progress,
            &extract_dir,
            ids,
            &|_| sha.clone(),
            cancelled,
        )?;
        let _ = fs::remove_dir_all(&extract_dir);
    }
    Ok(())
}

#[cfg(desktop)]
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
            progress(download_progress(0, None));
        }
        let response = client
            .get(url.clone())
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|e| AppError(format!("下载失败：{}", error_chain(&e))));
        match response {
            Ok(mut response) => {
                let part_path = dest.with_extension("part");
                // Headers are in, so the total is known: report it now rather
                // than waiting the 256 KiB the streaming loop batches by.
                progress(download_progress(0, response.content_length()));
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

#[cfg(desktop)]
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
                    progress(download_progress(done, response.content_length()));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(AppError(format!("下载中断：{}", error_chain(&error)))),
        }
    }
    file.sync_all().map_err(AppError::from)
}
