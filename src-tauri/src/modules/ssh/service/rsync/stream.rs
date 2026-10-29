//! Nonblocking bridge between the helper's Unix socket and the remote rsync
//! channel. One thread owns both sides so EOF and cancellation stay ordered.

use super::super::diagnostics::{call, unit};
use super::bridge::{bridge_error, local_exit, BridgeOptions};
use super::local::{push_tail, LocalRsync, STDERR_LIMIT};
use super::protocol::remote_command_line;
use crate::core::diagnostics::context;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ssh::ports::emit_progress;
use serde_json::json;
use ssh2::Channel;
use std::io::{Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::time::{Duration, Instant};

const CHANNEL_TIMEOUT: Duration = Duration::from_secs(30);
const ABORT_TIMEOUT: Duration = Duration::from_secs(3);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(5);
const CHILD_EXIT_GRACE: Duration = Duration::from_secs(10);
const PENDING_LIMIT: usize = 1024 * 1024;
const IO_CHUNK: usize = 64 * 1024;

pub(super) struct RemoteOutcome {
    pub(super) exit: Option<i32>,
    pub(super) stderr: String,
    pub(super) network_bytes: u64,
}

pub(super) fn bridge_stream(
    mut stream: UnixStream,
    argv: &[String],
    options: &BridgeOptions<'_>,
    local: &mut LocalRsync,
) -> AppResult<RemoteOutcome> {
    let remote_line = remote_command_line(options.remote_rsync, argv.get(1..).unwrap_or(&[]));
    let remote_index = context::record(|log| log.command(&remote_line, false)).flatten();
    let session = super::super::auth::connect(&options.material)?;
    session.set_timeout(CHANNEL_TIMEOUT.as_millis() as u32);
    let mut channel = call(
        "ssh.channelSession",
        json!({}),
        || session.channel_session(),
        unit,
    )?;
    call(
        "ssh.exec",
        json!({"command": &remote_line, "stdoutCaptured": false}),
        || channel.exec(&remote_line),
        unit,
    )?;
    session.set_blocking(false);

    let mut up: Vec<u8> = Vec::new();
    let mut down: Vec<u8> = Vec::new();
    let mut input = vec![0u8; IO_CHUNK];
    let mut output = vec![0u8; IO_CHUNK];
    let mut remote_stderr: Vec<u8> = Vec::new();
    let mut network_bytes = 0u64;
    let mut last_progress = Instant::now();
    let mut emitted_progress = 0u64;
    let mut socket_eof = false;
    let mut channel_eof = false;
    let mut eof_sent = false;
    let mut write_shutdown = false;
    let mut keepalive_at = Instant::now();
    let mut failure = None;
    let mut cancelled = false;
    let mut abort_at: Option<Instant> = None;
    let mut aborting = false;

    loop {
        let mut progressed = false;
        if let Some(transfer) = options.transfer {
            if let Err(error) = transfer.check() {
                failure = Some(error);
                cancelled = true;
                aborting = true;
                break;
            }
        }
        if let Err(error) = local.poll() {
            failure = Some(error);
            aborting = true;
            break;
        }
        if local.progress_bytes > emitted_progress
            && last_progress.elapsed() >= Duration::from_millis(120)
        {
            emit_progress(
                options.events,
                options.transfer_id,
                options.phase,
                local.progress_bytes,
                None,
            );
            emitted_progress = local.progress_bytes;
            last_progress = Instant::now();
        }
        if local.exit.is_some_and(|status| !status.success()) && abort_at.is_none() {
            abort_at = Some(Instant::now() + CHILD_EXIT_GRACE);
        }
        if up.len() < PENDING_LIMIT && !socket_eof {
            match stream.read(&mut input) {
                Ok(0) => socket_eof = true,
                Ok(count) => {
                    // After the remote side closed, keep draining the helper so
                    // it can exit, but discard input it can no longer consume.
                    if !channel_eof {
                        up.extend_from_slice(&input[..count]);
                    }
                    progressed = true;
                }
                Err(error) if is_io_pending(&error) => {}
                Err(error) => {
                    failure = Some(bridge_error(error, "reading the rsync helper"));
                    aborting = true;
                    break;
                }
            }
        }
        if !up.is_empty() && !channel_eof {
            match channel.write(&up) {
                Ok(0) => {}
                Ok(count) => {
                    up.drain(..count);
                    network_bytes = network_bytes.saturating_add(count as u64);
                    progressed = true;
                }
                Err(error) if is_io_pending(&error) => {}
                Err(error) => {
                    failure = Some(bridge_error(error, "forwarding rsync input"));
                    aborting = true;
                    break;
                }
            }
        }
        if socket_eof && up.is_empty() && !eof_sent && !channel_eof {
            match channel.send_eof() {
                Ok(()) => eof_sent = true,
                Err(error) if is_ssh_pending(&error) => {}
                Err(error) => {
                    failure = Some(bridge_error(error, "closing remote rsync input"));
                    aborting = true;
                    break;
                }
            }
        }
        if down.is_empty() && !channel_eof {
            match channel.read(&mut output) {
                Ok(0) => {}
                Ok(count) => {
                    down = output[..count].to_vec();
                    network_bytes = network_bytes.saturating_add(count as u64);
                    if let Some(index) = remote_index {
                        context::record(|log| log.command_bytes(index, false, &down));
                    }
                    progressed = true;
                }
                Err(error) if is_io_pending(&error) => {}
                Err(error) => {
                    failure = Some(bridge_error(error, "reading remote rsync output"));
                    aborting = true;
                    break;
                }
            }
        }
        if !down.is_empty() {
            match stream.write(&down) {
                Ok(0) => {}
                Ok(count) => {
                    down.drain(..count);
                    progressed = true;
                }
                Err(error) if is_io_pending(&error) => {}
                Err(error) => {
                    failure = Some(bridge_error(error, "forwarding remote rsync output"));
                    aborting = true;
                    break;
                }
            }
        }
        match channel.stderr().read(&mut input) {
            Ok(0) => {}
            Ok(count) => {
                push_tail(&mut remote_stderr, &input[..count], STDERR_LIMIT);
                network_bytes = network_bytes.saturating_add(count as u64);
                if let Some(index) = remote_index {
                    context::record(|log| log.command_bytes(index, true, &input[..count]));
                }
                progressed = true;
            }
            Err(error) if is_io_pending(&error) => {}
            Err(error) => {
                failure = Some(bridge_error(error, "reading remote rsync diagnostics"));
                aborting = true;
                break;
            }
        }
        if channel.eof() {
            channel_eof = true;
        }
        if channel_eof && !write_shutdown {
            let _ = stream.shutdown(Shutdown::Write);
            write_shutdown = true;
        }
        if keepalive_at.elapsed() >= KEEPALIVE_INTERVAL {
            match session.keepalive_send() {
                Ok(_) => {}
                Err(error) if is_ssh_pending(&error) => {}
                Err(error) => {
                    failure =
                        Some(AppError::from(error).context("Keeping the rsync session alive"));
                    aborting = true;
                    break;
                }
            }
            keepalive_at = Instant::now();
        }
        if socket_eof && channel_eof && up.is_empty() && down.is_empty() {
            break;
        }
        if abort_at.is_some_and(|deadline| Instant::now() >= deadline) {
            failure = Some(
                AppError::custom(CustomErrorCode::RsyncBridgeTimeout).with_arg(
                    "detail",
                    "remote rsync did not close after the local process exited",
                ),
            );
            aborting = true;
            break;
        }
        if !progressed {
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    let finished = finish_channel(&mut channel, remote_index, aborting);
    if let Some(error) = failure {
        if cancelled || local.exit.is_none_or(|status| status.success()) {
            return Err(error);
        }
        return Err(local_exit(local.exit));
    }
    let exit = finished?;
    Ok(RemoteOutcome {
        exit,
        stderr: String::from_utf8_lossy(&remote_stderr).into_owned(),
        network_bytes,
    })
}

fn finish_channel(
    channel: &mut Channel,
    index: Option<usize>,
    aborting: bool,
) -> AppResult<Option<i32>> {
    let deadline = Instant::now()
        + if aborting {
            ABORT_TIMEOUT
        } else {
            CHANNEL_TIMEOUT
        };
    if aborting {
        let _ = channel.close();
    }
    loop {
        match channel.wait_close() {
            Ok(()) => break,
            Err(error) if is_ssh_pending(&error) && Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(error) if is_ssh_pending(&error) && !aborting => {
                record_remote_end(index, None);
                return Err(AppError::custom(CustomErrorCode::RsyncBridgeTimeout)
                    .with_arg("detail", "remote rsync did not close the channel"));
            }
            Err(_) if aborting => break,
            Err(error) => {
                record_remote_end(index, None);
                return Err(bridge_error(error, "closing the remote rsync channel"));
            }
        }
    }
    let exit = channel.exit_status().ok();
    record_remote_end(index, exit);
    Ok(exit)
}

fn record_remote_end(index: Option<usize>, exit: Option<i32>) {
    if let Some(index) = index {
        context::record(|log| log.command_end(index, exit, None));
    }
}

fn is_io_pending(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
    )
}

fn is_ssh_pending(error: &ssh2::Error) -> bool {
    matches!(error.code(), ssh2::ErrorCode::Session(-37))
}
