//! Cancellation keeps BT history while releasing engine and owned disk data.

use std::path::PathBuf;
use std::sync::Arc;

use librqbit::Session;

use super::export::{partial_archive_path, remove_file_if_exists};
use super::{find_handle, parse_info_hash, BtManager};
use crate::error::{AppError, AppResult};

impl BtManager {
    pub(super) async fn cancel_task(
        &self,
        session: &Arc<Session>,
        info_hash: &str,
    ) -> AppResult<()> {
        let initial = self
            .storage
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError("任务不存在".into()))?;
        if initial.status == "completed" {
            return Err(AppError("任务已完成，无法取消".into()));
        }

        self.cancel_archive_job(info_hash);
        self.wait_for_archive_job(info_hash).await?;
        let _gate = self.archive_gate.lock().await;

        // The archive can finish between the user's click and acquisition of
        // the finalization gate. Re-read before deleting any output.
        let row = self
            .storage
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError("任务不存在".into()))?;
        if row.status == "completed" {
            return Err(AppError("任务已完成，无法取消".into()));
        }

        let hash = parse_info_hash(info_hash)?;
        if find_handle(session, &hash)?.is_some() {
            let remove_engine_files = row.mode == "preview" || row.package_mode == "archive";
            session
                .delete(hash.into(), remove_engine_files)
                .await
                .map_err(|error| AppError(format!("取消 BT 任务失败: {error:#}")))?;
        }

        if let Some(output) = row.output_path.as_deref() {
            let output = PathBuf::from(output);
            let partial = partial_archive_path(&output, info_hash)?;
            remove_file_if_exists(&partial)?;
        }
        self.remove_owned_task_dir(&row)?;
        self.storage.mark_bt_task_cancelled(info_hash)?;
        super::cache::emit_event(&self.app, info_hash, "cancelled");
        Ok(())
    }
}
