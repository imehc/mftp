use super::types::{Manager, TransferFlag, TransferGuard};
use crate::error::{AppError, AppResult, CustomErrorCode};
use std::sync::atomic::Ordering;
use std::sync::Arc;

impl Manager {
    pub fn cancel_all_transfers(&self) {
        let flags: Vec<Arc<TransferFlag>> = self.transfers.lock().values().cloned().collect();
        for flag in flags {
            let mut control = flag.control.lock();
            control.cancelled = true;
            control.paused = false;
            flag.control_changed.notify_all();
        }
    }

    pub fn cancel_transfer(&self, transfer_id: &str) {
        let mut transfers = self.transfers.lock();
        let flag = transfers
            .entry(transfer_id.to_string())
            .or_insert_with(|| Arc::new(TransferFlag::new(true, false)));
        let mut control = flag.control.lock();
        control.cancelled = true;
        control.paused = false;
        flag.control_changed.notify_all();
    }

    pub fn pause_transfer(&self, transfer_id: &str) -> AppResult<()> {
        let transfers = self.transfers.lock();
        let Some(flag) = transfers.get(transfer_id) else {
            return Err(AppError::custom(CustomErrorCode::SftpTransferNotFound));
        };
        let mut control = flag.control.lock();
        if !control.pausable {
            return Err(AppError::custom(CustomErrorCode::SftpTransferNotPausable));
        }
        if control.cancelled {
            return Err(AppError::custom(CustomErrorCode::SftpTransferCancelled));
        }
        control.paused = true;
        Ok(())
    }

    pub fn resume_transfer(&self, transfer_id: &str) -> AppResult<()> {
        let transfers = self.transfers.lock();
        let Some(flag) = transfers.get(transfer_id) else {
            return Err(AppError::custom(CustomErrorCode::SftpTransferNotFound));
        };
        let mut control = flag.control.lock();
        if control.cancelled {
            return Err(AppError::custom(CustomErrorCode::SftpTransferCancelled));
        }
        control.paused = false;
        flag.control_changed.notify_all();
        Ok(())
    }

    pub(super) fn transfer_guard(&self, transfer_id: Option<&str>) -> Option<TransferGuard> {
        // Transfers without a public progress ID still participate in shutdown.
        let id = transfer_id
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let mut transfers = self.transfers.lock();
        let flag = transfers
            .entry(id.clone())
            .or_insert_with(|| Arc::new(TransferFlag::new(self.operations.is_closed(), false)))
            .clone();
        flag.refs.fetch_add(1, Ordering::SeqCst);
        Some(TransferGuard {
            id,
            flag,
            transfers: self.transfers.clone(),
        })
    }
}

#[cfg(test)]
#[path = "transfer_control_tests.rs"]
mod tests;
