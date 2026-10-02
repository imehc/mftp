//! Cancellation keeps BT history while releasing engine and owned disk data.

use std::path::PathBuf;
use std::sync::Arc;

use librqbit::Session;

use super::export::{partial_archive_path, remove_file_if_exists};
use super::{find_handle, parse_info_hash, BtManager};
use crate::error::{AppError, AppResult, CustomErrorCode};

impl BtManager {
    pub(super) async fn remove_task_data(
        &self,
        session: &Arc<Session>,
        info_hash: &str,
        delete_files: bool,
    ) -> AppResult<()> {
        let row = self.repository.get_bt_task(info_hash)?;
        self.cancel_finalize_job(info_hash).await?;
        let _gate = self.finalize_gate.lock().await;

        if let Ok(hash) = parse_info_hash(info_hash) {
            if find_handle(session, &hash)?.is_some() {
                let remove_engine_files =
                    delete_files || row.as_ref().is_some_and(|task| task.status != "completed");
                session
                    .delete(hash.into(), remove_engine_files)
                    .await
                    .map_err(|error| {
                        AppError::external(
                            "bt:engine",
                            format!("Failed to delete BT session: {error:#}"),
                        )
                    })?;
            }
        }

        if let Some(task) = row.as_ref() {
            if let Some(output) = task.output_path.as_deref() {
                let output = PathBuf::from(output);
                if let Ok(partial) = partial_archive_path(&output, info_hash) {
                    remove_file_if_exists(&partial)?;
                }
                if task.package_mode == "archive" && (delete_files || task.status == "packaging") {
                    remove_file_if_exists(&output)?;
                }
            }
            self.remove_owned_task_dir(task)?;
        }
        self.repository.delete_bt_access(info_hash)?;
        self.repository.delete_bt_task(info_hash)?;
        super::super::ports::emit_task(
            &self.events,
            super::BtTaskEvent::Removed {
                info_hash: info_hash.to_owned(),
            },
        );
        Ok(())
    }

    pub(super) async fn cancel_task(
        &self,
        session: &Arc<Session>,
        info_hash: &str,
    ) -> AppResult<()> {
        let initial = self
            .repository
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError::custom(CustomErrorCode::BtTaskNotFound))?;
        if initial.status == "completed" {
            return Err(AppError::custom(CustomErrorCode::BtTaskCompletedNoCancel));
        }

        self.cancel_finalize_job(info_hash).await?;
        let _gate = self.finalize_gate.lock().await;

        // The archive can finish between the user's click and acquisition of
        // the finalization gate. Re-read before deleting any output.
        let row = self
            .repository
            .get_bt_task(info_hash)?
            .ok_or_else(|| AppError::custom(CustomErrorCode::BtTaskNotFound))?;
        if row.status == "completed" {
            return Err(AppError::custom(CustomErrorCode::BtTaskCompletedNoCancel));
        }

        let hash = parse_info_hash(info_hash)?;
        if find_handle(session, &hash)?.is_some() {
            // Let the engine drop its own files whenever they live in an
            // archive staging tree or a plain-download part directory.
            let remove_engine_files = true;
            session
                .delete(hash.into(), remove_engine_files)
                .await
                .map_err(|error| {
                    AppError::external("bt:engine", format!("Failed to cancel BT task: {error:#}"))
                })?;
        }

        if let Some(output) = row.output_path.as_deref() {
            let output = PathBuf::from(output);
            let partial = partial_archive_path(&output, info_hash)?;
            remove_file_if_exists(&partial)?;
        }
        self.remove_owned_task_dir(&row)?;
        self.repository.mark_bt_task_cancelled(info_hash)?;
        super::super::ports::emit_task(
            &self.events,
            super::BtTaskEvent::Cancelled {
                info_hash: info_hash.to_owned(),
            },
        );
        Ok(())
    }
}
