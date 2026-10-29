//! Annotation pack extraction and transactional import, owned by the sync worker.
use super::{PoetryLibrary, ProgressFn};
use crate::error::{AppError, AppResult, CustomErrorCode};
use std::sync::{atomic::AtomicBool, Arc};

#[cfg(desktop)]
use super::{
    super::{catalog::Catalog, db::ANNOTATIONS_COLLECTION_ID, model::PoetrySyncProgress, text},
    net::download_tarball,
};
#[cfg(desktop)]
use serde_json::Value;
#[cfg(desktop)]
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};

pub(super) fn run_annotations_install(
    library: &Arc<PoetryLibrary>,
    progress: &ProgressFn<'_>,
    cancelled: &AtomicBool,
) -> AppResult<()> {
    #[cfg(not(desktop))]
    {
        let _ = (library, progress, cancelled);
        return Err(AppError::custom(
            CustomErrorCode::PoetryAnnotationsDesktopOnly,
        ));
    }

    #[cfg(desktop)]
    {
        let catalog = Catalog::load()?;
        let tmp = library.tmp_dir();
        fs::create_dir_all(&tmp).map_err(AppError::from)?;
        let result = (|| -> AppResult<()> {
            let archive_path = tmp.join("gushiwen.tar.gz");
            let Some(spec) = catalog.sources.get("gushiwen") else {
                return Err(AppError::custom(CustomErrorCode::PoetrySourceMissing));
            };
            download_tarball(
                progress,
                spec.repo.clone(),
                spec.branch.clone(),
                &archive_path,
                cancelled,
            )?;
            let extract_dir = tmp.join("extract-gushiwen");
            let _ = fs::remove_dir_all(&extract_dir);
            fs::create_dir_all(&extract_dir).map_err(AppError::from)?;
            extract_all(&archive_path, &extract_dir, cancelled)?;
            import_annotation_jsonl(library, progress, &extract_dir, cancelled)?;
            let _ = fs::remove_dir_all(&extract_dir);
            let _ = fs::remove_file(&archive_path);
            library.db().meta_set("annotations_installed", "1")?;
            Ok(())
        })();
        let _ = fs::remove_dir_all(&tmp);
        result
    }
}

#[cfg(desktop)]
fn extract_all(archive_path: &Path, extract_root: &Path, cancelled: &AtomicBool) -> AppResult<()> {
    let file = fs::File::open(archive_path)
        .map_err(|error| AppError::from(error).context("open archive"))?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
    archive.set_preserve_permissions(false);
    for entry in archive
        .entries()
        .map_err(|error| AppError::from(error).context("read archive"))?
    {
        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError::custom(CustomErrorCode::PoetrySyncCancelled));
        }
        let mut entry = entry.map_err(AppError::from)?;
        let path = entry
            .path()
            .map_err(|error| AppError::from(error).context("archive entry path"))?
            .into_owned();
        let rel: PathBuf = path.components().skip(1).collect();
        if rel.as_os_str().is_empty() {
            continue;
        }
        let target = extract_root.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(AppError::from)?;
        }
        entry
            .unpack(&target)
            .map_err(|error| AppError::from(error).context("unpack"))?;
    }
    Ok(())
}

#[cfg(desktop)]
fn import_annotation_jsonl(
    library: &Arc<PoetryLibrary>,
    progress: &ProgressFn<'_>,
    dir: &Path,
    cancelled: &AtomicBool,
) -> AppResult<()> {
    // The gushiwen repo ships JSONL content under `.json` names across
    // guwen/ sentence/ writer/; only lines carrying annotation fields are
    // relevant, so filter by content rather than by path.
    let mut json_files = Vec::new();
    collect_matching_suffix(dir, ".json", &mut json_files)?;
    json_files.sort();

    // Pre-count lines so the progress toast can show X / Y.
    let mut total: u32 = 0;
    for file in &json_files {
        let raw = fs::read_to_string(file)
            .map_err(|error| AppError::from(error).context(format!("read {}", file.display())))?;
        let lines = raw.lines().filter(|line| !line.trim().is_empty()).count() as u32;
        total += lines;
    }

    let conn = library.db().open()?;
    // One transaction instead of one autocommit per row. Cancelling or failing
    // drops it and rolls back; the upsert makes a rerun idempotent.
    let tx = conn.unchecked_transaction()?;
    let mut upsert = tx.prepare(
        r#"
        INSERT INTO annotations(match_key, title, writer, remark, translation, appreciation, audio_url)
        VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(match_key) DO UPDATE SET
            remark = excluded.remark,
            translation = excluded.translation,
            appreciation = excluded.appreciation,
            audio_url = excluded.audio_url
        "#,
    )?;
    let mut imported: u32 = 0;
    for file in &json_files {
        let raw = fs::read_to_string(file)
            .map_err(|error| AppError::from(error).context(format!("read {}", file.display())))?;
        for line in raw.lines() {
            if cancelled.load(Ordering::SeqCst) {
                return Err(AppError::custom(CustomErrorCode::PoetrySyncCancelled));
            }
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let field = |name: &str| {
                value
                    .get(name)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            };
            let remark = field("remark");
            let translation = field("translation");
            let appreciation = field("shangxi");
            // sentence/ writer/ entries carry none of these; skip them.
            if remark.is_empty() && translation.is_empty() && appreciation.is_empty() {
                continue;
            }
            let Some(title) = value.get("title").and_then(Value::as_str) else {
                continue;
            };
            let writer_name = value.get("writer").and_then(Value::as_str).unwrap_or("");
            let key = text::annotation_key(&text::normalize(title), &text::normalize(writer_name));
            upsert.execute(rusqlite::params![
                key,
                title.trim(),
                writer_name.trim(),
                remark,
                translation,
                appreciation,
                field("audioUrl"),
            ])?;
            imported += 1;
            if imported.is_multiple_of(500) {
                progress(PoetrySyncProgress {
                    collection_id: ANNOTATIONS_COLLECTION_ID.into(),
                    phase: "importing".into(),
                    bytes_done: 0,
                    bytes_total: None,
                    imported,
                    total: Some(total),
                    error: None,
                });
            }
        }
    }
    drop(upsert);
    tx.commit()?;
    Ok(())
}

#[cfg(desktop)]
fn collect_matching_suffix(dir: &Path, suffix: &str, out: &mut Vec<PathBuf>) -> AppResult<()> {
    let entries = fs::read_dir(dir)
        .map_err(|error| AppError::from(error).context(format!("read {}", dir.display())))?;
    for entry in entries {
        let entry = entry.map_err(AppError::from)?;
        let path = entry.path();
        if path.is_dir() {
            collect_matching_suffix(&path, suffix, out)?;
        } else if path.to_string_lossy().ends_with(suffix) {
            out.push(path);
        }
    }
    Ok(())
}
