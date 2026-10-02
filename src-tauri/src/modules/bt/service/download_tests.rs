use super::ensure_existing_task_can_be_added;
use crate::modules::bt::repository::BtTaskRow;

fn task(status: &str) -> BtTaskRow {
    BtTaskRow {
        info_hash: "a".repeat(40),
        label: "sample".into(),
        dest_dir: String::new(),
        mode: "download".into(),
        pinned: false,
        created_at: 0,
        work_dir: "/private/download".into(),
        file_indices: vec![0],
        package_mode: "direct".into(),
        status: status.into(),
        output_path: None,
        export_path: None,
        total_bytes: Some(10),
        error: None,
    }
}

#[test]
fn completed_and_packaging_tasks_cannot_be_replaced() {
    assert!(ensure_existing_task_can_be_added(Some(&task("completed")), false).is_err());
    assert!(ensure_existing_task_can_be_added(Some(&task("packaging")), false).is_err());
}

#[test]
fn active_task_requires_an_exact_reuse() {
    assert!(ensure_existing_task_can_be_added(Some(&task("active")), true).is_ok());
    assert!(ensure_existing_task_can_be_added(Some(&task("active")), false).is_err());
}

#[test]
fn failed_or_cancelled_tasks_can_be_retried() {
    assert!(ensure_existing_task_can_be_added(Some(&task("error")), false).is_ok());
    assert!(ensure_existing_task_can_be_added(Some(&task("cancelled")), false).is_ok());
}
