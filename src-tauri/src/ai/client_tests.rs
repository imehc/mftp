use super::*;

fn poem() -> PoemDetail {
    PoemDetail {
        uid: "uid".into(),
        collection_id: "tang".into(),
        collection_name: "唐诗".into(),
        title: "静夜思".into(),
        author: "李白".into(),
        dynasty: "唐".into(),
        rhythmic: String::new(),
        chapter: String::new(),
        body: vec!["床前明月光".into(), "疑是地上霜".into()],
        notes: vec!["must not be sent".into()],
        strains: vec!["must not be sent".into()],
        author_bio: None,
        annotation: None,
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
fn validates_plain_and_json_translation_output() {
    assert_eq!(parse_translation_output("Moonlight").unwrap(), "Moonlight");
    assert_eq!(
        parse_translation_output(r#"{"translation":"月光照在床前。"}"#).unwrap(),
        "月光照在床前。"
    );
    assert_eq!(
        parse_translation_output("```json\n{\"translation\":\"Fenced\"}\n```").unwrap(),
        "Fenced"
    );
    assert!(parse_translation_output(r#"{"translation":"  "}"#).is_err());
    assert!(parse_translation_output(r#"{"translation":"text","extra":true}"#).is_err());
}

#[test]
fn poetry_input_contains_only_allowed_source_fields() {
    let input = poetry_input(&poem());
    let value: Value = serde_json::from_str(&input).unwrap();
    let object = value.as_object().unwrap();
    let keys = object.keys().map(String::as_str).collect::<Vec<_>>();
    assert_eq!(keys, vec!["author", "body", "dynasty", "title"]);
    assert!(!input.contains("must not be sent"));
}

#[test]
fn provider_errors_expose_code_but_not_message() {
    let error = provider_error(
        401,
        br#"{"error":{"code":"invalid_api_key","message":"secret request content"}}"#,
    );
    assert!(error.0.contains("invalid_api_key"));
    assert!(!error.0.contains("secret request content"));
}

#[test]
fn handles_responses_stream_events_and_done_fallback() {
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
        &mut output,
        &mut collect,
    )
    .unwrap());
    assert!(handle_stream_event(
        "response.completed",
        r#"{"type":"response.completed"}"#,
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
        &mut fallback,
        &mut collect_fallback,
    )
    .unwrap());
    assert_eq!(fallback, r#"{"translation":"Done"}"#);
    assert_eq!(fallback_deltas, vec![fallback.clone()]);
}
