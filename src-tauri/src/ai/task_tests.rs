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
fn task_request_has_a_fixed_input_allowlist() {
    let request = AiTask::poetry_translation(PoetryTranslationMode::Literal)
        .request(&poem())
        .unwrap();
    let value: serde_json::Value = serde_json::from_str(&request.input).unwrap();
    let keys = value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();
    assert_eq!(keys, vec!["author", "body", "dynasty", "title"]);
    assert!(!request.input.contains("must not be sent"));
}

#[test]
fn task_request_rejects_empty_source_text() {
    let mut source = poem();
    source.body.clear();
    assert!(AiTask::poetry_translation(PoetryTranslationMode::Literal)
        .request(&source)
        .is_err());
}

#[test]
fn modes_differ_and_both_forbid_echoing_the_classical_wording() {
    let literal = AiTask::poetry_translation(PoetryTranslationMode::Literal)
        .request(&poem())
        .unwrap();
    let literary = AiTask::poetry_translation(PoetryTranslationMode::Literary)
        .request(&poem())
        .unwrap();
    assert_ne!(literal.instructions(), literary.instructions());
    for request in [&literal, &literary] {
        assert!(request.instructions().contains("is not a translation"));
    }
    assert!(literal.instructions().contains("one line per source line"));
}

#[test]
fn output_budget_scales_with_the_source_length() {
    let mut long = poem();
    long.body = vec!["床前明月光".repeat(80)];
    let short_tokens = AiTask::poetry_translation(PoetryTranslationMode::Literal)
        .request(&poem())
        .unwrap()
        .max_output_tokens();
    let long_tokens = AiTask::poetry_translation(PoetryTranslationMode::Literal)
        .request(&long)
        .unwrap()
        .max_output_tokens();
    assert!(short_tokens >= MIN_OUTPUT_TOKENS);
    assert!(long_tokens > short_tokens);
    assert!(long_tokens <= MAX_OUTPUT_TOKENS);
}
