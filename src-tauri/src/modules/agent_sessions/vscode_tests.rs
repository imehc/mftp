use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::{json, Value};

use super::model::SessionRole;
use super::vscode;

struct Fixture {
    root: PathBuf,
    path: PathBuf,
}

impl Fixture {
    fn new(records: &[Value]) -> Self {
        let root = std::env::temp_dir().join(format!("mftp-copilot-test-{}", uuid::Uuid::new_v4()));
        let path = root.join("workspace/project/chatSessions/native.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let data = records
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        std::fs::write(&path, data).unwrap();
        Self { root, path }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn incremental_log_rebuilds_replaced_text_and_cleared_title() {
    let fixture = Fixture::new(&[
        json!({"kind":0,"v":{"sessionId":"original-id","customTitle":"旧标题","requests":[]}}),
        json!({"kind":2,"k":["requests"],"v":[{"message":{"text":"旧提问"},"modelId":"actual-model","response":[{"value":"旧回复"}]}]}),
        json!({"kind":1,"k":["requests",0,"message","text"],"v":"最后提问"}),
        json!({"kind":2,"k":["requests",0,"response"],"i":0,"v":[{"value":"替换的回复","supportHtml":false}]}),
        json!({"kind":3,"k":["customTitle"]}),
    ]);
    let mut messages = Vec::new();
    let transcript = vscode::visit(
        &fixture.path,
        &AtomicBool::new(false),
        None,
        |message, _| {
            messages.push((message.role, message.text, message.model));
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(
        messages,
        vec![
            (SessionRole::User, "最后提问".into(), None),
            (
                SessionRole::Assistant,
                "替换的回复".into(),
                Some("actual-model".into())
            ),
        ]
    );
    assert!(transcript.complete);
    assert_eq!(transcript.title, "最后提问");
}

#[test]
fn array_update_without_value_truncates_instead_of_inserting_null() {
    let fixture = Fixture::new(&[
        json!({"kind":0,"v":{"requests":[{"message":{"text":"保留"}},{"message":{"text":"删除"}}]}}),
        json!({"kind":2,"k":["requests"],"i":1}),
    ]);
    let mut texts = Vec::new();
    vscode::visit(
        &fixture.path,
        &AtomicBool::new(false),
        None,
        |message, _| {
            texts.push(message.text);
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(texts, vec!["保留"]);
}

#[test]
fn later_initial_snapshot_replaces_all_previous_requests_and_identity() {
    let fixture = Fixture::new(&[
        json!({"kind":0,"v":{"sessionId":"old-id","requests":[{"message":{"text":"旧内容"}}]}}),
        json!({"kind":0,"v":{"sessionId":"new-id","requests":[{"message":{"text":"新内容"}}]}}),
    ]);
    let mut texts = Vec::new();
    let transcript = vscode::visit(
        &fixture.path,
        &AtomicBool::new(false),
        None,
        |message, _| {
            texts.push(message.text);
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(
        (transcript.id.as_deref(), texts),
        (Some("new-id"), vec!["新内容".into()])
    );
}

#[test]
fn malformed_and_unsafe_mutations_report_partial_without_overwriting_dialogue() {
    let fixture = Fixture::new(&[
        json!({"kind":0,"v":{"requests":[{"message":{"text":"已有内容"}}]}}),
        json!({"kind":1,"k":["requests",999999999,"message"],"v":{"text":"无效路径"}}),
        json!({"kind":1,"k":["__proto__","value"],"v":"危险路径"}),
        json!({"kind":2,"k":["requests"],"i":1000000000,"v":[]}),
        json!({"kind":2,"k":["requests"],"v":{"invalid":"array"}}),
        json!({"kind":9,"k":["requests"],"v":[]}),
    ]);
    use std::io::Write;
    std::fs::OpenOptions::new()
        .append(true)
        .open(&fixture.path)
        .unwrap()
        .write_all(b"{partial\n")
        .unwrap();
    let mut texts = Vec::new();
    let transcript = vscode::visit(
        &fixture.path,
        &AtomicBool::new(false),
        None,
        |message, _| {
            texts.push(message.text);
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(
        (transcript.complete, texts),
        (false, vec!["已有内容".into()])
    );
}

#[test]
fn log_without_initial_snapshot_returns_structured_format_error() {
    let fixture = Fixture::new(&[json!({"kind":2,"k":["requests"],"v":[]})]);
    let error = vscode::visit(&fixture.path, &AtomicBool::new(false), None, |_, _| Ok(()))
        .err()
        .unwrap();
    assert_eq!(error.code, "agent_sessions:format");
}

#[test]
fn identity_is_not_invented_from_an_unknown_filename() {
    let fixture = Fixture::new(&[json!({"kind":0,"v":{"requests":[{"message":{"text":"内容"}}]}})]);
    let transcript =
        vscode::visit(&fixture.path, &AtomicBool::new(false), None, |_, _| Ok(())).unwrap();
    assert_eq!(transcript.id, None);
}

#[test]
fn canonical_uuid_filename_preserves_native_identity_when_snapshot_omits_it() {
    let fixture = Fixture::new(&[json!({"kind":0,"v":{"requests":[{"message":{"text":"内容"}}]}})]);
    let native = "83c22f72-e14a-4cc6-9906-f89b9e81ff4e";
    let path = fixture.path.with_file_name(format!("{native}.jsonl"));
    std::fs::rename(&fixture.path, &path).unwrap();
    let transcript = vscode::visit(&path, &AtomicBool::new(false), None, |_, _| Ok(())).unwrap();
    assert_eq!(transcript.id.as_deref(), Some(native));
}

#[test]
fn metadata_reads_workspace_uri_and_actual_request_model() {
    let fixture = Fixture::new(&[json!({"kind":0,"v":{
        "sessionId":"native-id","creationDate":1795500000000i64,
        "inputState":{"selectedModel":{"identifier":"current-input-model"}},
        "requests":[{"timestamp":1795501000000i64,"modelId":"recorded-model","message":{"text":"提问"},"response":[{"value":"回复"}]}]
    }})]);
    std::fs::write(
        fixture
            .path
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("workspace.json"),
        json!({"folder":"file:///workspace/project%20with%20spaces"}).to_string(),
    )
    .unwrap();
    let transcript =
        vscode::visit(&fixture.path, &AtomicBool::new(false), None, |_, _| Ok(())).unwrap();
    assert_eq!(
        (
            transcript.cwd.as_str(),
            transcript.model.as_deref(),
            transcript.created,
            transcript.updated
        ),
        (
            "/workspace/project with spaces",
            Some("recorded-model"),
            Some(1795500000000.0),
            Some(1795501000000.0)
        )
    );
}

#[test]
fn hidden_requests_are_omitted_and_system_initiated_prompts_keep_system_role() {
    let fixture = Fixture::new(&[json!({"kind":0,"v":{"requests":[
        {"hiddenFromTranscript":true,"message":{"text":"隐藏提问"},"response":[{"value":"隐藏回复"}]},
        {"isSystemInitiated":true,"message":{"text":"系统触发"},"response":[{"kind":"thinking","value":"思考"},{"value":"回复"}]}
    ]}})]);
    let mut messages = Vec::new();
    let transcript = vscode::visit(
        &fixture.path,
        &AtomicBool::new(false),
        None,
        |message, _| {
            messages.push((message.role, message.text));
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(
        messages,
        vec![
            (SessionRole::System, "系统触发".into()),
            (SessionRole::Thinking, "思考".into()),
            (SessionRole::Assistant, "回复".into()),
        ]
    );
    assert_eq!(transcript.count, 1);
}

#[test]
fn missing_model_does_not_inherit_previous_request_model() {
    let fixture = Fixture::new(&[json!({"kind":0,"v":{"requests":[
        {"modelId":"first-model","message":{"text":"第一问"},"response":[{"value":"第一答"}]},
        {"message":{"text":"第二问"},"response":[{"value":"第二答"}]}
    ]}})]);
    let mut models = Vec::new();
    vscode::visit(
        &fixture.path,
        &AtomicBool::new(false),
        None,
        |message, _| {
            if message.role == SessionRole::Assistant {
                models.push(message.model);
            }
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(models, vec![Some("first-model".into()), None]);
}

#[test]
fn empty_shell_with_title_still_has_no_dialogue() {
    let fixture = Fixture::new(&[json!({"kind":0,"v":{"customTitle":"只有标题","requests":[]}})]);
    let transcript =
        vscode::visit(&fixture.path, &AtomicBool::new(false), None, |_, _| Ok(())).unwrap();
    assert_eq!((transcript.count, transcript.total), (0, 0));
}

#[test]
fn response_fragments_count_as_one_logical_assistant_response() {
    let fixture = Fixture::new(&[json!({"kind":0,"v":{"requests":[{
        "message":{"text":"提问"},"response":[
            {"value":"第一段"},{"kind":"thinking","value":"思考"},
            {"kind":"toolInvocationSerialized","toolId":"recorded-tool"},
            {"value":"第二段"},{"value":"第三段"}
        ]
    }]}})]);
    let transcript =
        vscode::visit(&fixture.path, &AtomicBool::new(false), None, |_, _| Ok(())).unwrap();
    assert_eq!((transcript.count, transcript.total), (2, 6));
}

#[test]
fn explicit_creation_date_is_preserved_even_when_request_time_is_earlier() {
    let fixture = Fixture::new(&[json!({"kind":0,"v":{
        "creationDate":1795501000000i64,
        "requests":[{"timestamp":1795500000000i64,"message":{"text":"提问"}}]
    }})]);
    let transcript =
        vscode::visit(&fixture.path, &AtomicBool::new(false), None, |_, _| Ok(())).unwrap();
    assert_eq!(transcript.created, Some(1795501000000.0));
}

#[test]
fn long_markdown_keeps_all_chunks_and_stable_message_indices() {
    let long = "长".repeat(70_000) + "末尾搜索目标";
    let fixture = Fixture::new(&[json!({"kind":0,"v":{"requests":[
        {"message":{"text":"提问"},"response":[{"value":long}]}
    ]}})]);
    let mut parts = Vec::new();
    let transcript = vscode::visit(
        &fixture.path,
        &AtomicBool::new(false),
        None,
        |message, _| {
            parts.push(message);
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(
        parts
            .iter()
            .skip(1)
            .map(|message| message.text.as_str())
            .collect::<String>(),
        long
    );
    assert_eq!(
        (
            transcript.count,
            transcript.total,
            parts[3].index,
            parts[3].continuation
        ),
        (2, 4, 3, true)
    );
}

#[test]
fn user_attachment_and_binary_tool_result_use_on_demand_image_references() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let data = STANDARD.encode(png.into_inner());
    let fixture = Fixture::new(&[json!({"kind":0,"v":{"requests":[{
        "message":{"text":"看图片"},
        "variableData":{"variables":[{"kind":"image","name":"attachment.png","mimeType":"image/png","value":data}]},
        "response":[{"kind":"toolInvocationSerialized","toolId":"image_tool","invocationMessage":{"value":"生成图片"},
            "resultDetails":{"output":{"type":"data","mimeType":"image/png","base64Data":data}}}]
    }]}})]);
    let original = std::fs::read(&fixture.path).unwrap();
    let mut images = Vec::new();
    let mut texts = Vec::new();
    vscode::visit(
        &fixture.path,
        &AtomicBool::new(false),
        None,
        |message, sources| {
            texts.push(message.text);
            for source in sources {
                images.push(source.read(&fixture.root).unwrap().data_base64);
            }
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(images, vec![data.clone(), data.clone()]);
    assert!(!texts.iter().any(|text| text.contains(&data)));
    assert_eq!(std::fs::read(&fixture.path).unwrap(), original);
}

#[test]
fn remote_image_uri_is_not_treated_as_local_or_base64_data() {
    let fixture = Fixture::new(&[json!({"kind":0,"v":{"requests":[{
        "message":{"text":"远程引用"},
        "variableData":{"variables":[{"kind":"image","mimeType":"image/png","value":"https://example.invalid/image.png","isURL":true}]}
    }]}})]);
    let mut count = 0;
    vscode::visit(&fixture.path, &AtomicBool::new(false), None, |_, images| {
        count += images.len();
        Ok(())
    })
    .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn requested_prefix_excludes_later_appended_mutations() {
    use std::io::Write;
    let fixture =
        Fixture::new(&[json!({"kind":0,"v":{"requests":[{"message":{"text":"已有内容"}}]}})]);
    let length = std::fs::metadata(&fixture.path).unwrap().len();
    std::fs::OpenOptions::new()
        .append(true)
        .open(&fixture.path)
        .unwrap()
        .write_all(
            (json!({"kind":2,"k":["requests"],"v":[{"message":{"text":"追加内容"}}]}).to_string()
                + "\n")
                .as_bytes(),
        )
        .unwrap();
    let mut texts = Vec::new();
    vscode::visit(
        &fixture.path,
        &AtomicBool::new(false),
        Some(length),
        |message, _| {
            texts.push(message.text);
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(texts, vec!["已有内容"]);
}

#[test]
fn cancellation_from_callback_stops_before_next_response() {
    let fixture = Fixture::new(&[json!({"kind":0,"v":{"requests":[
        {"message":{"text":"提问"},"response":[{"value":"回复"}]}
    ]}})]);
    let cancel = AtomicBool::new(false);
    let error = vscode::visit(&fixture.path, &cancel, None, |_, _| {
        cancel.store(true, Ordering::Release);
        Ok(())
    })
    .err()
    .unwrap();
    assert_eq!(error.code, "agent_sessions:cancelled");
}

#[test]
fn oversized_file_returns_limit_without_reading_its_body() {
    let fixture = Fixture::new(&[]);
    std::fs::OpenOptions::new()
        .write(true)
        .open(&fixture.path)
        .unwrap()
        .set_len(64 * 1024 * 1024 + 1)
        .unwrap();
    let error = vscode::visit(&fixture.path, &AtomicBool::new(false), None, |_, _| Ok(()))
        .err()
        .unwrap();
    assert_eq!(error.code, "agent_sessions:limit");
}

#[test]
fn many_tiny_values_hit_allocation_budget_before_json_decoding() {
    let fixture = Fixture::new(&[]);
    let data = "{\"kind\":0,\"v\":{\"requests\":[".to_owned() + &"0,".repeat(600_000) + "0]}}\n";
    std::fs::write(&fixture.path, data).unwrap();
    let error = vscode::visit(&fixture.path, &AtomicBool::new(false), None, |_, _| Ok(()))
        .err()
        .unwrap();
    assert_eq!(error.code, "agent_sessions:limit");
}
