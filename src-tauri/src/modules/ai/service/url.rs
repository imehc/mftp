use std::net::IpAddr;

use url::{Host, Url};

use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ai::AiConnectionConfig;

const MAX_BASE_URL_BYTES: usize = 2_048;
const MAX_MODEL_BYTES: usize = 256;

pub fn validate_connection(base_url: &str, model: &str) -> AppResult<AiConnectionConfig> {
    let base_url = base_url.trim().trim_end_matches('/');
    let model = model.trim();
    if base_url.is_empty() || base_url.len() > MAX_BASE_URL_BYTES {
        return Err(AppError::custom(CustomErrorCode::AiAddressInvalid));
    }
    if model.is_empty() || model.len() > MAX_MODEL_BYTES {
        return Err(AppError::custom(CustomErrorCode::AiModelInvalid));
    }

    let parsed =
        Url::parse(base_url).map_err(|_| AppError::custom(CustomErrorCode::AiAddressInvalid))?;
    if parsed.username() != "" || parsed.password().is_some() {
        return Err(AppError::custom(CustomErrorCode::AiAddressInvalid)
            .context("AI service address must not contain credentials"));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(AppError::custom(CustomErrorCode::AiAddressInvalid)
            .context("AI service address must not contain a query or fragment"));
    }
    let host = parsed
        .host()
        .ok_or_else(|| AppError::custom(CustomErrorCode::AiAddressInvalid))?;
    match parsed.scheme() {
        "https" => {}
        "http" if is_loopback(host) => {}
        "http" => {
            return Err(AppError::custom(CustomErrorCode::AiAddressInvalid).context(
                "Remote AI services must use HTTPS; HTTP is limited to loopback addresses",
            ));
        }
        _ => {
            return Err(AppError::custom(CustomErrorCode::AiAddressInvalid)
                .context("AI service address must use HTTPS"))
        }
    }

    Ok(AiConnectionConfig {
        protocol: Default::default(),
        base_url: base_url.to_string(),
        model: model.to_string(),
        streaming_enabled: true,
    })
}

#[cfg(test)]
pub(in crate::modules::ai) fn responses_endpoint(base_url: &str) -> String {
    protocol_endpoint(base_url, crate::modules::ai::AiProtocol::Responses)
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

pub(in crate::modules::ai) fn protocol_endpoint(
    base_url: &str,
    protocol: crate::modules::ai::AiProtocol,
) -> String {
    use crate::modules::ai::AiProtocol;
    let base = base_url.trim_end_matches('/');
    let suffix = match protocol {
        AiProtocol::Responses => "responses",
        AiProtocol::ChatCompletions => "chat/completions",
        AiProtocol::AnthropicMessages => "messages",
    };
    // A full endpoint may be retained in the editor while its protocol changes.
    for old in ["/chat/completions", "/responses", "/messages"] {
        if let Some(prefix) = base.strip_suffix(old) {
            return format!("{prefix}/{suffix}");
        }
    }
    if base.ends_with("/v1") {
        format!("{base}/{suffix}")
    } else {
        format!("{base}/v1/{suffix}")
    }
}
