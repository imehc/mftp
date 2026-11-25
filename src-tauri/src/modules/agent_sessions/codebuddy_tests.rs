use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use rusqlite::Connection;
use serde_json::{json, Value};

use super::model::*;
use super::tests::Fixture;
use super::AgentSessionService;

const DATABASE: &str = "Library/Application Support/CodeBuddy CN/codebuddy-sessions.vscdb";
const HISTORY: &str = "Library/Application Support/CodeBuddyExtension/Data/user/CodeBuddyIDE/instance/history/workspace";

fn metadata(fixture: &Fixture, id: &str, deleted: bool) {
    let path = fixture.0.join(DATABASE);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let connection = Connection::open(path).unwrap();
    connection
        .execute_batch("CREATE TABLE IF NOT EXISTS ItemTable(key TEXT PRIMARY KEY,value TEXT)")
        .unwrap();
    connection.execute("INSERT INTO ItemTable VALUES(?1,?2)", rusqlite::params![format!("session:{id}"), json!({
        "conversationId":id,"title":"本机历史","cwd":"/project", "createdAt":1795500000000i64,"updatedAt":1795501000000i64,
        "deletedAt":if deleted {json!(1795502000000i64)} else {Value::Null}
    }).to_string()]).unwrap();
}

fn conversation(fixture: &Fixture, history: &str, id: &str, records: &[Value]) -> PathBuf {
    let ids: Vec<_> = records
        .iter()
        .enumerate()
        .map(|(index, record)| {
            let message_id = format!("m{index}");
            fixture.write(
                &format!("{history}/{id}/messages/{message_id}.json"),
                &[record.clone()],
            );
            message_id
        })
        .collect();
    fixture.write(
        &format!("{history}/{id}/index.json"),
        &[json!({"messages":ids})],
    )
}

fn query(snapshot: &AgentSessionsSnapshot, search: &str) -> AgentSessionQuery {
    AgentSessionQuery {
        generation: snapshot.generation.clone(),
        agent: Some(SessionAgent::Codebuddy),
        archived: None,
        search: search.into(),
        from: None,
        to: None,
        offset: 0,
        limit: 100,
    }
}

fn bytes(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap()
}

#[test]
fn stored_deleted_markers_and_empty_history_are_respected_without_source_writes() {
    let fixture = Fixture::new();
    metadata(&fixture, "active", false);
    metadata(&fixture, "deleted", true);
    metadata(&fixture, "empty", false);
    let active = conversation(
        &fixture,
        HISTORY,
        "active",
        &[
            json!({"role":"user","message":"查看历史"}),
            json!({"role":"assistant","message":"已找到","extra":json!({"modelId":"recorded-model"}).to_string()}),
        ],
    );
    conversation(
        &fixture,
        HISTORY,
        "deleted",
        &[json!({"role":"user","message":"不应自动恢复删除项"})],
    );
    conversation(&fixture, HISTORY, "empty", &[]);
    let database = fixture.0.join(DATABASE);
    let originals = (bytes(&database), bytes(&active));
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    assert!(snapshot.complete);
    let page = service.query(query(&snapshot, ""), &cancel).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].session_id.as_deref(), Some("active"));
    assert_eq!(page.items[0].message_count, 2);
    assert_eq!(page.items[0].model.as_deref(), Some("recorded-model"));
    assert_eq!(page.items[0].updated_at, 1795501000000.0);
    assert!(!page.items[0].archived);
    assert_eq!(bytes(&database), originals.0);
    assert_eq!(bytes(&active), originals.1);
    assert!(!database.with_extension("vscdb-shm").exists());
    assert!(!database.with_extension("vscdb-wal").exists());
}

#[test]
fn tool_search_and_pagination_share_stable_indices_and_recorded_models() {
    let fixture = Fixture::new();
    metadata(&fixture, "active", false);
    conversation(
        &fixture,
        HISTORY,
        "active",
        &[
            json!({"role":"user","message":"开始工作"}),
            json!({"role":"tool","message":"检查工具中的中文命中位置"}),
            json!({"role":"assistant","message":"工作完成","extra":json!({"modelId":"actual-model"}).to_string()}),
        ],
    );
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service
        .query(query(&snapshot, "中文命中"), &cancel)
        .unwrap();
    assert_eq!(page.items[0].match_index, Some(1));
    let detail = service
        .detail(&snapshot.generation, &page.items[0].key, 1, 1, &cancel)
        .unwrap();
    assert_eq!(detail.messages[0].role, SessionRole::Tool);
    assert_eq!(detail.next_offset, Some(2));
    assert_eq!(detail.total, 3);
    assert_eq!(detail.session.message_count, 2);
}

#[test]
fn equal_ids_in_distinct_namespaces_remain_separate_and_rewritten_messages_require_refresh() {
    let fixture = Fixture::new();
    metadata(&fixture, "shared", false);
    let first = conversation(
        &fixture,
        HISTORY,
        "shared",
        &[json!({"role":"user","message":"before"})],
    );
    let other = HISTORY.replace("/user/", "/other/");
    conversation(
        &fixture,
        &other,
        "shared",
        &[json!({"role":"user","message":"other"})],
    );
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service.query(query(&snapshot, ""), &cancel).unwrap();
    assert_eq!(page.total, 2);
    assert_ne!(page.items[0].key, page.items[1].key);
    let selected = page
        .items
        .iter()
        .find(|entry| entry.path == first.canonicalize().unwrap().to_string_lossy())
        .unwrap();
    std::fs::write(
        first.parent().unwrap().join("messages/m0.json"),
        json!({"role":"user","message":"change"}).to_string(),
    )
    .unwrap();
    assert_eq!(
        service
            .detail(&snapshot.generation, &selected.key, 0, 1, &cancel)
            .unwrap_err()
            .code,
        "agent_sessions:changed"
    );
}

#[test]
fn message_images_are_read_on_demand_from_original_source_blocks() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let fixture = Fixture::new();
    metadata(&fixture, "image", false);
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let encoded = STANDARD.encode(bytes.into_inner());
    conversation(
        &fixture,
        HISTORY,
        "image",
        &[
            json!({"role":"user","message":"截图","extra":json!({"sourceContentBlocks":[{"type":"image","data":encoded,"mimeType":"image/png"}]}).to_string()}),
        ],
    );
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service.query(query(&snapshot, ""), &cancel).unwrap();
    let detail = service
        .detail(&snapshot.generation, &page.items[0].key, 0, 100, &cancel)
        .unwrap();
    assert_eq!(detail.messages[0].images.len(), 1);
    let payload = service
        .image(&snapshot.generation, &page.items[0].key, 0, 0, &cancel)
        .unwrap();
    assert_eq!(payload.data_base64, encoded);
}

#[test]
fn missing_referenced_message_and_unsafe_ids_are_reported_as_issues() {
    let fixture = Fixture::new();
    metadata(&fixture, "missing", false);
    fixture.write(
        &format!("{HISTORY}/missing/index.json"),
        &[json!({"messages":["../outside"]})],
    );
    let service = AgentSessionService::new(fixture.0.clone());
    let snapshot = service.snapshot(false, &AtomicBool::new(false)).unwrap();
    assert!(!snapshot.complete);
    assert_eq!(snapshot.total, 0);
    assert_eq!(snapshot.issues[0].error.code, "agent_sessions:format");
}

#[test]
fn malformed_extra_retains_readable_text_and_reports_incomplete_history() {
    let fixture = Fixture::new();
    metadata(&fixture, "partial", false);
    conversation(
        &fixture,
        HISTORY,
        "partial",
        &[
            json!({"role":"user","message":"可读内容","extra":"{broken"}),
            json!({"role":"assistant","message":"后续正文"}),
        ],
    );
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service
        .query(query(&snapshot, "可读内容"), &cancel)
        .unwrap();
    assert!(!snapshot.complete);
    assert_eq!(page.total, 1);
    let detail = service
        .detail(&snapshot.generation, &page.items[0].key, 0, 100, &cancel)
        .unwrap();
    assert!(!detail.complete);
    assert_eq!(detail.messages.len(), 2);
    assert_eq!(detail.messages[1].text, "后续正文");
}

#[test]
fn orphan_nonempty_history_is_reported_without_restoring_deleted_records() {
    let fixture = Fixture::new();
    metadata(&fixture, "deleted", true);
    conversation(
        &fixture,
        HISTORY,
        "deleted",
        &[json!({"role":"user","message":"deleted"})],
    );
    conversation(
        &fixture,
        HISTORY,
        "orphan",
        &[json!({"role":"user","message":"orphan"})],
    );
    conversation(&fixture, HISTORY, "empty", &[]);
    let service = AgentSessionService::new(fixture.0.clone());
    let snapshot = service.snapshot(false, &AtomicBool::new(false)).unwrap();
    assert_eq!(snapshot.total, 0);
    assert_eq!(snapshot.issues.len(), 1);
    assert!(snapshot.issues[0].path.contains("orphan"));
    assert_eq!(snapshot.issues[0].error.code, "agent_sessions:missing");
}

#[test]
fn database_changes_after_discovery_cannot_bind_old_metadata_to_new_revision() {
    use super::{codebuddy, discovery::Candidate, reader, sqlite_snapshot::Snapshot};
    let fixture = Fixture::new();
    metadata(&fixture, "active", false);
    let history = conversation(
        &fixture,
        HISTORY,
        "active",
        &[json!({"role":"user","message":"kept"})],
    );
    let database = fixture.0.join(DATABASE);
    let cancel = AtomicBool::new(false);
    let snapshot = Snapshot::open(&database, &cancel).unwrap();
    let meta = codebuddy::metadata(
        snapshot.connection(),
        &database,
        snapshot.revision(),
        &cancel,
    )
    .unwrap()
    .remove("active")
    .unwrap();
    drop(snapshot);
    let writer = Connection::open(&database).unwrap();
    writer
        .execute(
            "UPDATE ItemTable SET value=?1 WHERE key='session:active'",
            [json!({"conversationId":"active","deletedAt":1795500000000i64}).to_string()],
        )
        .unwrap();
    drop(writer);
    let resource = Candidate {
        agent: SessionAgent::Codebuddy,
        path: history,
        id: Some("active".into()),
        archived: false,
        codebuddy: Some(meta),
    };
    assert_eq!(
        reader::fingerprint(&resource, &cancel).unwrap_err().code,
        "agent_sessions:changed"
    );
}
