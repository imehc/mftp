use crate::error::{AppError, AppErrorKind, AppResult, CustomErrorCode};
use crate::modules::lan_transfer::LanTransferTask;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::net::{Shutdown, TcpStream};
use std::sync::Arc;

pub(super) type SharedTasks = Arc<Mutex<TaskRegistry>>;

#[derive(Default)]
pub(super) struct TaskRegistry {
    pub rows: HashMap<String, LanTransferTask>,
    // The socket is a wake-up handle, not another source of task status.
    connections: HashMap<String, Arc<TcpStream>>,
}

pub(super) struct TaskConnection {
    tasks: SharedTasks,
    id: String,
    connection: Option<Arc<TcpStream>>,
}

impl Drop for TaskConnection {
    fn drop(&mut self) {
        let Some(connection) = &self.connection else {
            return;
        };
        let mut tasks = self.tasks.lock();
        // An old guard must never remove a replacement's wake-up handle.
        if tasks
            .connections
            .get(&self.id)
            .is_some_and(|current| Arc::ptr_eq(current, connection))
        {
            tasks.connections.remove(&self.id);
            if let Some(task) = tasks.rows.get_mut(&self.id) {
                // Unwinding or an early return must not leave a phantom running task.
                if task.status == "running" {
                    task.status = "failed".into();
                    task.error = Some(AppError::custom(CustomErrorCode::LanTransferIncomplete));
                    task.updated_at = super::now_ms();
                }
            }
        }
    }
}

pub(super) fn start_task(
    tasks: &SharedTasks,
    task: LanTransferTask,
    connection: Option<TcpStream>,
) -> TaskConnection {
    let connection = connection.map(Arc::new);
    let id = task.id.clone();
    let mut registry = tasks.lock();
    // Publish the task and wake-up handle atomically: a visible running task
    // must already be cancellable, even before the worker's first read/write.
    if let Some(connection) = &connection {
        registry.connections.insert(id.clone(), connection.clone());
    } else {
        registry.connections.remove(&id);
    }
    registry.rows.insert(id.clone(), task);
    TaskConnection {
        tasks: tasks.clone(),
        id,
        connection,
    }
}

pub(super) fn cancel_task(tasks: &SharedTasks, id: &str) {
    let connection = {
        let mut registry = tasks.lock();
        let Some(task) = registry.rows.get_mut(id) else {
            return;
        };
        if task.status != "running" {
            return;
        }
        task.status = "canceled".into();
        task.error = Some(AppError::custom(CustomErrorCode::LanTransferCancelled));
        task.updated_at = super::now_ms();
        registry.connections.get(id).cloned()
    };
    // Do not hold the task/runtime lock across a syscall. This owned clone
    // identifies the exact socket even if the worker exits or a new run starts.
    if let Some(connection) = connection {
        let _ = connection.shutdown(Shutdown::Both);
    }
}

pub(super) struct TransferPermit {
    active: Arc<Mutex<usize>>,
}

impl Drop for TransferPermit {
    fn drop(&mut self) {
        let mut active = self.active.lock();
        *active = active.saturating_sub(1);
    }
}

pub(super) fn prune_tasks(tasks: &SharedTasks) {
    let cutoff = super::now_ms().saturating_sub(30 * 60 * 1000);
    let mut tasks = tasks.lock();
    let TaskRegistry { rows, connections } = &mut *tasks;
    // Cancellation is not completion; keep its flag while real IO still owns a guard.
    rows.retain(|id, task| {
        connections.contains_key(id) || task.status == "running" || task.updated_at >= cutoff
    });
}

#[cfg(test)]
pub(super) fn upsert_task(tasks: &SharedTasks, task: LanTransferTask) {
    tasks.lock().rows.insert(task.id.clone(), task);
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

pub(super) fn update_task_progress(tasks: &SharedTasks, id: &str, transferred: u64) {
    if let Some(task) = tasks.lock().rows.get_mut(id) {
        if !matches!(task.status.as_str(), "running" | "canceled") {
            return;
        }
        task.transferred = task.transferred.max(transferred.min(task.total));
        // A write already accepted by the socket still counts after cancellation.
        // Progress cannot publish a terminal state without its error payload.
        task.updated_at = super::now_ms();
    }
}

pub(super) fn finish_task(
    tasks: &SharedTasks,
    id: &str,
    result: std::io::Result<()>,
) -> AppResult<()> {
    let mut tasks = tasks.lock();
    let mut result = result.map_err(AppError::from);
    let Some(task) = tasks.rows.get_mut(id) else {
        return result;
    };
    // The same lock is used by cancel_task: whichever terminal transition wins
    // determines both the task state and the outcome recorded by the caller.
    let cancelled = matches!(&result, Err(error) if error.kind == AppErrorKind::Custom
        && error.code == CustomErrorCode::LanTransferCancelled.as_str());
    match task.status.as_str() {
        "success" => return Ok(()),
        "failed" => {
            return Err(task
                .error
                .clone()
                .unwrap_or_else(|| AppError::custom(CustomErrorCode::LanTransferIncomplete)));
        }
        "canceled" => {
            if !cancelled {
                result = Err(task
                    .error
                    .clone()
                    .unwrap_or_else(|| AppError::custom(CustomErrorCode::LanTransferCancelled)));
            }
        }
        _ => {}
    }
    if task.status == "running" {
        task.status = if cancelled {
            "canceled"
        } else if result.is_ok() {
            "success"
        } else {
            "failed"
        }
        .into();
        task.updated_at = super::now_ms();
    }
    task.error = result.as_ref().err().cloned();
    result
}

pub(super) fn task_is_canceled(tasks: &SharedTasks, id: &str) -> bool {
    tasks
        .lock()
        .rows
        .get(id)
        .is_some_and(|task| task.status == "canceled")
}

#[cfg(test)]
#[path = "tasks_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "task_connection_tests.rs"]
mod connection_tests;
