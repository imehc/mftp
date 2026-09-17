//! Ingest pipeline shared by network sync and local import: locate the
//! files a collection needs inside an extracted repository (or plain
//! directory), parse them through the catalog adapter, and stream them into
//! the database writer.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::poetry::adapter::{adapter_for, parse_author_bios};
use crate::poetry::catalog::{Catalog, CollectionSpec};
use crate::poetry::db;
use crate::poetry::model::PoetrySyncProgress;

use super::{PoetryLibrary, ProgressFn};

// ---------------------------------------------------------------------------
// Import pipeline (shared by network sync and local import)
// ---------------------------------------------------------------------------

struct MatchedFiles {
    /// collection id → extracted files
    per_collection: Vec<(String, Vec<PathBuf>)>,
    /// collection id → author-bio file
    authors: Vec<(String, PathBuf)>,
}

pub(super) fn import_extracted_dir(
    library: &PoetryLibrary,
    progress: &ProgressFn<'_>,
    extract_root: &Path,
    ids: &[String],
    sha_for: &dyn Fn(&str) -> String,
    cancelled: &AtomicBool,
) -> AppResult<()> {
    let catalog = Catalog::load().map_err(AppError)?;
    let matched = collect_files(&catalog, extract_root, ids)?;

    let body_indexed = library
        .db()
        .meta_get(db::META_BODY_INDEX_ENABLED)?
        .as_deref()
        == Some("1");

    for (collection_id, files) in &matched.per_collection {
        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError("cancelled".into()));
        }
        let Some(spec) = catalog.collection(collection_id) else {
            continue;
        };
        import_one_collection(
            library,
            progress,
            spec,
            files,
            matched
                .authors
                .iter()
                .find(|(id, _)| id == collection_id)
                .map(|(_, path)| path.as_path()),
            &sha_for(collection_id),
            body_indexed,
            cancelled,
        )?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn import_one_collection(
    library: &PoetryLibrary,
    progress: &ProgressFn<'_>,
    spec: &CollectionSpec,
    files: &[PathBuf],
    authors_file: Option<&Path>,
    source_sha: &str,
    body_indexed: bool,
    cancelled: &AtomicBool,
) -> AppResult<()> {
    let adapter = adapter_for(&spec.parser.kind).map_err(AppError)?;
    let writer = library.db().open_writer()?;
    writer.upsert_collection(
        &spec.id,
        &spec.name,
        &spec.dynasty,
        spec.script,
        spec.tier,
        source_sha,
    )?;

    let mut imported: u32 = 0;
    for file in files {
        if cancelled.load(Ordering::SeqCst) {
            // Dropping the writer rolls back the open transaction.
            return Err(AppError("cancelled".into()));
        }
        let raw = fs::read_to_string(file)
            .map_err(|e| AppError(format!("read {}: {e}", file.display())))?;
        let data: Value = serde_json::from_str(&raw)
            .map_err(|e| AppError(format!("parse {}: {e}", file.display())))?;
        let poems = adapter
            .parse(spec, &data)
            .map_err(|e| AppError(format!("adapt {}: {e}", file.display())))?;
        for poem in &poems {
            writer.insert_poem(&spec.id, &spec.dynasty, poem, body_indexed)?;
        }
        imported += poems.len() as u32;
        progress(PoetrySyncProgress {
            collection_id: spec.id.clone(),
            phase: "importing".into(),
            bytes_done: 0,
            bytes_total: None,
            imported,
            total: None,
            error: None,
        });
    }

    if let Some(authors_path) = authors_file {
        let raw = fs::read_to_string(authors_path)
            .map_err(|e| AppError(format!("read {}: {e}", authors_path.display())))?;
        let data: Value = serde_json::from_str(&raw)
            .map_err(|e| AppError(format!("parse {}: {e}", authors_path.display())))?;
        writer.replace_author_bios(&spec.id, &parse_author_bios(&data))?;
    }

    writer.finalize_counts(&spec.id)?;
    writer.commit()?;
    Ok(())
}

fn collect_files(
    catalog: &Catalog,
    extract_root: &Path,
    ids: &[String],
) -> AppResult<MatchedFiles> {
    let mut per_collection = Vec::new();
    let mut authors = Vec::new();
    for id in ids {
        let Some(spec) = catalog.collection(id) else {
            continue;
        };
        let mut files = Vec::new();
        collect_matching(extract_root, extract_root, &spec.paths, &mut files)?;
        files.sort();
        per_collection.push((spec.id.clone(), files));
        if let Some(authors_rel) = &spec.authors_path {
            let path = extract_root.join(authors_rel);
            if path.is_file() {
                authors.push((spec.id.clone(), path));
            }
        }
    }
    Ok(MatchedFiles {
        per_collection,
        authors,
    })
}

fn collect_matching(
    root: &Path,
    dir: &Path,
    patterns: &[String],
    out: &mut Vec<PathBuf>,
) -> AppResult<()> {
    let entries =
        fs::read_dir(dir).map_err(|e| AppError(format!("read {}: {e}", dir.display())))?;
    for entry in entries {
        let entry = entry.map_err(|e| AppError(e.to_string()))?;
        let path = entry.path();
        if path.is_dir() {
            collect_matching(root, &path, patterns, out)?;
        } else if let Ok(rel) = path.strip_prefix(root) {
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            if patterns.iter().any(|pattern| glob_match(pattern, &rel_str)) {
                out.push(path);
            }
        }
    }
    Ok(())
}

/// Minimal glob supporting `*` (any run, including `/`). Sufficient for the
/// catalog's path patterns.
pub fn glob_match(pattern: &str, candidate: &str) -> bool {
    fn inner(p: &[u8], c: &[u8]) -> bool {
        match (p.first(), c.first()) {
            (None, None) => true,
            (Some(b'*'), _) => inner(&p[1..], c) || (!c.is_empty() && inner(p, &c[1..])),
            (Some(a), Some(b)) => a == b && inner(&p[1..], &c[1..]),
            _ => false,
        }
    }
    inner(pattern.as_bytes(), candidate.as_bytes())
}

pub(super) fn extract_selected(
    archive_path: &Path,
    extract_root: &Path,
    catalog: &Catalog,
    ids: &[String],
    cancelled: &AtomicBool,
) -> AppResult<()> {
    let file = fs::File::open(archive_path).map_err(|e| AppError(format!("open archive: {e}")))?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    archive.set_preserve_permissions(false);

    let needed: Vec<(&str, Vec<&str>)> = ids
        .iter()
        .filter_map(|id| catalog.collection(id))
        .map(|spec| {
            (
                spec.id.as_str(),
                spec.paths.iter().map(String::as_str).collect(),
            )
        })
        .collect();

    let entries = archive
        .entries()
        .map_err(|e| AppError(format!("read archive: {e}")))?;
    for entry in entries {
        if cancelled.load(Ordering::SeqCst) {
            return Err(AppError("cancelled".into()));
        }
        let mut entry = entry.map_err(|e| AppError(format!("archive entry: {e}")))?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let path = entry
            .path()
            .map_err(|e| AppError(e.to_string()))?
            .into_owned();
        // Strip the leading `repo-branch/` component GitHub tarballs add.
        let rel: PathBuf = path.components().skip(1).collect();
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let matched = needed
            .iter()
            .any(|(_, patterns)| patterns.iter().any(|pattern| glob_match(pattern, &rel_str)));
        if !matched || rel.as_os_str().is_empty() {
            continue;
        }
        let target = extract_root.join(&rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(AppError::from)?;
        }
        entry
            .unpack(&target)
            .map_err(|e| AppError(format!("unpack {rel_str}: {e}")))?;
    }
    Ok(())
}

pub(super) fn run_local_import(
    library: &Arc<PoetryLibrary>,
    progress: &ProgressFn<'_>,
    source_path: &Path,
    ids: &[String],
    cancelled: &AtomicBool,
) -> AppResult<()> {
    let catalog = Catalog::load().map_err(AppError)?;
    if source_path.is_dir() {
        import_extracted_dir(
            library,
            progress,
            source_path,
            ids,
            &|_| "local".into(),
            cancelled,
        )?;
        return Ok(());
    }
    // Assume a tarball otherwise.
    let tmp = library.tmp_dir();
    fs::create_dir_all(&tmp).map_err(AppError::from)?;
    let extract_dir = tmp.join("extract-local");
    let _ = fs::remove_dir_all(&extract_dir);
    fs::create_dir_all(&extract_dir).map_err(AppError::from)?;
    let result = (|| -> AppResult<()> {
        extract_selected(source_path, &extract_dir, &catalog, ids, cancelled)?;
        import_extracted_dir(
            library,
            progress,
            &extract_dir,
            ids,
            &|_| "local".into(),
            cancelled,
        )
    })();
    let _ = fs::remove_dir_all(&extract_dir);
    result
}

#[cfg(test)]
#[path = "ingest_tests.rs"]
mod tests;
