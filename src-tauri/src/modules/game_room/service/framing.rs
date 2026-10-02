//! Bounded newline-delimited frames; byte limits include the terminating LF.

use super::runtime::StopSignal;
use crate::error::{AppError, AppResult, CustomErrorCode};
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, BufReader, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

// Metadata is small; gameplay has room for snapshots as well as individual moves.
pub(super) const HANDSHAKE_FRAME_LIMIT: usize = 16 * 1024;
pub(super) const MESSAGE_FRAME_LIMIT: usize = 256 * 1024;
const READ_POLL: Duration = Duration::from_millis(100);

#[derive(Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(super) enum WireMsg {
    Hello {
        game_id: String,
        code: Option<String>,
        player_name: String,
    },
    Welcome {
        room_id: String,
        room_name: String,
        peer_name: String,
    },
    Reject {
        reason: String,
    },
    App {
        payload: String,
    },
    Ping,
    Pong,
    Leave,
    /// Discovery over plain TCP: a scanner asks, the host answers with
    /// RoomInfo and the connection is dropped without joining.
    Probe,
    RoomInfo {
        room_id: String,
        game_id: String,
        room_name: String,
        host_name: String,
        has_code: bool,
    },
}

pub(super) fn frame_too_large(limit: usize) -> AppError {
    AppError::custom(CustomErrorCode::RoomFrameTooLarge).with_arg("limitBytes", limit)
}

pub(super) fn validate_metadata(fields: &[&str]) -> AppResult<()> {
    // Reject large local input before cloning it into individual protocol frames.
    if fields
        .iter()
        .any(|field| field.len() > HANDSHAKE_FRAME_LIMIT)
    {
        return Err(frame_too_large(HANDSHAKE_FRAME_LIMIT));
    }
    Ok(())
}

pub(super) fn encode(message: &WireMsg) -> AppResult<Vec<u8>> {
    let limit = match message {
        WireMsg::App { .. } => MESSAGE_FRAME_LIMIT,
        _ => HANDSHAKE_FRAME_LIMIT,
    };
    let mut output = FrameBuffer {
        bytes: Vec::new(),
        limit,
        exceeded: false,
    };
    if let Err(error) = serde_json::to_writer(&mut output, message) {
        // serde_json hides its writer's IO payload. Preserve the original size
        // rule instead of degrading it to json:io at that library boundary.
        return Err(if output.exceeded {
            frame_too_large(limit)
        } else {
            error.into()
        });
    }
    output.write_all(b"\n")?;
    Ok(output.bytes)
}

struct FrameBuffer {
    bytes: Vec<u8>,
    limit: usize,
    exceeded: bool,
}

impl Write for FrameBuffer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.limit - self.bytes.len() {
            self.exceeded = true;
            return Err(io::Error::other(frame_too_large(self.limit)));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(super) fn read_message(
    reader: &mut BufReader<TcpStream>,
    stop: &StopSignal,
    limit: usize,
    timeout: Duration,
) -> AppResult<WireMsg> {
    let deadline = Instant::now() + timeout;
    let mut frame = Vec::new();
    loop {
        if stop.is_stopped() {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "Room connection stopped",
            )
            .into());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(
                io::Error::new(io::ErrorKind::TimedOut, "Room frame read timed out").into(),
            );
        }
        reader
            .get_ref()
            .set_read_timeout(Some(remaining.min(READ_POLL)))?;
        let available = match reader.fill_buf() {
            Ok([]) => {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "Room frame ended before its delimiter",
                )
                .into())
            }
            Ok(available) => available,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::Interrupted
                        | io::ErrorKind::WouldBlock
                        | io::ErrorKind::TimedOut
                ) =>
            {
                continue
            }
            Err(error) => return Err(error.into()),
        };
        let end = available.iter().position(|byte| *byte == b'\n');
        let count = end.map_or(available.len(), |end| end + 1);
        if count > limit - frame.len() {
            return Err(frame_too_large(limit));
        }
        frame.extend_from_slice(&available[..count]);
        reader.consume(count);
        if end.is_some() {
            // Consume exactly one frame; pipelined bytes belong to the next phase.
            return serde_json::from_slice(&frame).map_err(AppError::from);
        }
        if frame.len() == limit {
            return Err(frame_too_large(limit));
        }
    }
}

pub(super) fn write_frame(
    stream: &mut TcpStream,
    mut bytes: &[u8],
    deadline: Instant,
) -> io::Result<()> {
    // A per-write socket timeout alone can be renewed forever by a slow reader.
    while !bytes.is_empty() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Room frame write timed out",
            ));
        }
        stream.set_write_timeout(Some(remaining))?;
        match stream.write(bytes) {
            Ok(0) => return Err(io::ErrorKind::WriteZero.into()),
            Ok(count) => bytes = &bytes[count..],
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "framing_tests.rs"]
mod tests;
