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
