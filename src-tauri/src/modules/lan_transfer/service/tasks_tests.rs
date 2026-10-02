use super::*;

use crate::modules::lan_transfer::service::tests::transfer_tasks as tasks;

#[test]
fn cancellation_wins_over_late_progress_and_success() {
    let tasks = tasks(10);
    update_task_progress(&tasks, "task", 5);
    cancel_task(&tasks, "task");
    assert_eq!(
        tasks.lock().rows["task"].error,
        Some(AppError::custom(CustomErrorCode::LanTransferCancelled))
    );
    update_task_progress(&tasks, "task", 10);
    assert_eq!(
        finish_task(&tasks, "task", Ok(())).unwrap_err().code,
        "lan:transfer_cancelled"
    );
    update_task_progress(&tasks, "task", 0);
    let tasks = tasks.lock();
    assert_eq!(tasks.rows["task"].status, "canceled");
    assert_eq!(tasks.rows["task"].transferred, 10);
}

#[test]
fn failure_retains_progress_and_full_error_and_cannot_be_revived() {
    let tasks = tasks(10);
    update_task_progress(&tasks, "task", 4);
    let error =
        AppError::external("io:broken_pipe", "Connection closed").with_arg("file", "sample");
    let actual =
        finish_task(&tasks, "task", Err(std::io::Error::other(error.clone()))).unwrap_err();
    assert_eq!(actual, error);
    update_task_progress(&tasks, "task", 0);
    assert_eq!(tasks.lock().rows["task"].transferred, 4);
    assert_eq!(tasks.lock().rows["task"].status, "failed");
    assert_eq!(tasks.lock().rows["task"].error, Some(error.clone()));
    assert_eq!(finish_task(&tasks, "task", Ok(())).unwrap_err(), error);
    cancel_task(&tasks, "task");
    assert_eq!(tasks.lock().rows["task"].error, Some(error));
}

#[test]
fn successful_completion_is_terminal() {
    let tasks = tasks(10);
    update_task_progress(&tasks, "task", 10);
    finish_task(&tasks, "task", Ok(())).unwrap();
    update_task_progress(&tasks, "task", 2);
    assert_eq!(tasks.lock().rows["task"].status, "success");
    assert_eq!(tasks.lock().rows["task"].transferred, 10);
    finish_task(&tasks, "task", Err(std::io::ErrorKind::BrokenPipe.into())).unwrap();
    cancel_task(&tasks, "task");
    assert!(tasks.lock().rows["task"].error.is_none());
}

#[test]
fn cancellation_keeps_its_payload_when_finishing() {
    let tasks = tasks(10);
    let error = AppError::custom(CustomErrorCode::LanTransferCancelled).with_arg("file", "sample");
    tasks.lock().rows.get_mut("task").unwrap().status = "canceled".into();
    let actual =
        finish_task(&tasks, "task", Err(std::io::Error::other(error.clone()))).unwrap_err();
    assert_eq!(actual, error);
    assert_eq!(tasks.lock().rows["task"].status, "canceled");
    assert_eq!(tasks.lock().rows["task"].error, Some(error.clone()));
    let repeated =
        finish_task(&tasks, "task", Err(std::io::ErrorKind::BrokenPipe.into())).unwrap_err();
    assert_eq!(repeated, error);
}

#[test]
fn task_snapshots_round_trip_full_errors_and_read_older_rows() {
    for error in [
        AppError::custom(CustomErrorCode::LanTransferCancelled).with_arg("file", "sample"),
        AppError::from(std::io::Error::from_raw_os_error(13)),
    ] {
        let tasks = tasks(10);
        finish_task(&tasks, "task", Err(std::io::Error::other(error.clone()))).unwrap_err();
        let value = serde_json::to_value(&tasks.lock().rows["task"]).unwrap();
        let object = value["error"].as_object().unwrap();
        assert_eq!(object.len(), 4);
        for field in ["kind", "code", "message", "args"] {
            assert!(object.contains_key(field));
        }
        let row: LanTransferTask = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(row.error, Some(error));
        let mut old = value;
        old.as_object_mut().unwrap().remove("error");
        let row: LanTransferTask = serde_json::from_value(old).unwrap();
        assert!(row.error.is_none());
    }
}

#[test]
fn external_error_named_like_cancellation_remains_a_failure() {
    let tasks = tasks(10);
    let error = AppError::external("lan:transfer_cancelled", "External failure");
    finish_task(&tasks, "task", Err(std::io::Error::other(error.clone()))).unwrap_err();
    assert_eq!(tasks.lock().rows["task"].status, "failed");
    assert_eq!(tasks.lock().rows["task"].error, Some(error));
}
