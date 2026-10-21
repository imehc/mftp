use super::{catalog::ModelSpec, files, model::TranslationPhase, service::Worker};
use crate::core::diagnostics::{DiagnosticBodyEnd, DiagnosticRecorder, Diagnostics};
use crate::error::{AppError, AppResult, CustomErrorCode};
use reqwest::{
    blocking::{Client, Response},
    header::{HeaderMap, CONTENT_RANGE, ETAG, IF_RANGE, LOCATION, RANGE},
    StatusCode,
};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
    time::Duration,
};

const DOWNLOAD_USER_AGENT: &str = concat!("mftp/", env!("CARGO_PKG_VERSION"));

fn headers(values: &HeaderMap) -> Vec<(String, Vec<u8>)> {
    values
        .iter()
        .map(|(key, value)| (key.to_string(), value.as_bytes().to_vec()))
        .collect()
}

fn range_error() -> AppError {
    AppError::custom(CustomErrorCode::TranslationDownloadRange)
}

fn download_error(error: reqwest::Error) -> AppError {
    let reason = if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connect"
    } else if error.is_status() {
        "status"
    } else if error.is_decode() {
        "decode"
    } else if error.is_builder() {
        "request"
    } else {
        "transport"
    };
    let mut converted =
        AppError::custom(CustomErrorCode::TranslationDownload).with_arg("reason", reason);
    if let Some(status) = error.status() {
        converted = converted.with_arg("status", status.as_u16());
    }
    converted
}

fn download_read_error() -> AppError {
    AppError::custom(CustomErrorCode::TranslationDownload).with_arg("reason", "transport")
}

pub(super) fn response_start(
    status: StatusCode,
    range: Option<&str>,
    start: u64,
    total: u64,
) -> AppResult<u64> {
    if status == StatusCode::OK {
        return Ok(0);
    }
    if status != StatusCode::PARTIAL_CONTENT {
        return Err(range_error());
    }
    let (positions, declared) = range
        .and_then(|value| value.strip_prefix("bytes "))
        .and_then(|value| value.split_once('/'))
        .ok_or_else(range_error)?;
    let (first, last) = positions.split_once('-').ok_or_else(range_error)?;
    let decimal = |value| crate::core::http_range::decimal(value).ok_or_else(range_error);
    if decimal(first)? != start || decimal(declared)? != total || decimal(last)? != total - 1 {
        return Err(range_error());
    }
    Ok(start)
}

fn request(
    client: &Client,
    model: &ModelSpec,
    worker: &Worker,
    diagnostics: &Diagnostics,
    start: u64,
    etag: Option<&str>,
) -> AppResult<(Response, Option<DiagnosticRecorder>)> {
    let mut url = reqwest::Url::parse(model.url).map_err(|_| range_error())?;
    for _ in 0..6 {
        files::cancelled(&worker.cancel)?;
        let mut request = client
            .get(url.clone())
            .header("Accept-Encoding", "identity");
        if start > 0 {
            request = request.header(RANGE, format!("bytes={start}-"));
            if let Some(etag) = etag {
                request = request.header(IF_RANGE, etag);
            }
        }
        let request = request.build().map_err(download_error)?;
        let mut log = diagnostics.begin("translation", "model_download", model.id);
        if let Some(log) = &mut log {
            log.correlation(&worker.id);
            log.http_request(
                request.method().as_str(),
                request.url().as_str(),
                headers(request.headers()),
                &[],
            );
        }
        let response = match client.execute(request) {
            Ok(response) => response,
            Err(error) => {
                if let Some(log) = &mut log {
                    log.transport_error(&error);
                }
                let error = download_error(error);
                if let Some(log) = &mut log {
                    log.finish(Some(&error));
                }
                return Err(error);
            }
        };
        if let Some(log) = &mut log {
            log.http_response(response.status().as_u16(), headers(response.headers()));
        }
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(range_error)?;
            let next = url.join(location).map_err(|_| range_error())?;
            if next.scheme() != "https" || !next.username().is_empty() || next.password().is_some()
            {
                return Err(range_error());
            }
            if let Some(log) = &mut log {
                log.protocol_event(
                    &serde_json::json!({"bodyCaptured": false, "reason": "redirect body not read"}),
                );
                log.finish(None);
            }
            url = next;
            continue;
        }
        return Ok((response, log));
    }
    Err(range_error())
}

pub(super) fn install(
    root: &Path,
    model: &ModelSpec,
    worker: &Worker,
    diagnostics: &Diagnostics,
) -> AppResult<()> {
    files::prepare(root)?;
    let destination = files::model_path(root, model);
    if files::size(&destination)?.is_some() {
        return files::verify_once(&destination, model, &worker.cancel);
    }
    let partial = files::partial_path(root, model);
    let etag_path = partial.with_extension("etag");
    let start = files::size(&partial)?.unwrap_or(0);
    if start > model.bytes {
        return Err(AppError::custom(
            CustomErrorCode::TranslationResourceInvalid,
        ));
    }
    if fs2::available_space(root)? < model.bytes - start + 16 * 1024 * 1024 {
        return Err(AppError::custom(CustomErrorCode::TranslationSpace));
    }
    if start < model.bytes {
        let etag = match fs::read_to_string(&etag_path) {
            Ok(value) => Some(value),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        // Blocking Response::read applies this timeout per read, so stalled
        // transfers can stop without imposing a 30-second whole-file deadline.
        let client = Client::builder()
            // ModelScope's CDN rejects reqwest's default User-Agent via its UA ACL.
            .user_agent(DOWNLOAD_USER_AGENT)
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .no_gzip()
            .build()
            .map_err(download_error)?;
        worker.progress(TranslationPhase::Downloading, start);
        let (mut response, mut log) =
            request(&client, model, worker, diagnostics, start, etag.as_deref())?;
        let result = (|| {
            if let Err(error) = response.error_for_status_ref() {
                if let Some(log) = &mut log {
                    log.transport_error(&error);
                }
                let mut body = vec![0; 32 * 1024];
                if let Ok(bytes) = response.read(&mut body) {
                    if let Some(log) = &mut log {
                        log.response_bytes(&body[..bytes]);
                    }
                }
                return Err(download_error(error));
            }
            let actual = response_start(
                response.status(),
                response
                    .headers()
                    .get(CONTENT_RANGE)
                    .and_then(|value| value.to_str().ok()),
                start,
                model.bytes,
            )?;
            if response
                .content_length()
                .is_some_and(|length| length != model.bytes - actual)
            {
                return Err(range_error());
            }
            if actual > 0
                && etag.as_deref().is_some_and(|expected| {
                    response
                        .headers()
                        .get(ETAG)
                        .and_then(|value| value.to_str().ok())
                        != Some(expected)
                })
            {
                return Err(range_error());
            }
            if let Some(value) = response
                .headers()
                .get(ETAG)
                .and_then(|value| value.to_str().ok())
            {
                fs::write(&etag_path, value)?;
            } else if etag.is_some() {
                fs::remove_file(&etag_path)?;
            }
            if let Some(log) = &mut log {
                log.protocol_event(&serde_json::json!({"bodyCaptured":false,"reason":"model binary","resumeOffset":actual}));
            }
            let mut file = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(actual == 0)
                .append(actual > 0)
                .open(&partial)?;
            let mut done = actual;
            let mut buffer = vec![0; 128 * 1024];
            loop {
                files::cancelled(&worker.cancel)?;
                let count = response.read(&mut buffer).map_err(|error| {
                    if let Some(log) = &mut log {
                        log.transport_error(&error);
                    }
                    download_read_error()
                })?;
                if count == 0 {
                    break;
                }
                if done + count as u64 > model.bytes {
                    return Err(range_error());
                }
                file.write_all(&buffer[..count])?;
                done += count as u64;
                worker.progress(TranslationPhase::Downloading, done);
                if let Some(log) = &mut log {
                    log.response_omitted_bytes(count);
                    log.progress("download", done, Some(model.bytes));
                }
            }
            file.sync_all()?;
            if done != model.bytes {
                return Err(range_error());
            }
            if let Some(log) = &mut log {
                log.response_end(DiagnosticBodyEnd::Complete);
            }
            Ok(())
        })();
        if let Some(log) = &mut log {
            log.finish(result.as_ref().err());
        }
        result?;
    }
    worker.progress(TranslationPhase::Verifying, model.bytes);
    files::verify(&partial, model, &worker.cancel)?;
    files::cancelled(&worker.cancel)?;
    let published = files::publish(&partial, &destination)?;
    if etag_path.exists() {
        fs::remove_file(etag_path)?;
    }
    if published {
        files::mark_verified(&destination)
    } else {
        // A concurrent run published the same content first; check it rather
        // than trusting a file this worker never wrote.
        files::verify_once(&destination, model, &worker.cancel)
    }
}
