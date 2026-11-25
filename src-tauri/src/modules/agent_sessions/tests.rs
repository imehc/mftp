use std::path::{Path, PathBuf};
use std::sync::{atomic::AtomicBool, Arc};

use serde_json::json;

use super::{model::*, parser, text, AgentSessionService};

pub(super) struct Fixture(pub(super) PathBuf);

impl Fixture {
    pub(super) fn new() -> Self {
        let path = std::env::temp_dir().join(format!("mftp-session-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    pub(super) fn write(&self, relative: &str, records: &[serde_json::Value]) -> PathBuf {
        let path = self.0.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let data = records
            .iter()
            .map(|record| record.to_string())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        std::fs::write(&path, data).unwrap();
        path
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

fn query(snapshot: &AgentSessionsSnapshot, search: &str) -> AgentSessionQuery {
    AgentSessionQuery {
        generation: snapshot.generation.clone(),
        agent: None,
        archived: None,
        search: search.into(),
        from: None,
        to: None,
        offset: 0,
        limit: 100,
    }
}

fn assert_unchanged(path: &Path, original: &[u8]) {
    assert_eq!(std::fs::read(path).unwrap(), original);
}

#[test]
fn search_matches_later_chinese_dialogue_and_returns_native_codex_id() {
    let fixture = Fixture::new();
    let path = fixture.write(".codex/sessions/2026/11/24/rollout-2026-11-24T12-00-00-native.jsonl", &[
        json!({"type":"session_meta","payload":{"id":"native-session-id","cwd":"/project"}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"# AGENTS.md instructions injected"}]}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"先打开项目"}]}}),
        json!({"type":"event_msg","payload":{"type":"user_message","message":"先打开项目"}}),
        json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"text":"已经找到棋盘恢复问题"}]}}),
    ]);
    let original = std::fs::read(&path).unwrap();
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service
        .query(query(&snapshot, "棋盘恢复"), &cancel)
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(
        page.items[0].session_id.as_deref(),
        Some("native-session-id")
    );
    assert_eq!(page.items[0].match_index, Some(1));
    assert_eq!(page.items[0].message_count, 2);
    assert!(!page.items[0].key.contains("native-session-id"));
    assert_unchanged(&path, &original);
}

#[test]
fn three_sources_keep_equal_native_ids_separate_and_combine_date_filters() {
    let fixture = Fixture::new();
    fixture.write(
        ".claude/projects/project/same.jsonl",
        &[json!({"type":"user","sessionId":"same","message":{"content":"Claude 问题"}})],
    );
    fixture.write(".workbuddy/projects/project/same.jsonl", &[
        json!({"type":"ai-title","aiTitle":"本机查看器"}),
        json!({"type":"message","role":"user","timestamp":1795500000000i64,"content":[{"text":"WorkBuddy 问题"}]}),
    ]);
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service.query(query(&snapshot, "问题"), &cancel).unwrap();
    assert_eq!(page.total, 2);
    assert_ne!(page.items[0].key, page.items[1].key);
    let mut input = query(&snapshot, "问题");
    input.agent = Some(SessionAgent::Workbuddy);
    let selected = service.query(input.clone(), &cancel).unwrap();
    assert_eq!(selected.total, 1);
    input.from = Some(selected.items[0].updated_at + 1.0);
    assert_eq!(service.query(input, &cancel).unwrap().total, 0);
}

#[test]
fn malformed_lines_are_reported_and_pagination_preserves_message_indices() {
    let fixture = Fixture::new();
    let path = fixture.write(
        ".workbuddy/projects/project/native.jsonl",
        &[
            json!({"type":"message","role":"user","content":[{"text":"one"}]}),
            json!({"type":"message","role":"assistant","content":[{"text":"two"}]}),
        ],
    );
    use std::io::Write;
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(b"{broken\n")
        .unwrap();
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    assert!(!snapshot.complete);
    assert_eq!(snapshot.issues.len(), 1);
    let page = service.query(query(&snapshot, ""), &cancel).unwrap();
    let first = service
        .detail(&snapshot.generation, &page.items[0].key, 0, 1, &cancel)
        .unwrap();
    assert_eq!(first.next_offset, Some(1));
    let second = service
        .detail(&snapshot.generation, &page.items[0].key, 1, 1, &cancel)
        .unwrap();
    assert_eq!(second.messages[0].index, 1);
    assert_eq!(second.next_offset, None);
}

#[test]
fn changed_files_require_refresh_and_cancel_retains_busy_until_worker_exits() {
    let fixture = Fixture::new();
    let path = fixture.write(
        ".claude/projects/project/id.jsonl",
        &[json!({"type":"user","message":{"content":"before"}})],
    );
    let service = Arc::new(AgentSessionService::new(fixture.0.clone()));
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service.query(query(&snapshot, ""), &cancel).unwrap();
    std::fs::write(path, "{}\n").unwrap();
    assert_eq!(
        service
            .detail(&snapshot.generation, &page.items[0].key, 0, 100, &cancel)
            .unwrap_err()
            .code,
        "agent_sessions:changed"
    );
    let request = service.begin("reader".into()).unwrap();
    service.cancel("reader");
    assert!(service.is_busy().unwrap());
    assert!(service.snapshot(true, &request.cancel).is_err());
    drop(request);
    assert!(!service.is_busy().unwrap());
}

#[test]
fn codex_without_session_meta_does_not_invent_an_id_from_rollout_path() {
    let fixture = Fixture::new();
    let path = fixture.write("unknown.jsonl", &[json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"question"}]}})]);
    let parsed = parser::visit(
        &path,
        SessionAgent::Codex,
        &AtomicBool::new(false),
        |_, _| Ok(()),
    )
    .unwrap();
    assert_eq!(parsed.id, None);
}

#[test]
fn context_cleanup_unicode_excerpt_and_credentials_use_safe_boundaries() {
    assert_eq!(
        text::clean_user(
            "<system-reminder>context<user_query>真实提问</user_query></system-reminder>"
        ),
        "真实提问"
    );
    assert_eq!(
        text::clean_user("<task-notification>done</task-notification>"),
        ""
    );
    assert!(text::excerpt("İstanbul 你好内容", "你好").contains("你好"));
    assert!(!text::safe_preview("{\"password\":\"do-not-cache\"}").contains("do-not-cache"));
}

#[test]
fn large_conversations_stream_without_dropping_records_or_long_message_tails() {
    let fixture = Fixture::new();
    let long = "a".repeat(70_000) + "最后需要找到这里";
    let path = fixture.write(".workbuddy/projects/project/long.jsonl", &[json!({"type":"message","role":"assistant","content":[{"text":long}],"providerData":{"requestModelName":"actual-model"}})]);
    let mut parts = Vec::new();
    let parsed = parser::visit(
        &path,
        SessionAgent::Workbuddy,
        &AtomicBool::new(false),
        |message, _| {
            parts.push(message);
            Ok(())
        },
    )
    .unwrap();
    assert!(parsed.complete);
    assert_eq!(parsed.count, 1);
    assert_eq!(parts.len(), 3);
    assert_eq!(
        parts
            .iter()
            .map(|message| message.text.as_str())
            .collect::<String>(),
        long
    );
    assert_eq!(parts[2].model.as_deref(), Some("actual-model"));
    assert!(parts[2].continuation);
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let result = service
        .query(query(&snapshot, "最后需要找到"), &cancel)
        .unwrap();
    assert_eq!(result.total, 1);
    assert_eq!(result.items[0].match_index, Some(2));
}

#[test]
fn local_and_inline_images_are_read_on_demand_and_reject_escaped_paths() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let fixture = Fixture::new();
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let data = STANDARD.encode(bytes.into_inner());
    fixture.write(".claude/projects/project/image.jsonl", &[
        json!({"type":"user","message":{"content":[{"type":"text","text":"看这张截图"},{"type":"image","source":{"type":"base64","data":data}}]}}),
        json!({"type":"assistant","message":{"model":"recorded-model","content":[{"type":"text","text":"已看到图片"}]}}),
    ]);
    fixture.write(".workbuddy/projects/project/blocked.jsonl", &[
        json!({"type":"message","role":"user","content":[{"type":"text","text":"outside"},{"type":"image_blob_ref","blob_path":"/etc/hosts","original_filename":"not-an-image"}]}),
    ]);
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service.query(query(&snapshot, "截图"), &cancel).unwrap();
    let key = &page.items[0].key;
    assert_eq!(page.items[0].model.as_deref(), Some("recorded-model"));
    let detail = service
        .detail(&snapshot.generation, key, 0, 100, &cancel)
        .unwrap();
    assert_eq!(detail.messages[0].images.len(), 1);
    let payload = service
        .image(&snapshot.generation, key, 0, 0, &cancel)
        .unwrap();
    assert_eq!(payload.mime, "image/png");
    assert_eq!(payload.data_base64, data);
    let blocked = service.query(query(&snapshot, "outside"), &cancel).unwrap();
    assert!(service
        .image(&snapshot.generation, &blocked.items[0].key, 0, 0, &cancel)
        .is_err());
}

#[test]
fn archived_codex_sessions_remain_searchable_and_filter_separately() {
    let fixture = Fixture::new();
    fixture.write(".codex/archived_sessions/rollout-archived.jsonl", &[
        json!({"type":"session_meta","payload":{"id":"archived-native-id"}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"归档的对话"}]}}),
    ]);
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    assert_eq!(snapshot.sources.len(), 7);
    assert_eq!(
        snapshot
            .sources
            .iter()
            .find(|source| source.agent == SessionAgent::Codex)
            .unwrap()
            .count,
        1
    );
    let mut input = query(&snapshot, "归档");
    input.archived = Some(true);
    let page = service.query(input.clone(), &cancel).unwrap();
    assert_eq!(
        page.items[0].session_id.as_deref(),
        Some("archived-native-id")
    );
    assert!(page.items[0].archived);
    input.archived = Some(false);
    assert_eq!(service.query(input, &cancel).unwrap().total, 0);
}

#[test]
fn referenced_session_ids_do_not_override_codex_native_identity() {
    let fixture = Fixture::new();
    let native = "01a1f705-4cd1-78e1-9773-6b9dbaae3fca";
    let path = fixture.write(&format!("rollout-2026-11-20T11-34-42-{native}.jsonl"), &[
        json!({"type":"session_meta","payload":{"id":native}}),
        json!({"type":"compacted","sessionId":"other-session-reference"}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"真实内容"}]}}),
    ]);
    let parsed = parser::visit(
        &path,
        SessionAgent::Codex,
        &AtomicBool::new(false),
        |_, _| Ok(()),
    )
    .unwrap();
    assert_eq!(parsed.id.as_deref(), Some(native));
    assert_eq!(parsed.count, 1);
}

#[test]
fn appending_records_keeps_existing_pages_readable_until_explicit_refresh() {
    use std::io::Write;
    let fixture = Fixture::new();
    let path = fixture.write(
        ".workbuddy/projects/project/append.jsonl",
        &[json!({"type":"message","role":"user","content":[{"text":"已有内容"}]})],
    );
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service.query(query(&snapshot, ""), &cancel).unwrap();
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(
            (json!({"type":"message","role":"assistant","content":[{"text":"追加内容"}]})
                .to_string()
                + "\n")
                .as_bytes(),
        )
        .unwrap();
    let before = service
        .detail(&snapshot.generation, &page.items[0].key, 0, 100, &cancel)
        .unwrap();
    assert_eq!(before.total, 1);
    let refreshed = service.snapshot(true, &cancel).unwrap();
    let after = service
        .detail(&refreshed.generation, &page.items[0].key, 0, 100, &cancel)
        .unwrap();
    assert_eq!(after.total, 2);
}
