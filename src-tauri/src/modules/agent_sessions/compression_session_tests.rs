use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use serde_json::{json, Value};

use super::model::*;
use super::tests::Fixture;
use super::AgentSessionService;

const NATIVE_ID: &str = "83c22f72-e14a-4cc6-9906-f89b9e81ff4e";

fn compressed(fixture: &Fixture, name: &str, records: &[Value]) -> PathBuf {
    let path = fixture.0.join(format!(".codex/sessions/2026/11/24/{name}"));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let payload = records
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    std::fs::write(
        &path,
        zstd::stream::encode_all(payload.as_bytes(), 1).unwrap(),
    )
    .unwrap();
    path
}

fn query(snapshot: &AgentSessionsSnapshot, search: &str) -> AgentSessionQuery {
    AgentSessionQuery {
        generation: snapshot.generation.clone(),
        agent: Some(SessionAgent::Codex),
        archived: None,
        search: search.into(),
        from: None,
        to: None,
        offset: 0,
        limit: 100,
    }
}

#[test]
fn compressed_codex_sessions_preserve_native_id_search_and_long_text_pagination() {
    let fixture = Fixture::new();
    let long = "长".repeat(70_000) + "压缩记录末尾目标";
    let path = compressed(
        &fixture,
        &format!("rollout-{NATIVE_ID}.jsonl.zst"),
        &[
            json!({"type":"session_meta","payload":{"id":"referenced-session-id","cwd":"/fixture-project"}}),
            json!({"type":"turn_context","payload":{"model":"recorded-model"}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"最初提问"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":long}]}}),
        ],
    );
    let original = std::fs::read(&path).unwrap();
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    assert!(snapshot.complete);
    assert!(snapshot.issues.is_empty());
    let page = service
        .query(query(&snapshot, "压缩记录末尾目标"), &cancel)
        .unwrap();
    assert_eq!(
        (
            page.total,
            page.items[0].session_id.as_deref(),
            page.items[0].match_index,
            page.items[0].message_count
        ),
        (1, Some(NATIVE_ID), Some(3), 2)
    );
    assert_eq!(page.items[0].model.as_deref(), Some("recorded-model"));
    let first = service
        .detail(&snapshot.generation, &page.items[0].key, 0, 2, &cancel)
        .unwrap();
    let second = service
        .detail(
            &snapshot.generation,
            &page.items[0].key,
            first.next_offset.unwrap(),
            2,
            &cancel,
        )
        .unwrap();
    assert_eq!((first.total, second.next_offset), (4, None));
    assert_eq!(
        first
            .messages
            .iter()
            .chain(&second.messages)
            .filter(|message| message.role == SessionRole::Assistant)
            .map(|message| message.text.as_str())
            .collect::<String>(),
        long
    );
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert_eq!(
        std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
        1
    );
}

#[test]
fn compressed_codex_images_stay_on_demand_and_do_not_create_decompressed_files() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let fixture = Fixture::new();
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let data = STANDARD.encode(png.into_inner());
    let path = compressed(
        &fixture,
        &format!("rollout-{NATIVE_ID}.jsonl.zst"),
        &[
            json!({"type":"session_meta","payload":{"id":NATIVE_ID}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[
                {"type":"input_text","text":"压缩历史截图"},{"type":"input_image","image_url":format!("data:image/png;base64,{data}")}
            ]}}),
        ],
    );
    let original = std::fs::read(&path).unwrap();
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service
        .query(query(&snapshot, "压缩历史截图"), &cancel)
        .unwrap();
    let detail = service
        .detail(&snapshot.generation, &page.items[0].key, 0, 100, &cancel)
        .unwrap();
    assert_eq!(detail.messages[0].images.len(), 1);
    let image = service
        .image(&snapshot.generation, &page.items[0].key, 0, 0, &cancel)
        .unwrap();
    assert_eq!(
        (image.mime.as_str(), image.data_base64),
        ("image/png", data)
    );
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert_eq!(
        std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
        1
    );
}

#[test]
fn appending_a_compressed_frame_requires_refresh_before_reading_it() {
    use std::io::Write;
    let fixture = Fixture::new();
    let path = compressed(
        &fixture,
        &format!("rollout-{NATIVE_ID}.jsonl.zst"),
        &[
            json!({"type":"session_meta","payload":{"id":NATIVE_ID}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"已有提问"}]}}),
        ],
    );
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let before = service.snapshot(false, &cancel).unwrap();
    let old = service.query(query(&before, ""), &cancel).unwrap();
    let response = json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"text":"新增压缩帧回复"}]}}).to_string()+"\n";
    let frame = zstd::stream::encode_all(response.as_bytes(), 1).unwrap();
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(&frame)
        .unwrap();
    assert_eq!(
        service
            .detail(&before.generation, &old.items[0].key, 0, 100, &cancel)
            .unwrap_err()
            .code,
        "agent_sessions:changed"
    );
    let after = service.snapshot(true, &cancel).unwrap();
    let current = service
        .query(query(&after, "新增压缩帧回复"), &cancel)
        .unwrap();
    assert_eq!((current.total, current.items[0].message_count), (1, 2));
    assert_eq!(current.items[0].key, old.items[0].key);
    assert!(after.complete);
}

#[test]
fn rewriting_compressed_history_in_same_inode_requires_refresh() {
    use std::os::unix::fs::MetadataExt;
    let fixture = Fixture::new();
    let name = format!("rollout-{NATIVE_ID}.jsonl.zst");
    let path = compressed(
        &fixture,
        &name,
        &[
            json!({"type":"session_meta","payload":{"id":NATIVE_ID}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"旧内容"}]}}),
        ],
    );
    let inode = std::fs::metadata(&path).unwrap().ino();
    let old_length = std::fs::metadata(&path).unwrap().len();
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let before = service.snapshot(false, &cancel).unwrap();
    let old = service.query(query(&before, ""), &cancel).unwrap();
    let replacement = "替换内容 ".to_owned()
        + &(0..100)
            .map(|index| index.to_string())
            .collect::<Vec<_>>()
            .join(",");
    compressed(
        &fixture,
        &name,
        &[
            json!({"type":"session_meta","payload":{"id":NATIVE_ID}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":replacement}]}}),
        ],
    );
    assert_eq!(std::fs::metadata(&path).unwrap().ino(), inode);
    assert!(std::fs::metadata(&path).unwrap().len() > old_length);
    assert_eq!(
        service
            .detail(&before.generation, &old.items[0].key, 0, 100, &cancel)
            .unwrap_err()
            .code,
        "agent_sessions:changed"
    );
    let after = service.snapshot(true, &cancel).unwrap();
    let current = service.query(query(&after, "替换内容"), &cancel).unwrap();
    let detail = service
        .detail(&after.generation, &current.items[0].key, 0, 100, &cancel)
        .unwrap();
    assert_eq!(detail.messages[0].text, replacement);
}

#[test]
fn only_corrupt_compressed_transcripts_report_format_errors() {
    let fixture = Fixture::new();
    let broken = compressed(
        &fixture,
        "broken.jsonl.zst",
        &[json!({"type":"session_meta","payload":{"id":"broken-id"}})],
    );
    std::fs::write(&broken, b"not a Zstandard frame").unwrap();
    std::fs::write(
        broken.with_file_name("unrelated-cache.zst"),
        b"unrelated cache format",
    )
    .unwrap();
    fixture.write(".codex/sessions/2026/11/24/valid.jsonl", &[
        json!({"type":"session_meta","payload":{"id":"plain-native-id"}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"未压缩会话"}]}}),
    ]);
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    assert!(!snapshot.complete);
    assert_eq!(snapshot.total, 1);
    assert_eq!(snapshot.issues.len(), 1);
    assert_eq!(snapshot.issues[0].error.code, "agent_sessions:format");
    assert_eq!(
        snapshot.issues[0].path,
        broken.canonicalize().unwrap().to_string_lossy()
    );
}

#[test]
fn changed_compressed_source_takes_precedence_over_a_read_failure() {
    use super::{
        discovery::Candidate,
        reader::{self, Reader},
    };
    use crate::error::{AppError, CustomErrorCode};
    let fixture = Fixture::new();
    let name = format!("rollout-{NATIVE_ID}.jsonl.zst");
    let path = compressed(
        &fixture,
        &name,
        &[
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"existing"}]}}),
        ],
    );
    let resource = Candidate {
        agent: SessionAgent::Codex,
        path: path.clone(),
        id: None,
        archived: false,
        codebuddy: None,
    };
    let cancel = AtomicBool::new(false);
    let revision = reader::fingerprint(&resource, &cancel).unwrap().0;
    let failure = Reader::default()
        .visit(&resource, &revision, &cancel, |_, _| {
            std::fs::write(&path, b"new generation")?;
            Err(AppError::custom(CustomErrorCode::AgentSessionFormat))
        })
        .err()
        .unwrap();
    assert_eq!(failure.code, "agent_sessions:changed");
}
