//! Readiness checks read original, verified pieces without changing task state.

use super::*;
use tokio::io::AsyncReadExt;
use tokio::time::timeout;

const READ_PROBE_BYTES: u64 = 512 * 1024;
const READ_PROBE_TIMEOUT: Duration = Duration::from_millis(500);
const PLAYABILITY_READY_TIMEOUT: Duration = Duration::from_secs(30);

impl BtManager {
    /// Inspect a selected file's contiguous readable prefix and, when the
    /// minimum playback window is ready, return the task-bound Range URL.
    pub async fn playability(
        &self,
        info_hash: &str,
        file_index: usize,
        prepare: bool,
    ) -> AppResult<BtPlayability> {
        let (info_hash, _operation) = self.task_operation(info_hash).await?;
        let info_hash = info_hash.as_str();
        let hash = parse_info_hash(info_hash)?;
        let task = self
            .repository
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError::custom(CustomErrorCode::BtTaskNotFound))?;
        if !task.file_indices.is_empty() && !task.file_indices.contains(&file_index) {
            return Err(AppError::custom(CustomErrorCode::BtFileNotInTask));
        }
        let session = self.ensure_engine().await?;
        let handle = find_handle(&session, &hash)?
            .ok_or_else(|| AppError::custom(CustomErrorCode::BtTaskNotInitialized))?;
        let (total_bytes, file_name) = handle
            .with_metadata(|metadata| {
                metadata.file_infos.get(file_index).map(|file| {
                    (
                        file.len,
                        file.relative_filename.to_string_lossy().into_owned(),
                    )
                })
            })
            .map_err(|error| {
                AppError::external(
                    "bt:metadata",
                    format!("Torrent metadata is not ready: {error:#}"),
                )
            })?
            .ok_or_else(|| AppError::custom(CustomErrorCode::BtFileNotFound))?;
        let content_type = mime_guess::from_path(&file_name)
            .first_or_octet_stream()
            .to_string();
        let supported = content_type.starts_with("video/")
            || content_type.starts_with("audio/")
            || content_type.starts_with("image/")
            || content_type.starts_with("text/");
        let minimum_bytes = total_bytes.min(READ_PROBE_BYTES);
        if !supported || total_bytes == 0 {
            return Ok(BtPlayability {
                info_hash: info_hash.to_string(),
                file_index,
                file_name,
                supported,
                total_bytes,
                contiguous_bytes: 0,
                minimum_bytes,
                ready: false,
                loading: false,
                reason: Some(if total_bytes == 0 {
                    "empty_file".into()
                } else {
                    "unsupported_format".into()
                }),
                url: None,
            });
        }
        if !matches!(
            timeout(PLAYABILITY_READY_TIMEOUT, handle.wait_until_initialized()).await,
            Ok(Ok(()))
        ) {
            return Ok(BtPlayability {
                info_hash: info_hash.to_string(),
                file_index,
                file_name,
                supported,
                total_bytes,
                contiguous_bytes: 0,
                minimum_bytes,
                ready: false,
                loading: true,
                reason: Some("initializing".into()),
                url: None,
            });
        }
        // Verified pieces are readable while paused; preview never resumes traffic.
        let _ = prepare;
        let probe_len = minimum_bytes;
        let mut contiguous_bytes = 0;
        // Preview clients share the engine's finite IO permits. A readiness
        // probe must not hold task admission indefinitely while they are busy.
        if let Ok(Ok(mut stream)) =
            timeout(READ_PROBE_TIMEOUT, handle.clone().stream(file_index)).await
        {
            let mut buffer = vec![0u8; probe_len as usize];
            if matches!(
                timeout(READ_PROBE_TIMEOUT, stream.read_exact(&mut buffer)).await,
                Ok(Ok(_))
            ) {
                contiguous_bytes = probe_len;
            }
        }
        let ready = contiguous_bytes >= minimum_bytes;
        let url = if ready {
            self.engine
                .lock()
                .await
                .as_ref()
                .and_then(|engine| engine.stream_server.as_ref())
                .map(|server| server.url_for(info_hash, file_index))
        } else {
            None
        };
        Ok(BtPlayability {
            info_hash: info_hash.to_string(),
            file_index,
            file_name,
            supported,
            total_bytes,
            contiguous_bytes,
            minimum_bytes,
            ready,
            loading: !ready,
            reason: (!ready).then(|| "not_contiguous".into()),
            url,
        })
    }
}
