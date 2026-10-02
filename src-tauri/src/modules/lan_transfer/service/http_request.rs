use crate::error::{AppError, AppResult, CustomErrorCode};
use std::io::{self, Read};
use std::net::TcpStream;
use std::time::{Duration, Instant};

const MAX_HEADER_BYTES: usize = 16 * 1024;
const HEADER_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) struct Request {
    pub head: String,
    pub body: Vec<u8>,
}

pub(super) fn read_from_stream(stream: &mut TcpStream) -> AppResult<Option<Request>> {
    let previous = stream.read_timeout()?;
    let result = read_request(&mut HeaderReader {
        stream,
        deadline: Instant::now() + HEADER_TIMEOUT,
    });
    // Header deadlines must not become timeouts for large uploads on slow peers.
    let restored = stream.set_read_timeout(previous);
    let request = result?;
    restored?;
    Ok(request)
}

struct HeaderReader<'a> {
    stream: &'a mut TcpStream,
    deadline: Instant,
}

impl Read for HeaderReader<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let remaining = self.deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::ErrorKind::TimedOut.into());
        }
        self.stream.set_read_timeout(Some(remaining))?;
        self.stream.read(buffer)
    }
}

fn read_request(input: &mut impl Read) -> AppResult<Option<Request>> {
    let mut bytes = Vec::new();
    let mut buffer = [0; 1024];
    loop {
        let count = match input.read(&mut buffer) {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            result => result?,
        };
        if count == 0 {
            return if bytes.is_empty() {
                Ok(None)
            } else {
                Err(invalid_request())
            };
        }
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            let end = end + 4;
            if end > MAX_HEADER_BYTES {
                return Err(AppError::custom(CustomErrorCode::LanRequestHeadersTooLarge));
            }
            let head = std::str::from_utf8(&bytes[..end]).map_err(|_| invalid_request())?;
            validate_head(head)?;
            return Ok(Some(Request {
                head: head.into(),
                body: bytes[end..].to_vec(),
            }));
        }
        if bytes.len() >= MAX_HEADER_BYTES {
            return Err(AppError::custom(CustomErrorCode::LanRequestHeadersTooLarge));
        }
    }
}

fn validate_head(head: &str) -> AppResult<()> {
    let mut lines = head.split("\r\n");
    let parts: Vec<_> = lines.next().unwrap_or_default().split(' ').collect();
    if parts.len() != 3
        || !parts[0].bytes().all(token_byte)
        || parts[0].is_empty()
        || !parts[1].starts_with('/')
        || parts[1].bytes().any(|byte| byte.is_ascii_control())
        || !matches!(parts[2], "HTTP/1.0" | "HTTP/1.1")
    {
        return Err(invalid_request());
    }
    for line in lines.take_while(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':').ok_or_else(invalid_request)?;
        if name.is_empty()
            || !name.bytes().all(token_byte)
            || value
                .bytes()
                .any(|byte| byte.is_ascii_control() && byte != b'\t')
        {
            return Err(invalid_request());
        }
    }
    Ok(())
}

fn token_byte(byte: u8) -> bool {
    // HTTP tchar applies to both field names and method tokens.
    byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte)
}

pub(super) fn unique_header<'a>(head: &'a str, name: &str) -> AppResult<Option<&'a str>> {
    let mut values = head
        .lines()
        .skip(1)
        .take_while(|line| !line.is_empty())
        .filter_map(|line| line.split_once(':'))
        .filter(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.trim());
    let value = values.next();
    if values.next().is_some() {
        return Err(invalid_request());
    }
    Ok(value)
}

pub(super) use crate::core::http_range::decimal;

fn invalid_request() -> AppError {
    AppError::custom(CustomErrorCode::LanRequestInvalid)
}

#[cfg(test)]
#[path = "http_request_tests.rs"]
mod tests;
