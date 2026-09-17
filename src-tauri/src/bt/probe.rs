//! Source identifier parsing: infohash extraction and metadata -> file list,
//! plus the manager-side probe and online-preview entry points.

use std::collections::HashSet;
use std::path::PathBuf;

use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse};
use librqbit_core::torrent_metainfo::ValidatedTorrentMetaV1Info;

use super::{
    find_handle, info_hash_hex, is_completed_archive, parse_info_hash, BtFileMeta, BtManager,
    BtProbeResult, BtTaskInfo, TorrentHandle, PROBE_TIMEOUT,
};
use crate::error::{AppError, AppResult};
use crate::storage::bt::BtTaskRow;

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

impl BtManager {
    /// Resolve magnet/torrent metadata (list-only, zero disk writes).
    pub async fn probe(&self, source: &str) -> AppResult<BtProbeResult> {
        let local = PathBuf::from(source);
        if local.is_file() {
            let bytes =
                std::fs::read(&local).map_err(|e| AppError(format!("读取种子文件失败: {e}")))?;
            return torrent_bytes_to_probe(&bytes);
        }
        if !source.starts_with("magnet:") && !source.starts_with("http") {
            return Err(AppError("仅支持磁力链接或 .torrent 文件路径".into()));
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
        .map_err(|_| AppError("获取资源信息超时，请检查网络或稍后重试".into()))?
        .map_err(|e| AppError(format!("获取资源信息失败: {e:#}")))?;

        match resp {
            AddTorrentResponse::ListOnly(listed) => {
                probe_from_info(&listed.info, listed.info_hash.as_string())
            }
            AddTorrentResponse::AlreadyManaged(_, handle) => handle_to_probe(&handle),
            AddTorrentResponse::Added(..) => Err(AppError("内部状态异常：probe 不应落盘".into())),
        }
    }

    /// Online preview entry: make sure a streamable task exists for the
    /// target file (cache mode) and return its info.
    ///
    /// Resolution order (docs/bt.md §3.3): reuse an existing task; local
    /// .torrent yields the infohash offline; magnets must be v1 40-hex.
    pub async fn ensure_preview_task(
        &self,
        source: &str,
        file_index: usize,
    ) -> AppResult<BtTaskInfo> {
        let hash_hex = source_info_hash(source)?;
        if let Some(mut row) = self.storage.get_bt_task(&hash_hex)? {
            let completed_archive = is_completed_archive(&row.status, &row.package_mode);
            // Reuse the existing task; lazy start restores handles via
            // persistence when the engine was down.
            let session = self.ensure_engine().await?;
            let hash = parse_info_hash(&hash_hex)?;
            match find_handle(&session, &hash)? {
                // Previewing another file of the same torrent: the engine only
                // downloads what is selected, so add this file to the
                // selection instead of waiting forever on a stalled stream.
                Some(handle) => {
                    let mut wanted: HashSet<usize> = handle
                        .only_files()
                        .unwrap_or_default()
                        .into_iter()
                        .collect();
                    if !wanted.is_empty() && wanted.insert(file_index) {
                        session
                            .update_only_files(&handle, &wanted)
                            .await
                            .map_err(|e| AppError(format!("更新文件选择失败: {e:#}")))?;
                    }
                    self.unpause_task(&session, &hash_hex).await;
                }
                None => {
                    // A completed archive no longer has an engine handle. Its
                    // preview must stay ephemeral so the persisted archive
                    // state never returns to active/packaging.
                    let output_folder = if completed_archive {
                        self.cache_root()?
                            .join(&hash_hex)
                            .to_string_lossy()
                            .into_owned()
                    } else {
                        row.dest_dir.clone()
                    };
                    self.add_torrent_to_session(&session, source, vec![file_index], output_folder)
                        .await?;
                    if !completed_archive {
                        row.file_indices = vec![file_index];
                        row.status = "active".into();
                        row.total_bytes = None;
                        row.last_error = None;
                        row.pinned = false;
                        self.storage.upsert_bt_task(&row)?;
                    }
                }
            }
            if !completed_archive {
                let _ = self.storage.touch_bt_access(&hash_hex);
            }
            return Ok(self.task_info_with_live(row));
        }
        let session = self.ensure_engine().await?;
        let dest_dir = self
            .cache_root()?
            .join(&hash_hex)
            .to_string_lossy()
            .into_owned();
        let handle = self
            .add_torrent_to_session(&session, source, vec![file_index], dest_dir.clone())
            .await?;
        let label = handle.name().unwrap_or_else(|| hash_hex.clone());
        let row = BtTaskRow {
            info_hash: hash_hex.clone(),
            label,
            dest_dir: dest_dir.clone(),
            mode: "preview".into(),
            pinned: false,
            created_at: crate::storage::now_ms(),
            work_dir: dest_dir.clone(),
            file_indices: vec![file_index],
            package_mode: "direct".into(),
            status: "active".into(),
            output_path: None,
            total_bytes: None,
            last_error: None,
        };
        self.storage.upsert_bt_task(&row)?;
        let _ = self.storage.touch_bt_access(&hash_hex);
        // Run one quota reclaim pass after the new task lands; failures
        // never block this preview.
        let _ = self.evict_if_needed(&hash_hex).await;
        Ok(self.task_info_with_live(row))
    }
}
