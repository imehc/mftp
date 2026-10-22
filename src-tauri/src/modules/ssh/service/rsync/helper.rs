//! rsync remote-shell helper. This mode is entered before Tauri starts, so a
//! transfer must stay independent of windows, storage and keychain state.

use super::protocol::{
    encode_handshake, helper_task_dir, is_helper_path, write_frame, HelperHandshake, SOCKET_FILE,
    TOKEN_FILE,
};
use std::io::{Read, Write};
use std::mem::ManuallyDrop;
use std::os::unix::io::FromRawFd;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const CONNECT_RETRY: Duration = Duration::from_secs(10);
const ACK_TIMEOUT: Duration = Duration::from_secs(10);
const CHUNK: usize = 32 * 1024;

/// Returns false for a normal application launch. A successful helper run
/// always exits the process, so callers can branch before Tauri initializes.
pub(crate) fn run_if_requested() -> bool {
    let mut args = std::env::args_os();
    let Some(program) = args.next() else {
        return false;
    };
    let program = PathBuf::from(program);
    if !is_helper_path(&program) {
        return false;
    }
    let code = match helper_main(&program, args.collect()) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("mftp rsync helper failed: {error}");
            1
        }
    };
    std::process::exit(code);
}

fn helper_main(program: &Path, args: Vec<std::ffi::OsString>) -> Result<(), String> {
    let task_dir =
        helper_task_dir(program).ok_or("helper was not started from a task directory")?;
    let token = std::fs::read_to_string(task_dir.join(TOKEN_FILE))
        .map_err(|error| format!("reading the task token: {error}"))?
        .trim()
        .to_string();
    if token.is_empty() {
        return Err("task token is empty".into());
    }
    let argv: Vec<String> = args
        .iter()
        .skip(1)
        .map(|arg| {
            arg.to_str()
                .map(str::to_string)
                .ok_or_else(|| "remote command argument is not UTF-8".to_string())
        })
        .collect::<Result<_, _>>()?;
    if argv.len() < 2 || args.is_empty() {
        return Err("remote command is missing".into());
    }

    let socket_path = task_dir.join(SOCKET_FILE);
    let mut stream = connect_retry(&socket_path)?;
    stream
        .set_read_timeout(Some(ACK_TIMEOUT))
        .map_err(|error| format!("configuring the handshake: {error}"))?;
    let payload = encode_handshake(&HelperHandshake { token, argv })
        .map_err(|error| format!("encoding the handshake: {error}"))?;
    write_frame(&mut stream, &payload)
        .map_err(|error| format!("sending the handshake: {error}"))?;
    let mut ack = [0u8; 1];
    stream
        .read_exact(&mut ack)
        .map_err(|error| format!("waiting for the bridge: {error}"))?;
    if ack[0] != 1 {
        return Err("bridge rejected the handshake".into());
    }
    stream
        .set_nonblocking(true)
        .map_err(|error| format!("configuring the bridge socket: {error}"))?;
    pump(stream)
}

fn connect_retry(path: &Path) -> Result<UnixStream, String> {
    let deadline = Instant::now() + CONNECT_RETRY;
    loop {
        match UnixStream::connect(path) {
            Ok(stream) => return Ok(stream),
            Err(error) if Instant::now() < deadline => {
                let kind = error.kind();
                if !matches!(
                    kind,
                    std::io::ErrorKind::NotFound
                        | std::io::ErrorKind::ConnectionRefused
                        | std::io::ErrorKind::WouldBlock
                ) {
                    return Err(format!("connecting to the bridge: {error}"));
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(error) => return Err(format!("connecting to the bridge: {error}")),
        }
    }
}

fn pump(mut stream: UnixStream) -> Result<(), String> {
    let (tx, rx) = mpsc::sync_channel::<Option<Vec<u8>>>(16);
    std::thread::Builder::new()
        .name("rsync-helper-stdin".into())
        .spawn(move || {
            let mut stdin = std::io::stdin();
            let mut buffer = vec![0u8; CHUNK];
            loop {
                match stdin.read(&mut buffer) {
                    Ok(0) | Err(_) => {
                        let _ = tx.send(None);
                        break;
                    }
                    Ok(count) => {
                        if tx.send(Some(buffer[..count].to_vec())).is_err() {
                            break;
                        }
                    }
                }
            }
        })
        .map_err(|error| format!("starting the stdin reader: {error}"))?;

    // rsync sets our stdout to O_NONBLOCK and consumes it while we run. Raw fd1
    // avoids std's line buffering stranding protocol bytes until close. The
    // ManuallyDrop wrapper keeps fd1 owned by rsync's pipe, not by this File.
    let mut stdout = ManuallyDrop::new(unsafe { std::fs::File::from_raw_fd(1) });
    let mut up: Vec<u8> = Vec::new();
    let mut down: Vec<u8> = Vec::new();
    let mut buffer = vec![0u8; CHUNK];
    let mut stdin_done = false;
    let mut socket_done = false;
    let mut write_closed = false;
    loop {
        let mut progressed = false;
        if up.is_empty() && !stdin_done {
            match rx.try_recv() {
                Ok(Some(chunk)) => {
                    up = chunk;
                    progressed = true;
                }
                Ok(None) | Err(mpsc::TryRecvError::Disconnected) => stdin_done = true,
                Err(mpsc::TryRecvError::Empty) => {}
            }
        }
        if !up.is_empty() {
            match stream.write(&up) {
                Ok(count) if count > 0 => {
                    up.drain(..count);
                    progressed = true;
                }
                Ok(_) => {}
                Err(error) if is_pending(&error) => {}
                Err(error) => return Err(format!("forwarding rsync input: {error}")),
            }
        }
        if stdin_done && up.is_empty() && !write_closed {
            // The remote server treats EOF as the end of this side's request.
            let _ = stream.shutdown(std::net::Shutdown::Write);
            write_closed = true;
        }
        if down.is_empty() && !socket_done {
            match stream.read(&mut buffer) {
                Ok(0) => {
                    socket_done = true;
                    progressed = true;
                }
                Ok(count) => {
                    down = buffer[..count].to_vec();
                    progressed = true;
                }
                Err(error) if is_pending(&error) => {}
                Err(error) => return Err(format!("reading the bridge: {error}")),
            }
        }
        if !down.is_empty() {
            match stdout.write(&down) {
                Ok(count) if count > 0 => {
                    down.drain(..count);
                    progressed = true;
                }
                Ok(_) => {}
                Err(error) if is_pending(&error) => {}
                Err(error) => return Err(format!("forwarding rsync output: {error}")),
            }
        }
        if socket_done && down.is_empty() {
            break;
        }
        if !progressed {
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    Ok(())
}

fn is_pending(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
    )
}

#[cfg(test)]
#[path = "helper_tests.rs"]
mod tests;
