//! Source identifier parsing: infohash extraction and metadata -> file list.

use std::path::PathBuf;

use librqbit_core::torrent_metainfo::ValidatedTorrentMetaV1Info;

use super::{info_hash_hex, BtFileMeta, BtProbeResult, TorrentHandle};
use crate::error::{AppError, AppResult};

pub(super) fn source_info_hash(source: &str) -> AppResult<String> {
    let path = PathBuf::from(source);
    if path.is_file() {
        let bytes = std::fs::read(&path).map_err(|e| AppError(format!("读取种子文件失败: {e}")))?;
        let meta = librqbit::torrent_from_bytes(&bytes)
            .map_err(|e| AppError(format!("种子文件解析失败: {e}")))?;
        return Ok(meta.info_hash.as_string());
    }
    const MARK: &str = "urn:btih:";
    let start = source
        .find(MARK)
        .ok_or_else(|| AppError("无法识别的资源标识".into()))?
        + MARK.len();
    let hex_part: String = source[start..]
        .chars()
        .take_while(|c| c.is_ascii_hexdigit())
        .collect();
    if hex_part.len() != 40 {
        return Err(AppError("仅支持 v1 磁力链接（40 位 infohash）".into()));
    }
    Ok(hex_part.to_ascii_lowercase())
}

pub(super) fn torrent_bytes_to_probe(bytes: &[u8]) -> AppResult<BtProbeResult> {
    let meta = librqbit::torrent_from_bytes(bytes)
        .map_err(|e| AppError(format!("种子文件解析失败: {e}")))?;
    let validated = meta
        .info
        .data
        .validate()
        .map_err(|e| AppError(format!("种子内容无效: {e}")))?;
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
        Err(e) => Err(AppError(format!("读取元数据失败: {e:#}"))),
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
        return Err(AppError("资源中没有可下载的文件".into()));
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
