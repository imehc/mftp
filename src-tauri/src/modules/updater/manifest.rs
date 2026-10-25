use super::model::{AndroidUpdateInfo, AndroidUpdateManifest};
use crate::core::diagnostics::{DiagnosticBodyEnd, DiagnosticRecorder, Diagnostics};
use crate::error::{AppError, AppResult};
use reqwest::blocking::{Client, Response};
use reqwest::header::{HeaderMap, LOCATION};
use std::error::Error;
use std::io::Read;
use std::time::{Duration, Instant};

pub(super) const URL: &str = "https://github.com/imehc/mftp/releases/latest/download/android.json";
const MAX_BYTES: usize = 256 * 1024;
const DEADLINE: Duration = Duration::from_secs(45);
const USER_AGENT: &str = "mftp-android-updater";

fn failure(stage: &str, message: impl Into<String>) -> AppError {
    AppError::external("updater:check_failed", message).with_arg("stage", stage)
}

fn transport_failure(
    stage: &str,
    error: &(dyn Error + 'static),
    log: &mut Option<DiagnosticRecorder>,
) -> AppError {
    let mut message = error.to_string();
    let mut source = error.source();
    for _ in 0..16 {
        let Some(cause) = source else { break };
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }
    if let Some(log) = log {
        log.transport_error(&message);
    }
    failure(stage, message)
}

fn headers(values: &HeaderMap) -> Vec<(String, Vec<u8>)> {
    values
        .iter()
        .map(|(name, value)| (name.to_string(), value.as_bytes().to_vec()))
        .collect()
}

pub(super) fn fetch(
    diagnostics: &Diagnostics,
    correlation: Option<&str>,
) -> AppResult<AndroidUpdateManifest> {
    let mut log = diagnostics.begin("updater", "android_manifest", URL);
    if let (Some(log), Some(id)) = (&mut log, correlation) {
        log.correlation(id);
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(DEADLINE)
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .build()
        .map_err(|error| {
            let error = transport_failure("client", &error, &mut log);
            if let Some(log) = &mut log {
                log.finish(Some(&error));
            }
            error
        })?;
    fetch_with(&client, URL, diagnostics, correlation, log)
}

fn fetch_with(
    client: &Client,
    address: &str,
    diagnostics: &Diagnostics,
    correlation: Option<&str>,
    mut log: Option<DiagnosticRecorder>,
) -> AppResult<AndroidUpdateManifest> {
    let start = Instant::now();
    let mut url = reqwest::Url::parse(address)
        .map_err(|error| failure("url", format!("Invalid update URL: {error}")))?;
    for hop in 0..6 {
        if hop > 0 {
            log = diagnostics.begin("updater", "android_manifest", url.as_str());
        }
        if let (Some(log), Some(id)) = (&mut log, correlation) {
            log.correlation(id);
        }
        let result = (|| {
            let remaining = DEADLINE
                .checked_sub(start.elapsed())
                .filter(|duration| !duration.is_zero())
                .ok_or_else(|| failure("request", "Android update check timed out"))?;
            let request = client
                .get(url.clone())
                .header("User-Agent", USER_AGENT)
                .header("Accept-Encoding", "identity")
                .timeout(remaining)
                .build()
                .map_err(|error| transport_failure("request", &error, &mut log))?;
            if let Some(log) = &mut log {
                log.http_request(
                    request.method().as_str(),
                    request.url().as_str(),
                    headers(request.headers()),
                    &[],
                );
            }
            let mut response = client
                .execute(request)
                .map_err(|error| transport_failure("request", &error, &mut log))?;
            if let Some(log) = &mut log {
                log.http_response(response.status().as_u16(), headers(response.headers()));
            }
            if response.status().is_redirection() {
                if let Some(log) = &mut log {
                    log.protocol_event(&serde_json::json!({
                        "bodyCaptured": false, "reason": "redirect body not read",
                    }));
                }
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or_else(|| failure("redirect", "Update redirect has no valid Location"))?;
                let next = url.join(location).map_err(|error| {
                    failure("redirect", format!("Invalid update redirect: {error}"))
                })?;
                if next.scheme() != "https"
                    || !next.username().is_empty()
                    || next.password().is_some()
                    || hop == 5
                {
                    return Err(failure(
                        "redirect",
                        "Android update redirect is not allowed",
                    ));
                }
                return Ok(Err(next));
            }
            let status = response.status();
            let bytes = read_body(&mut response, &mut log)?;
            if !status.is_success() {
                return Err(
                    failure("status", format!("Update manifest returned HTTP {status}"))
                        .with_arg("status", status.as_u16()),
                );
            }
            let manifest = serde_json::from_slice(&bytes)
                .map_err(|error| failure("decode", error.to_string()))?;
            validate(&manifest)?;
            Ok(Ok(manifest))
        })();
        if let Some(log) = &mut log {
            log.finish(result.as_ref().err());
        }
        match result? {
            Ok(manifest) => return Ok(manifest),
            Err(next) => url = next,
        }
    }
    Err(failure(
        "redirect",
        "Android update redirect limit exceeded",
    ))
}

fn read_body(response: &mut Response, log: &mut Option<DiagnosticRecorder>) -> AppResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|size| size > MAX_BYTES as u64)
    {
        if let Some(log) = log {
            log.protocol_event(&serde_json::json!({
                "bodyCaptured": false, "reason": "manifest exceeds size limit",
            }));
            log.response_end(DiagnosticBodyEnd::Interrupted);
        }
        return Err(failure("body", "Android update manifest is too large"));
    }
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        let remaining = (MAX_BYTES + 1 - bytes.len()).min(buffer.len());
        let count = response.read(&mut buffer[..remaining]).map_err(|error| {
            if let Some(log) = log {
                log.response_end(DiagnosticBodyEnd::Interrupted);
            }
            transport_failure("body", &error, log)
        })?;
        if let Some(log) = log {
            log.response_bytes(&buffer[..count]);
        }
        bytes.extend_from_slice(&buffer[..count]);
        if bytes.len() > MAX_BYTES {
            if let Some(log) = log {
                log.response_end(DiagnosticBodyEnd::Interrupted);
            }
            return Err(failure("body", "Android update manifest is too large"));
        }
        if count == 0 {
            if let Some(log) = log {
                log.response_end(DiagnosticBodyEnd::Complete);
            }
            return Ok(bytes);
        }
    }
}

fn validate(manifest: &AndroidUpdateManifest) -> AppResult<()> {
    if manifest.package_name != "com.imehc.mftp"
        || manifest.version_code == 0
        || manifest.size == 0
        || manifest.size > 512 * 1024 * 1024
        || manifest.sha256.len() != 64
        || !manifest
            .sha256
            .chars()
            .all(|value| value.is_ascii_hexdigit())
        || !manifest.url.starts_with("https://")
    {
        return Err(failure("manifest", "Android update manifest is invalid"));
    }
    Ok(())
}

pub(super) fn update_info(
    manifest: AndroidUpdateManifest,
    current_version: String,
    current_version_code: u64,
) -> AndroidUpdateInfo {
    AndroidUpdateInfo {
        available: manifest.version_code > current_version_code,
        current_version,
        current_version_code,
        version: manifest.version,
        version_code: manifest.version_code,
        url: manifest.url,
        size: manifest.size,
        sha256: manifest.sha256,
        notes: manifest.notes,
    }
}

#[cfg(test)]
#[path = "manifest_tests.rs"]
mod tests;
