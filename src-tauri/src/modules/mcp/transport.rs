use axum::{
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::any,
    Router,
};
use parking_lot::Mutex;
use rmcp::transport::streamable_http_server::{
    session::never::NeverSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;

use super::{
    handler::Handler,
    repository::digest,
    server::Server,
    transport_body::{Log, SharedLog, Tee},
};
use crate::error::{AppError, CustomErrorCode};

const MAX_BODY: usize = 20_000_000_usize.div_ceil(3) * 4 + 512_000;

#[derive(Clone)]
struct Boundary {
    server: Arc<Server>,
    cancel: CancellationToken,
    requests: Arc<Semaphore>,
    port: u16,
}

pub(crate) fn router(server: Arc<Server>, cancel: CancellationToken, port: u16) -> Router {
    Router::new().fallback(any(handle)).with_state(Boundary {
        server,
        cancel,
        requests: Arc::new(Semaphore::new(4)),
        port,
    })
}

fn headers(headers: &HeaderMap) -> Vec<(String, Vec<u8>)> {
    headers
        .iter()
        .map(|(name, value)| (name.to_string(), value.as_bytes().to_vec()))
        .collect()
}

fn reply(status: StatusCode, body: &'static str) -> Response {
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    response.headers_mut().insert(
        "cache-control",
        axum::http::HeaderValue::from_static("no-store"),
    );
    if status == StatusCode::UNAUTHORIZED {
        response.headers_mut().insert(
            "www-authenticate",
            axum::http::HeaderValue::from_static("Bearer realm=\"mftp-mcp\""),
        );
    }
    response
}

async fn handle(State(boundary): State<Boundary>, request: Request) -> Response {
    let port = request.uri().port_u16();
    let target = request.uri().to_string();
    let log: SharedLog = boundary
        .server
        .diagnostics
        .begin("mcp", "http", &format!("127.0.0.1:{}", boundary.port))
        .map(|mut recorder| {
            for name in ["authorization", "mcp-session-id", "last-event-id"] {
                for value in request.headers().get_all(name) {
                    if let Ok(value) = value.to_str() {
                        recorder.add_secret(value);
                        if let Some(token) = value.strip_prefix("Bearer ") {
                            recorder.add_secret(token);
                        }
                    }
                }
            }
            recorder.request_start(
                request.method().as_str(),
                &target,
                headers(request.headers()),
            );
            Arc::new(Mutex::new(Log {
                recorder,
                error: None,
            }))
        });
    let permit = boundary.requests.clone().try_acquire_owned().ok();
    let response = if permit.is_none() {
        reply(
            StatusCode::SERVICE_UNAVAILABLE,
            "MCP request concurrency limit reached",
        )
    } else if request.uri().path() != "/mcp" || request.uri().query().is_some() {
        reply(
            StatusCode::NOT_FOUND,
            "MCP endpoint is /mcp without query parameters",
        )
    } else if request.headers().contains_key("origin") {
        reply(StatusCode::FORBIDDEN, "Browser origins are not allowed")
    } else if request.headers().get_all("host").iter().count() != 1
        || !request
            .headers()
            .get("host")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|host| {
                (host == format!("127.0.0.1:{}", boundary.port)
                    || host == format!("localhost:{}", boundary.port))
                    && port.is_none()
            })
    {
        reply(StatusCode::FORBIDDEN, "Invalid MCP Host authority")
    } else {
        let token = request
            .headers()
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .filter(|token| {
                token.len() == 48
                    && token.starts_with("mftp_")
                    && request.headers().get_all("authorization").iter().count() == 1
            });
        if let Some(token) = token {
            let token_digest = digest(token);
            let server = boundary.server.clone();
            let caller = boundary
                .server
                .executor
                .blocking_unlogged(move || server.authenticate(&token_digest))
                .await;
            match caller {
                Ok(caller) => {
                    let runtime = boundary.server.runtime();
                    if let Ok(runtime) = runtime {
                        let handler_log = log.clone();
                        let mut config = StreamableHttpServerConfig::default();
                        config.legacy_session_mode = false;
                        config.json_response = true;
                        config.max_request_body_bytes = MAX_BODY;
                        config.cancellation_token = boundary.cancel.clone();
                        let config = config.enforce_origin_validation();
                        let service = StreamableHttpService::new(
                            move || {
                                let caller = caller.clone();
                                Ok(Handler::new(runtime.clone(), move || {
                                    if caller.cancelled() {
                                        return Err(AppError::custom(
                                            CustomErrorCode::McpUnauthorized,
                                        ));
                                    }
                                    Ok(caller.clone())
                                })
                                .with_log(handler_log.clone()))
                            },
                            Arc::new(NeverSessionManager::default()),
                            config,
                        );
                        let (parts, body) = request.into_parts();
                        let request =
                            Request::from_parts(parts, Body::new(Tee::request(body, log.clone())));
                        match tokio::time::timeout(
                            Duration::from_secs(60),
                            service.oneshot(request),
                        )
                        .await
                        {
                            Ok(Ok(response)) => response.map(Body::new),
                            Ok(Err(never)) => match never {},
                            Err(error) => {
                                if let Some(mut log) = log.as_ref().and_then(|log| log.try_lock()) {
                                    log.recorder.transport_error(&error);
                                }
                                reply(
                                    StatusCode::GATEWAY_TIMEOUT,
                                    "MCP request timed out; verify write results before retrying",
                                )
                            }
                        }
                    } else {
                        reply(
                            StatusCode::SERVICE_UNAVAILABLE,
                            "MCP runtime is unavailable",
                        )
                    }
                }
                Err(error) => {
                    if let Some(mut log) = log.as_ref().and_then(|log| log.try_lock()) {
                        log.error = Some(error);
                    }
                    reply(StatusCode::UNAUTHORIZED, "MCP authorization is unavailable")
                }
            }
        } else {
            reply(
                StatusCode::UNAUTHORIZED,
                "A single explicit Bearer credential is required",
            )
        }
    };
    if let Some(mut log) = log.as_ref().and_then(|log| log.try_lock()) {
        log.recorder
            .http_response(response.status().as_u16(), headers(response.headers()));
        if response.status().is_client_error() || response.status().is_server_error() {
            log.error
                .get_or_insert_with(|| AppError::custom(CustomErrorCode::McpTransport));
        }
    }
    let (parts, body) = response.into_parts();
    Response::from_parts(parts, Body::new(Tee::response(body, log, permit)))
}
