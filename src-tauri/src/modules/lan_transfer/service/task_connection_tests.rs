use super::*;
use crate::modules::lan_transfer::service::tests::transfer_tasks;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

fn pair() -> (TcpStream, TcpStream) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (server, _) = listener.accept().unwrap();
    server
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    (client, server)
}

fn row(id: &str) -> LanTransferTask {
    let mut row = transfer_tasks(10).lock().rows["task"].clone();
    row.id = id.into();
    row
}

#[test]
fn visible_task_can_be_cancelled_before_first_read_and_other_socket_stays_open() {
    let tasks = SharedTasks::default();
    let (_client, mut server) = pair();
    let (mut other_client, mut other_server) = pair();
    let guard = start_task(&tasks, row("task"), Some(server.try_clone().unwrap()));
    let _other = start_task(
        &tasks,
        row("other"),
        Some(other_server.try_clone().unwrap()),
    );
    cancel_task(&tasks, "task");
    cancel_task(&tasks, "task");
    cancel_task(&tasks, "missing");
    assert_closed(&mut server);
    let error = finish_task(&tasks, "task", Ok(())).unwrap_err();
    assert_eq!(
        error,
        AppError::custom(CustomErrorCode::LanTransferCancelled)
    );
    other_client.write_all(b"x").unwrap();
    let mut byte = [0];
    other_server.read_exact(&mut byte).unwrap();
    assert_eq!(byte, [b'x']);
    drop(guard);
    assert_eq!(tasks.lock().connections.len(), 1);
    assert_eq!(tasks.lock().rows["other"].status, "running");
}

#[test]
fn completion_wins_before_cancel_without_closing_the_socket() {
    let tasks = SharedTasks::default();
    let (mut client, mut server) = pair();
    let _guard = start_task(&tasks, row("task"), Some(server.try_clone().unwrap()));
    finish_task(&tasks, "task", Ok(())).unwrap();
    cancel_task(&tasks, "task");
    client.write_all(b"x").unwrap();
    server.read_exact(&mut [0]).unwrap();
    assert_eq!(tasks.lock().rows["task"].status, "success");
}

#[test]
fn stale_guard_cannot_remove_replacement_or_cross_runtime_generations() {
    let tasks = SharedTasks::default();
    let (_old_client, old_server) = pair();
    let (_new_client, mut new_server) = pair();
    let old = start_task(&tasks, row("task"), Some(old_server));
    let _new = start_task(&tasks, row("task"), Some(new_server.try_clone().unwrap()));
    drop(old);
    assert_eq!(tasks.lock().connections.len(), 1);
    assert_eq!(tasks.lock().rows["task"].status, "running");
    let next_runtime = SharedTasks::default();
    let (mut next_client, mut next_server) = pair();
    let _next = start_task(
        &next_runtime,
        row("task"),
        Some(next_server.try_clone().unwrap()),
    );
    cancel_task(&tasks, "task");
    assert_closed(&mut new_server);
    next_client.write_all(b"x").unwrap();
    next_server.read_exact(&mut [0]).unwrap();
}

#[test]
fn pruning_keeps_cancellation_until_the_io_owner_releases_registration() {
    let tasks = SharedTasks::default();
    let (_client, server) = pair();
    let guard = start_task(&tasks, row("task"), Some(server));
    cancel_task(&tasks, "task");
    tasks.lock().rows.get_mut("task").unwrap().updated_at = 0;
    prune_tasks(&tasks);
    assert!(task_is_canceled(&tasks, "task"));
    drop(guard);
    prune_tasks(&tasks);
    assert!(tasks.lock().rows.is_empty());
    assert!(tasks.lock().connections.is_empty());
}

#[test]
fn unwinding_releases_registration_and_does_not_leave_a_running_task() {
    let tasks = SharedTasks::default();
    let (_client, server) = pair();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = start_task(&tasks, row("task"), Some(server));
        panic!("simulated worker panic");
    }));
    assert!(result.is_err());
    assert!(tasks.lock().connections.is_empty());
    assert_eq!(tasks.lock().rows["task"].status, "failed");
    assert_eq!(
        tasks.lock().rows["task"].error,
        Some(AppError::custom(CustomErrorCode::LanTransferIncomplete))
    );
}

fn assert_closed(stream: &mut TcpStream) {
    match stream.read(&mut [0]) {
        Ok(count) => assert_eq!(count, 0),
        Err(error) => assert!(matches!(
            error.kind(),
            std::io::ErrorKind::ConnectionReset
                | std::io::ErrorKind::ConnectionAborted
                | std::io::ErrorKind::NotConnected
                | std::io::ErrorKind::BrokenPipe
        )),
    }
}
