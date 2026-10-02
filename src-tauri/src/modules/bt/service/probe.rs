//! Source identifier parsing: infohash extraction and metadata -> file list,
//! plus the manager-side probe entry point.

use std::path::PathBuf;

use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse};
use librqbit_core::torrent_metainfo::ValidatedTorrentMetaV1Info;

use super::{info_hash_hex, BtFileMeta, BtManager, BtProbeResult, TorrentHandle, PROBE_TIMEOUT};
use crate::error::{AppError, AppResult, CustomErrorCode};

pub(super) fn torrent_bytes_to_probe(bytes: &[u8]) -> AppResult<BtProbeResult> {
    let meta = librqbit::torrent_from_bytes(bytes).map_err(|e| {
        AppError::external("bt:torrent_parse", format!("Torrent parse failed: {e}"))
    })?;
    let validated = meta.info.data.validate().map_err(|e| {
        AppError::external("bt:torrent_parse", format!("Invalid torrent content: {e}"))
    })?;
    probe_from_info(&validated, meta.info_hash.as_string())
}

pub(super) fn handle_to_probe(handle: &TorrentHandle) -> AppResult<BtProbeResult> {
    let name = handle.name();
    let files_result = handle.with_metadata(|md| {
        let files: Vec<BtFileMeta> = md
            .file_infos
            .iter()
            .enumerate()
            .filter(|(_, file)| !file.attrs.padding)
            .map(|(index, f)| BtFileMeta {
                index,
                path: f.relative_filename.to_string_lossy().into_owned(),
                len: f.len,
            })
            .collect();
        files
    });
    match files_result {
        Ok(files) => {
            let total_len = files.iter().map(|f| f.len).sum();
            Ok(BtProbeResult {
                info_hash: info_hash_hex(handle),
                name: name.unwrap_or_else(|| "Unknown".into()),
                files,
                total_len,
            })
        }
        Err(e) => Err(AppError::external(
            "bt:metadata",
            format!("Failed to read torrent metadata: {e:#}"),
        )),
    }
}

/// Build a probe result from validated metainfo; falls back to an
/// infohash prefix when the name is missing.
pub(super) fn probe_from_info<B: AsRef<[u8]>>(
    info: &ValidatedTorrentMetaV1Info<B>,
    info_hash: String,
) -> AppResult<BtProbeResult> {
    let mut files = Vec::new();
    let mut total_len = 0u64;
    for (index, fd) in info.iter_file_details_ext().enumerate() {
        if fd.details.attrs().padding {
            continue;
        }
        files.push(BtFileMeta {
            index,
            path: fd.details.filename.to_string(),
            len: fd.details.len,
        });
        total_len += fd.details.len;
    }
    if files.is_empty() {
        return Err(AppError::custom(CustomErrorCode::BtNoDownloadableFiles));
    }
    let name = info
        .name()
        .filter(|n| !n.trim().is_empty())
        .map(|n| n.into_owned())
        .unwrap_or_else(|| info_hash.chars().take(12).collect());
    Ok(BtProbeResult {
        info_hash,
        name,
        files,
        total_len,
    })
}

impl BtManager {
    /// Resolve magnet/torrent metadata (list-only, zero disk writes).
    pub async fn probe(&self, source: &str) -> AppResult<BtProbeResult> {
        let _operation = self.operation().await?;
        let local = PathBuf::from(source);
        if local.is_file() {
            let bytes = std::fs::read(&local)
                .map_err(|e| AppError::from(e).context("Read torrent file"))?;
            return torrent_bytes_to_probe(&bytes);
        }
        if !source.starts_with("magnet:") && !source.starts_with("http") {
            return Err(AppError::custom(CustomErrorCode::BtSourceUnsupported));
        }
        let session = self.ensure_engine().await?;
        let resp = tokio::time::timeout(
            PROBE_TIMEOUT,
            session.add_torrent(
                AddTorrent::from_url(source),
                Some(AddTorrentOptions {
                    list_only: true,
                    ..Default::default()
                }),
            ),
        )
        .await
        .map_err(|_| AppError::custom(CustomErrorCode::BtProbeTimeout))?
        .map_err(|e| {
            AppError::external(
                "bt:engine",
                format!("Failed to fetch torrent metadata: {e:#}"),
            )
        })?;

        match resp {
            AddTorrentResponse::ListOnly(listed) => {
                probe_from_info(&listed.info, listed.info_hash.as_string())
            }
            AddTorrentResponse::AlreadyManaged(_, handle) => handle_to_probe(&handle),
            AddTorrentResponse::Added(..) => {
                Err(AppError::custom(CustomErrorCode::BtProbeUnexpected))
            }
        }
    }
}
