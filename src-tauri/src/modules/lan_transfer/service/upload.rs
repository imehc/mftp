use super::file_ops::request_query_param;
use super::http_request::decimal;
use super::tasks::SharedTasks;
use super::tasks::{finish_task, start_task};
use super::upload_file::{destination, existing_metadata};
use super::upload_request::{invalid_upload, relative_name, UploadRequest};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::lan_transfer::LanTransferTask;
use std::io::{Cursor, Read};
use std::net::TcpStream;
use std::path::Path;

pub(super) fn save_upload(
    head: &str,
    initial_body: &[u8],
    stream: &mut TcpStream,
    download_dir: &str,
    tasks: &SharedTasks,
    peer_ip: &str,
) -> AppResult<String> {
    // Clone before file creation/truncation; failure cannot leave a visible task
    // without the socket needed to wake its blocking IO.
    let connection = stream.try_clone()?;
    save_upload_inner(
        head,
        initial_body,
        stream,
        download_dir,
        tasks,
        peer_ip,
        Some(connection),
    )
}

fn save_upload_inner(
    head: &str,
    initial_body: &[u8],
    stream: &mut impl Read,
    download_dir: &str,
    tasks: &SharedTasks,
    peer_ip: &str,
    connection: Option<TcpStream>,
) -> AppResult<String> {
    let request = UploadRequest::parse(head)?;
    if initial_body.len() as u64 > request.length {
        return Err(invalid_upload());
    }
    // Declare the registration first so unwinding closes the file before it.
    let _connection;
    let mut target = super::upload_file::open(Path::new(download_dir), &request)?;
    let id = uuid::Uuid::new_v4().to_string();
    _connection = start_task(
        tasks,
        LanTransferTask {
            id: id.clone(),
            direction: "upload".into(),
            file_name: target.name.clone(),
            ip: peer_ip.into(),
            status: "running".into(),
            transferred: 0,
            total: request.length,
            started_at: super::now_ms(),
            updated_at: super::now_ms(),
            error: None,
        },
        connection,
    );
    // Each HTTP request owns one task; a non-final chunk can complete without
    // claiming the entire file has arrived. The next offset comes from the file.
    let mut input = Cursor::new(initial_body).chain(stream);
    let result =
        super::transfer_io::copy_body(&mut input, &mut target.file, request.length, tasks, &id)
            .and_then(|()| target.file.sync_all());
    // Keep partial files on failure for a later explicit resume; never unlink an
    // existing target. The file lock is held through the final flush.
    drop(target.file);
    finish_task(tasks, &id, result)?;
    Ok(target.name)
}

pub(super) fn upload_target_exists(first_line: &str, download_dir: &str) -> AppResult<bool> {
    let relative = relative_name(first_line)?;
    let Some(path) = destination(Path::new(download_dir), &relative, false)? else {
        return Ok(false);
    };
    Ok(existing_metadata(&path)?.is_some())
}

pub(super) fn upload_offset_json(first_line: &str, download_dir: &str) -> AppResult<String> {
    let relative = relative_name(first_line)?;
    let expected = request_query_param(first_line, "size")
        .map(|value| decimal(&value).ok_or_else(invalid_upload))
        .transpose()?;
    let metadata = destination(Path::new(download_dir), &relative, false)?
        .map(|path| existing_metadata(&path))
        .transpose()?
        .flatten();
    if metadata
        .as_ref()
        .is_some_and(|metadata| !metadata.is_file())
    {
        return Err(AppError::custom(CustomErrorCode::LanUploadTargetInvalid));
    }
    let offset = metadata.as_ref().map_or(0, |metadata| metadata.len());
    // The browser uses this legacy flag to offer overwrite/rename, also when an
    // existing file is too large to resume. Missing zero-byte files stay absent.
    let complete = metadata.is_some() && expected.map_or(offset > 0, |size| offset >= size);
    Ok(format!(r#"{{"offset":{offset},"complete":{complete}}}"#))
}

#[cfg(test)]
#[path = "upload_tests.rs"]
mod tests;
