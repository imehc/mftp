use super::*;

fn translation_request() -> AiTextRequest {
    AiTextRequest {
        instructions: "translate".into(),
        input: "source".into(),
        max_output_tokens: 1024,
        output_limit_bytes: 4096,
    }
}

#[test]
fn parses_responses_output_text() {
    let body = br#"{
        "status":"completed",
        "output":[{"content":[
            {"type":"output_text","text":"O"},
            {"type":"output_text","text":"K"}
        ]}]
    }"#;
    assert_eq!(parse_output_text(body).unwrap(), "OK");
}

#[test]
fn rejects_incomplete_or_empty_responses() {
    assert!(parse_output_text(br#"{"status":"incomplete","output":[]}"#).is_err());
    assert!(parse_output_text(br#"{"status":"completed","output":[]}"#).is_err());
    assert!(parse_output_text(b"not-json").is_err());
}

#[test]
fn provider_errors_expose_code_but_not_message() {
    let error = provider_error(
        401,
        br#"{"error":{"code":"invalid_api_key","message":"secret request content"}}"#,
    );
    assert!(error.message.contains("invalid_api_key"));
    assert!(!error.message.contains("secret request content"));
}

#[test]
fn handles_responses_stream_events_and_done_fallback() {
    let limit = translation_request().output_limit_bytes;
    let mut output = String::new();
    let mut deltas = Vec::new();
    let mut collect = |delta: &str| {
        deltas.push(delta.to_string());
        Ok(())
    };
    let first = json!({
        "type": "response.output_text.delta",
        "delta": "{\"translation\":\"Moon",
    })
    .to_string();
    assert!(!handle_stream_event(
        "response.output_text.delta",
        &first,
        limit,
        &mut output,
        &mut collect,
    )
    .unwrap());
    let second = json!({
        "type": "response.output_text.delta",
        "delta": "light\"}",
    })
    .to_string();
    assert!(!handle_stream_event(
        "response.output_text.delta",
        &second,
        limit,
        &mut output,
        &mut collect,
    )
    .unwrap());
    assert!(handle_stream_event(
        "response.completed",
        r#"{"type":"response.completed"}"#,
        limit,
        &mut output,
        &mut collect,
    )
    .unwrap());
    assert_eq!(output, r#"{"translation":"Moonlight"}"#);
    assert_eq!(deltas.len(), 2);

    let mut fallback = String::new();
    let mut fallback_deltas = Vec::new();
    let mut collect_fallback = |delta: &str| {
        fallback_deltas.push(delta.to_string());
        Ok(())
    };
    let done = json!({
        "type": "response.output_text.done",
        "text": "{\"translation\":\"Done\"}",
    })
    .to_string();
    assert!(!handle_stream_event(
        "response.output_text.done",
        &done,
        limit,
        &mut fallback,
        &mut collect_fallback,
    )
    .unwrap());
    assert_eq!(fallback, r#"{"translation":"Done"}"#);
    assert_eq!(fallback_deltas, vec![fallback.clone()]);
}

#[test]
fn streaming_output_respects_the_request_limit() {
    let mut output = String::new();
    let mut delivered = Vec::new();
    let big = "字".repeat(4096 / 3 + 2);
    let event = json!({
        "type": "response.output_text.delta",
        "delta": big,
    })
    .to_string();
    let result = handle_stream_event(
        "response.output_text.delta",
        &event,
        128,
        &mut output,
        &mut |delta: &str| -> AppResult<()> {
            delivered.push(delta.to_string());
            Ok(())
        },
    );
    assert!(result.is_err());
    assert!(output.is_empty());
    assert!(delivered.is_empty());
}
