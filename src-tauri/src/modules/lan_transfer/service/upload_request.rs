use super::file_ops::request_query_param;
use super::http_request::{decimal, unique_header};
use crate::error::{AppError, AppResult, CustomErrorCode};
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Conflict {
    Rename,
    Overwrite,
    Resume,
}

#[derive(Debug)]
pub(super) struct UploadRequest {
    pub relative: PathBuf,
    pub conflict: Conflict,
    pub start: u64,
    pub length: u64,
}

impl UploadRequest {
    pub fn parse(head: &str) -> AppResult<Self> {
        let first = head.lines().next().unwrap_or_default();
        let relative = relative_name(first)?;
        let conflict = match request_query_param(first, "conflict").as_deref() {
            None | Some("rename" | "") => Conflict::Rename,
            Some("overwrite") => Conflict::Overwrite,
            Some("resume") => Conflict::Resume,
            _ => return Err(invalid_upload()),
        };
        // This endpoint accepts fixed-length bodies without an interim handshake.
        // Reject Expect before opening a file so both peers cannot wait forever.
        if unique_header(head, "transfer-encoding")?.is_some()
            || unique_header(head, "expect")?.is_some()
        {
            return Err(invalid_upload());
        }
        let length = unique_header(head, "content-length")?
            .and_then(decimal)
            .ok_or_else(invalid_upload)?;
        let (start, total) = match unique_header(head, "content-range")? {
            None => (0, length),
            Some(value) => {
                let range = value.strip_prefix("bytes ").ok_or_else(invalid_upload)?;
                let (span, total) = range.split_once('/').ok_or_else(invalid_upload)?;
                let (start, end) = span.split_once('-').ok_or_else(invalid_upload)?;
                let start = decimal(start).ok_or_else(invalid_upload)?;
                let end = decimal(end).ok_or_else(invalid_upload)?;
                let total = decimal(total).ok_or_else(invalid_upload)?;
                if start > end || end >= total || end - start + 1 != length {
                    return Err(invalid_upload());
                }
                (start, total)
            }
        };
        if start > 0 && conflict != Conflict::Resume {
            return Err(invalid_upload());
        }
        if let Some(value) = unique_header(head, "x-mftp-total-size")? {
            if decimal(value) != Some(total) {
                return Err(invalid_upload());
            }
        }
        Ok(Self {
            relative,
            conflict,
            start,
            length,
        })
    }
}

pub(super) fn relative_name(first_line: &str) -> AppResult<PathBuf> {
    let name = request_query_param(first_line, "name").ok_or_else(invalid_name)?;
    let normalized = name.replace('\\', "/");
    let path = Path::new(&normalized);
    if normalized.trim().is_empty() || normalized.contains('\0') || path.is_absolute() {
        return Err(invalid_name());
    }
    let mut relative = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => relative.push(value),
            _ => return Err(invalid_name()),
        }
    }
    if relative.as_os_str().is_empty() {
        return Err(invalid_name());
    }
    Ok(relative)
}

fn invalid_name() -> AppError {
    AppError::custom(CustomErrorCode::LanUploadNameInvalid)
}
pub(super) fn invalid_upload() -> AppError {
    AppError::custom(CustomErrorCode::LanUploadInvalid)
}

#[cfg(test)]
#[path = "upload_request_tests.rs"]
mod tests;
