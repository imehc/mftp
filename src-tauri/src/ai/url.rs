use std::net::IpAddr;

use url::{Host, Url};

use crate::error::{AppError, AppResult};

use super::AiConnectionConfig;

const MAX_BASE_URL_BYTES: usize = 2_048;
const MAX_MODEL_BYTES: usize = 256;

pub fn validate_connection(base_url: &str, model: &str) -> AppResult<AiConnectionConfig> {
    let base_url = base_url.trim().trim_end_matches('/');
    let model = model.trim();
    if base_url.is_empty() || base_url.len() > MAX_BASE_URL_BYTES {
        return Err(AppError(
            "AI service address is required or too long".into(),
        ));
    }
    if model.is_empty() || model.len() > MAX_MODEL_BYTES {
        return Err(AppError("AI model is required or too long".into()));
    }

    let parsed = Url::parse(base_url).map_err(|_| AppError("Invalid AI service address".into()))?;
    if parsed.username() != "" || parsed.password().is_some() {
        return Err(AppError(
            "AI service address must not contain credentials".into(),
        ));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(AppError(
            "AI service address must not contain a query or fragment".into(),
        ));
    }
    let host = parsed
        .host()
        .ok_or_else(|| AppError("AI service address is missing a host".into()))?;
    match parsed.scheme() {
        "https" => {}
        "http" if is_loopback(host) => {}
        "http" => {
            return Err(AppError(
                "Remote AI services must use HTTPS; HTTP is limited to loopback addresses".into(),
            ));
        }
        _ => return Err(AppError("AI service address must use HTTPS".into())),
    }

    Ok(AiConnectionConfig {
        base_url: base_url.to_string(),
        model: model.to_string(),
        streaming_enabled: true,
    })
}

pub(super) fn responses_endpoint(base_url: &str) -> String {
    if base_url.ends_with("/v1/responses") {
        base_url.to_string()
    } else if base_url.ends_with("/v1") {
        format!("{base_url}/responses")
    } else {
        format!("{base_url}/v1/responses")
    }
}

fn is_loopback(host: Host<&str>) -> bool {
    match host {
        Host::Domain(domain) => domain.eq_ignore_ascii_case("localhost"),
        Host::Ipv4(address) => IpAddr::V4(address).is_loopback(),
        Host::Ipv6(address) => IpAddr::V6(address).is_loopback(),
    }
}

#[cfg(test)]
#[path = "url_tests.rs"]
mod tests;
