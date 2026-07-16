use crate::models::LanTransferTask;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;

pub(super) struct TransferPermit {
    active: Arc<Mutex<usize>>,
}

impl Drop for TransferPermit {
    fn drop(&mut self) {
        let mut active = self.active.lock();
        *active = active.saturating_sub(1);
    }
}

pub(super) fn prune_tasks(tasks: &Arc<Mutex<HashMap<String, LanTransferTask>>>) {
    let cutoff = super::now_ms().saturating_sub(30 * 60 * 1000);
    tasks
        .lock()
        .retain(|_, task| task.status == "running" || task.updated_at >= cutoff);
}

pub(super) fn upsert_task(
    tasks: &Arc<Mutex<HashMap<String, LanTransferTask>>>,
    task: LanTransferTask,
) {
    tasks.lock().insert(task.id.clone(), task);
}

pub(super) fn try_acquire_transfer(
    active_transfers: &Arc<Mutex<usize>>,
    max_concurrent_transfers: usize,
) -> Option<TransferPermit> {
    let max = max_concurrent_transfers.max(1);
    let mut active = active_transfers.lock();
    if *active >= max {
        return None;
    }
    *active += 1;
    Some(TransferPermit {
        active: active_transfers.clone(),
    })
}

pub(super) fn update_task_progress(
    tasks: &Arc<Mutex<HashMap<String, LanTransferTask>>>,
    id: &str,
    transferred: u64,
    status: &str,
) {
    if let Some(task) = tasks.lock().get_mut(id) {
        task.transferred = transferred.min(task.total);
        task.status = status.to_string();
        task.updated_at = super::now_ms();
    }
}

pub(super) fn task_is_canceled(
    tasks: &Arc<Mutex<HashMap<String, LanTransferTask>>>,
    id: &str,
) -> bool {
    tasks
        .lock()
        .get(id)
        .is_some_and(|task| task.status == "canceled")
}
