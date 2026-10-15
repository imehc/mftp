use super::{
    deadlines::WaitContext,
    protocol::{self, Adapter, EventStatus},
    sse::SseComments,
    url::protocol_endpoint,
};
use crate::core::diagnostics::{DiagnosticBodyEnd, DiagnosticRecorder};
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::modules::ai::completion::{
    AiCompletionRequest, AiCompletionResult, AiControlMessage, AiEmitter, AiFinishReason,
    AiObservation, AiObservedPhase, AiOutput, AiProviderErrorCode, AiStreamEvent,
    AiStreamEventPayload, AiTimeoutStage,
};
use crate::modules::ai::AiConnectionConfig;
use eventsource_stream::{EventStreamError, Eventsource};
use futures_util::StreamExt;
use std::{sync::Arc, time::Duration};
use tokio::sync::mpsc::Receiver;

pub(super) const RESPONSE_LIMIT_BYTES: usize = 1024 * 1024;

pub(crate) async fn complete(
    config: &AiConnectionConfig,
    api_key: &str,
    request: &AiCompletionRequest<'_>,
    control: Option<&mut Receiver<AiControlMessage>>,
    on_event: impl FnMut(AiStreamEvent) + Send,
) -> AppResult<AiCompletionResult> {
    complete_logged(config, api_key, request, control, on_event, None).await
}

pub(super) async fn complete_logged(
    config: &AiConnectionConfig,
    api_key: &str,
    request: &AiCompletionRequest<'_>,
    control: Option<&mut Receiver<AiControlMessage>>,
    on_event: impl FnMut(AiStreamEvent) + Send,
    mut log: Option<&mut DiagnosticRecorder>,
) -> AppResult<AiCompletionResult> {
    if let Some(log) = log.as_deref_mut() {
        log.add_secret(api_key);
    }
    let observation = Arc::new(AiObservation::new(config.protocol));
    observation.deadline(request.timeout.hard_deadline_ms);
    let emitter = if let Some(log) = log.as_ref() {
        AiEmitter::with_id(log.id().into(), observation.clone(), on_event)
    } else {
        AiEmitter::new(observation.clone(), on_event)
    };
    emitter.emit(AiStreamEventPayload::Started);
    let mut context = WaitContext {
        observation: observation.clone(),
        emitter: emitter.clone(),
        policy: request.timeout,
        streaming: request.streaming,
        control,
        soft_reported: false,
    };
    let result = execute(config, api_key, request, &mut context, &mut log).await;
    match result {
        Ok(result) => {
            emitter.emit(AiStreamEventPayload::Usage {
                usage: result.usage.clone(),
            });
            emitter.emit(AiStreamEventPayload::Completed {
                finish_reason: AiFinishReason::Stop,
                diagnostics: result.diagnostics.clone(),
            });
            Ok(result)
        }
        Err(error) => {
            let error = observation.annotate(error);
            let diagnostics = observation.snapshot();
            let payload = match error.code.as_str() {
                "ai:cancelled" => AiStreamEventPayload::Cancelled { diagnostics },
                "ai:provider_incomplete" | "ai:provider_limit_reached" => {
                    AiStreamEventPayload::Incomplete {
                        reason: diagnostics
                            .finish_reason
                            .unwrap_or(AiFinishReason::Incomplete),
                        error: error.clone(),
                        diagnostics,
                    }
                }
                _ => AiStreamEventPayload::Failed {
                    error: error.clone(),
                    diagnostics,
                },
            };
            emitter.emit(payload);
            Err(error)
        }
    }
}

async fn execute(
    config: &AiConnectionConfig,
    api_key: &str,
    request: &AiCompletionRequest<'_>,
    context: &mut WaitContext<'_>,
    log: &mut Option<&mut DiagnosticRecorder>,
) -> AppResult<AiCompletionResult> {
    request.validate(config.protocol)?;
    let body = serde_json::to_vec(&protocol::request_body(config, request))?;
    if body.len() > 128 * 1024 {
        return Err(AppError::custom(CustomErrorCode::AiRequestTooLarge));
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(request.timeout.connection_ms.into()))
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .pool_max_idle_per_host(0)
        .user_agent("mftp-ai/1")
        .build()?;
    let outbound = client
        .post(protocol_endpoint(&config.base_url, config.protocol))
        .headers(protocol::headers(config.protocol, api_key)?)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .build()?;
    if let Some(log) = log.as_deref_mut() {
        log.http_request(
            outbound.method().as_str(),
            outbound.url().as_str(),
            headers(outbound.headers()),
            outbound
                .body()
                .and_then(reqwest::Body::as_bytes)
                .unwrap_or_default(),
        );
    }
    let response = context
        .wait(async {
            client.execute(outbound).await.map_err(|error| {
                if let Some(log) = log.as_deref_mut() {
                    log.transport_error(&error);
                }
                transport_error(error)
            })
        })
        .await?;
    if let Some(log) = log.as_deref_mut() {
        log.http_response(response.status().as_u16(), headers(response.headers()));
    }
    context.observation.response_started();
    context.emitter.emit(AiStreamEventPayload::PhaseChanged {
        phase: AiObservedPhase::Waiting,
        block: None,
    });
    if !response.status().is_success() {
        let error = provider_error(response.status().as_u16());
        capture_rejected(response, log, context).await;
        return Err(error);
    }
    if response
        .content_length()
        .is_some_and(|size| size > RESPONSE_LIMIT_BYTES as u64)
    {
        capture_rejected(response, log, context).await;
        return Err(AppError::custom(CustomErrorCode::AiResponseTooLarge));
    }
    if request.streaming
        && response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .is_none_or(|value| !value.trim().eq_ignore_ascii_case("text/event-stream"))
    {
        capture_rejected(response, log, context).await;
        return Err(AiProviderErrorCode::Protocol.error());
    }
    let observation = context.observation.clone();
    let emitter = context.emitter.clone();
    let mut comments = request.streaming.then(SseComments::new);
    let mut received = 0_usize;
    let stream_log = &mut *log;
    let mut bytes = response.bytes_stream().map(move |chunk| {
        let chunk = chunk.map_err(|error| {
            if let Some(log) = stream_log.as_deref_mut() {
                log.transport_error(&error);
            }
            transport_error(error)
        })?;
        if let Some(log) = stream_log.as_deref_mut() {
            log.response_bytes(&chunk);
        }
        observation.received(chunk.len());
        received = received.saturating_add(chunk.len());
        if received > RESPONSE_LIMIT_BYTES {
            return Err(AppError::custom(CustomErrorCode::AiResponseTooLarge));
        }
        if comments
            .as_mut()
            .is_some_and(|comments| comments.observe(&chunk))
        {
            observation.transport_activity();
            emitter.emit(AiStreamEventPayload::Heartbeat);
        }
        Ok(chunk)
    });
    let mut adapter = Adapter::new(config.protocol, request.reasoning);
    let mut output = AiOutput::new(
        request,
        context.observation.clone(),
        context.emitter.clone(),
    );
    if request.streaming {
        let mut events = bytes.eventsource();
        let mut completed = false;
        while let Some(event) = context.wait(async { Ok(events.next().await) }).await? {
            let event = event.map_err(|error| match error {
                EventStreamError::Transport(error) => error,
                EventStreamError::Utf8(_) | EventStreamError::Parser(_) => {
                    AiProviderErrorCode::Protocol.error()
                }
            })?;
            if matches!(
                adapter.event(&event.event, &event.data, &mut output)?,
                EventStatus::Completed
            ) {
                completed = true;
                break;
            }
        }
        if !completed {
            return Err(AiProviderErrorCode::Incomplete.error());
        }
        drop(events);
        if let Some(log) = log.as_deref_mut() {
            log.response_end(DiagnosticBodyEnd::ProtocolEnd);
        }
    } else {
        let mut body = Vec::new();
        while let Some(chunk) = context.wait(async { Ok(bytes.next().await) }).await? {
            body.extend_from_slice(&chunk?);
        }
        drop(bytes);
        if let Some(log) = log.as_deref_mut() {
            log.response_end(DiagnosticBodyEnd::Complete);
        }
        adapter.plain(&body, &mut output)?;
    }
    context.wait(async { output.result() }).await
}

fn headers(values: &reqwest::header::HeaderMap) -> Vec<(String, Vec<u8>)> {
    values
        .iter()
        .map(|(name, value)| (name.as_str().into(), value.as_bytes().to_vec()))
        .collect()
}

async fn capture_rejected(
    response: reqwest::Response,
    log: &mut Option<&mut DiagnosticRecorder>,
    context: &WaitContext<'_>,
) {
    let Some(log) = log.as_deref_mut() else {
        return;
    };
    // Error bodies are diagnostic only. A slow/failed body cannot replace the
    // original HTTP status, extend the normal task deadline, or trigger a retry.
    let mut bytes = response.bytes_stream();
    let mut received = 0;
    let remaining = context
        .observation
        .snapshot()
        .hard_deadline_ms
        .saturating_sub(context.observation.elapsed_ms())
        .min(500);
    let _ = tokio::time::timeout(Duration::from_millis(remaining.into()), async {
        while let Some(chunk) = bytes.next().await {
            match chunk {
                Ok(chunk) => {
                    received += chunk.len();
                    log.response_bytes(&chunk);
                    if received > 32 * 1024 {
                        return;
                    }
                }
                Err(error) => {
                    log.transport_error(&error);
                    return;
                }
            }
        }
        log.response_end(DiagnosticBodyEnd::Complete);
    })
    .await;
}

fn transport_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AiProviderErrorCode::timeout(AiTimeoutStage::Connection)
    } else {
        AppError::from(error)
    }
}

pub(super) fn provider_error(status: u16) -> AppError {
    AiProviderErrorCode::Status
        .error()
        .with_arg("status", status)
}
