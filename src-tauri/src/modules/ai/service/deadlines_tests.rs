use super::*;
use crate::modules::ai::{
    completion::{
        AiCompletionRequest, AiContentBlock, AiOutput, AiReasoningKind, AiStreamEvent,
        AiTextRequest,
    },
    AiProtocol,
};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

fn policy() -> AiTimeoutPolicy {
    AiTimeoutPolicy {
        connection_ms: 5,
        response_headers_ms: 60,
        first_event_ms: 10,
        transport_idle_ms: 20,
        reasoning_progress_ms: 30,
        text_progress_ms: 15,
        unobserved_progress_ms: 40,
        soft_wait_ms: 10,
        hard_deadline_ms: 100,
        max_deadline_ms: 200,
    }
}

fn context<'a>(
    policy: AiTimeoutPolicy,
    streaming: bool,
    control: Option<&'a mut Receiver<AiControlMessage>>,
) -> (WaitContext<'a>, Arc<Mutex<Vec<AiStreamEvent>>>) {
    let observation = Arc::new(AiObservation::new(AiProtocol::Responses));
    observation.deadline(policy.hard_deadline_ms);
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let emitter = AiEmitter::new(observation.clone(), move |event| {
        captured.lock().push(event)
    });
    (
        WaitContext {
            observation,
            emitter,
            policy,
            streaming,
            control,
            soft_reported: false,
        },
        events,
    )
}

#[tokio::test(start_paused = true)]
async fn reasoning_can_progress_without_text_until_the_absolute_deadline() {
    let (mut context, _) = context(policy(), true, None);
    let observation = context.observation.clone();
    observation.response_started();
    observation.phase(AiObservedPhase::Reasoning);
    observation.accepted_event();
    let result: AppResult<()> = context
        .wait(async {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                observation.accepted_event();
                observation.reasoning(3);
            }
        })
        .await;
    assert_eq!(result.unwrap_err().args["timeoutStage"], "hardDeadline");
    assert_eq!(observation.snapshot().received_text_bytes, 0);
    assert!(observation.snapshot().received_reasoning_bytes >= 24);
}

#[tokio::test(start_paused = true)]
async fn heartbeats_do_not_reset_semantic_progress_timeout() {
    let (mut context, _) = context(policy(), true, None);
    let observation = context.observation.clone();
    observation.response_started();
    observation.accepted_event();
    let result: AppResult<()> = context
        .wait(async {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                observation.accepted_event();
            }
        })
        .await;
    assert_eq!(
        result.unwrap_err().args["timeoutStage"],
        "unobservedProgress"
    );
    assert!(!observation.snapshot().had_reasoning_activity);
}

#[tokio::test(start_paused = true)]
async fn repeated_thinking_starts_cannot_exempt_a_stalled_reasoning_phase() {
    let mut p = policy();
    p.transport_idle_ms = 90;
    let (mut context, _) = context(p, true, None);
    let observation = context.observation.clone();
    observation.response_started();
    observation.phase(AiObservedPhase::Reasoning);
    observation.accepted_event();
    let result: AppResult<()> = context
        .wait(async {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                observation.accepted_event();
                observation.phase(AiObservedPhase::Reasoning);
                observation.reasoning(0);
            }
        })
        .await;
    assert_eq!(
        result.unwrap_err().args["timeoutStage"],
        "reasoningProgress"
    );
    assert!(!observation.snapshot().had_reasoning_activity);
}

#[tokio::test(start_paused = true)]
async fn comment_heartbeats_neither_replace_the_first_event_nor_claim_semantic_progress() {
    for started in [false, true] {
        let (mut context, _) = context(policy(), true, None);
        let observation = context.observation.clone();
        observation.response_started();
        if started {
            observation.accepted_event();
        }
        let result: AppResult<()> = context
            .wait(async {
                let mut comments = super::super::sse::SseComments::new();
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                    if comments.observe(b": keepalive\n\n") {
                        observation.transport_activity();
                    }
                }
            })
            .await;
        assert_eq!(
            result.unwrap_err().args["timeoutStage"],
            if started {
                "unobservedProgress"
            } else {
                "firstEvent"
            }
        );
        let snapshot = observation.snapshot();
        assert_eq!(snapshot.first_event_ms.is_some(), started);
        assert!(snapshot.last_transport_activity_ms.is_some());
        assert!(!snapshot.had_reasoning_activity);
    }
}

#[tokio::test(start_paused = true)]
async fn returning_to_reasoning_uses_the_new_phase_start_instead_of_stale_progress() {
    let mut p = policy();
    p.transport_idle_ms = 90;
    p.text_progress_ms = 60;
    let (mut context, _) = context(p, true, None);
    context.observation.response_started();
    context.observation.accepted_event();
    context.observation.reasoning(1);
    context.observation.text(1);
    tokio::time::advance(std::time::Duration::from_millis(50)).await;
    context.observation.text(1);
    context.observation.accepted_event();
    context.observation.phase(AiObservedPhase::Reasoning);
    context.check().unwrap();
    let error = context
        .wait::<()>(std::future::pending())
        .await
        .unwrap_err();
    assert_eq!(error.args["timeoutStage"], "reasoningProgress");
    assert_eq!(context.observation.elapsed_ms(), 80);
}

#[tokio::test(start_paused = true)]
async fn hidden_nonstreaming_reasoning_uses_the_silent_window_without_claiming_progress() {
    let mut p = policy();
    p.unobserved_progress_ms = 70;
    let (mut context, _) = context(p, false, None);
    context.observation.response_started();
    context
        .wait(async {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            Ok(())
        })
        .await
        .unwrap();
    assert_eq!(
        context.observation.snapshot().phase,
        AiObservedPhase::Waiting
    );
    assert!(!context.observation.snapshot().had_reasoning_activity);
}

#[tokio::test(start_paused = true)]
async fn waiting_for_headers_is_separate_from_the_short_connection_window() {
    let (mut context, _) = context(policy(), false, None);
    context
        .wait(async {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            Ok(())
        })
        .await
        .unwrap();
    assert!(context.observation.elapsed_ms() > context.policy.connection_ms);
}

#[tokio::test(start_paused = true)]
async fn first_event_idle_text_and_header_timeouts_are_distinct() {
    for (case, stage) in [
        (0, "connection"),
        (1, "firstEvent"),
        (2, "transportIdle"),
        (3, "textProgress"),
    ] {
        let (mut context, _) = context(policy(), true, None);
        if case > 0 {
            context.observation.response_started();
        }
        if case > 1 {
            context.observation.accepted_event();
        }
        if case > 2 {
            context.observation.text(1);
        }
        let error = context
            .wait::<()>(std::future::pending())
            .await
            .unwrap_err();
        assert_eq!(error.args["timeoutStage"], stage);
    }
}

#[tokio::test(start_paused = true)]
async fn raw_bytes_and_unknown_frames_cannot_keep_the_first_event_timer_alive() {
    let (mut context, _) = context(policy(), true, None);
    let observation = context.observation.clone();
    observation.response_started();
    let result: AppResult<()> = context
        .wait(async {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(2)).await;
                observation.received(5);
            }
        })
        .await;
    assert_eq!(result.unwrap_err().args["timeoutStage"], "firstEvent");
    assert!(observation.snapshot().last_transport_activity_ms.is_none());
}

#[tokio::test(start_paused = true)]
async fn truncating_visible_reasoning_does_not_stop_activity_tracking_or_the_hard_deadline() {
    let (mut context, events) = context(policy(), true, None);
    let text = AiTextRequest {
        instructions: String::new(),
        input: String::new(),
        max_output_tokens: 32,
        output_limit_bytes: 128,
    };
    let mut request = AiCompletionRequest::text(&text, true);
    request.show_reasoning = true;
    request.reasoning_limit_bytes = 3;
    let mut output = AiOutput::new(
        &request,
        context.observation.clone(),
        context.emitter.clone(),
    );
    context.observation.response_started();
    context.observation.accepted_event();
    context.observation.phase(AiObservedPhase::Reasoning);
    let result: AppResult<()> = context
        .wait(async {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                output.observation.accepted_event();
                output.reasoning(
                    AiContentBlock {
                        output_index: 0,
                        content_index: 0,
                    },
                    AiReasoningKind::Summary,
                    "思",
                    false,
                );
            }
        })
        .await;
    assert_eq!(result.unwrap_err().args["timeoutStage"], "hardDeadline");
    let events = events.lock();
    let visible = events
        .iter()
        .filter_map(|event| match &event.payload {
            AiStreamEventPayload::ReasoningDelta { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect::<String>();
    assert_eq!(visible, "思");
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.payload, AiStreamEventPayload::ReasoningTruncated))
            .count(),
        1
    );
    assert!(context.observation.snapshot().received_reasoning_bytes > visible.len() as u32);
}

#[tokio::test(start_paused = true)]
async fn extending_wait_keeps_the_same_future_and_reports_the_accepted_deadline() {
    let mut p = policy();
    p.hard_deadline_ms = 40;
    p.response_headers_ms = 100;
    let (sender, mut receiver) = tokio::sync::mpsc::channel(2);
    let (mut context, events) = context(p, false, Some(&mut receiver));
    let starts = Arc::new(AtomicUsize::new(0));
    let counted = starts.clone();
    let work = async {
        counted.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(std::time::Duration::from_millis(60)).await;
        Ok(())
    };
    let extend = async {
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        sender
            .send(AiControlMessage::Extend { additional_ms: 40 })
            .await
            .unwrap();
    };
    let (result, _) = tokio::join!(context.wait(work), extend);
    result.unwrap();
    assert_eq!(starts.load(Ordering::SeqCst), 1);
    assert!(events.lock().iter().any(|event| matches!(
        event.payload,
        AiStreamEventPayload::DeadlineExtended {
            hard_deadline_ms: 80
        }
    )));
    assert_eq!(
        events
            .lock()
            .iter()
            .filter(|event| matches!(event.payload, AiStreamEventPayload::SoftWait { .. }))
            .count(),
        1
    );
}

#[tokio::test(start_paused = true)]
async fn cancellation_and_closed_owner_channels_stop_waiting() {
    for explicit in [false, true] {
        let (sender, mut receiver) = tokio::sync::mpsc::channel(2);
        if explicit {
            sender.send(AiControlMessage::Cancel).await.unwrap();
        }
        drop(sender);
        let (mut context, _) = context(policy(), false, Some(&mut receiver));
        assert_eq!(
            context
                .wait::<()>(std::future::pending())
                .await
                .unwrap_err()
                .code,
            "ai:cancelled"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn oversized_extensions_cannot_bypass_the_configured_absolute_cap() {
    let (sender, mut receiver) = tokio::sync::mpsc::channel(2);
    sender
        .send(AiControlMessage::Extend {
            additional_ms: u32::MAX,
        })
        .await
        .unwrap();
    let (mut context, events) = context(policy(), false, Some(&mut receiver));
    let error = context
        .wait::<()>(std::future::pending())
        .await
        .unwrap_err();
    assert_eq!(error.args["timeoutStage"], "connection");
    assert!(!events
        .lock()
        .iter()
        .any(|event| matches!(event.payload, AiStreamEventPayload::DeadlineExtended { .. })));
}

#[tokio::test(start_paused = true)]
async fn an_extension_at_the_deadline_cannot_revive_the_request() {
    let mut p = policy();
    p.hard_deadline_ms = 40;
    p.response_headers_ms = 100;
    let (sender, mut receiver) = tokio::sync::mpsc::channel(2);
    let (mut context, events) = context(p, false, Some(&mut receiver));
    let extend = async {
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;
        sender
            .send(AiControlMessage::Extend { additional_ms: 100 })
            .await
            .unwrap();
    };
    let (result, _) = tokio::join!(context.wait::<()>(std::future::pending()), extend);
    assert_eq!(result.unwrap_err().args["timeoutStage"], "hardDeadline");
    assert!(!events
        .lock()
        .iter()
        .any(|event| matches!(event.payload, AiStreamEventPayload::DeadlineExtended { .. })));
}
