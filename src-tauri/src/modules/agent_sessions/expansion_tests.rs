use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::AtomicBool;

use rusqlite::{params, Connection};
use serde_json::json;

use super::model::*;
use super::tests::Fixture;
use super::AgentSessionService;

const WORKSPACE: &str =
    "Library/Application Support/Code/User/workspaceStorage/project/chatSessions";
const GLOBAL: &str = "Library/Application Support/Code/User/globalStorage/emptyWindowChatSessions";

fn query(snapshot: &AgentSessionsSnapshot, search: &str) -> AgentSessionQuery {
    AgentSessionQuery {
        sort: SessionSort::Updated,
        min_bytes: None,
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

#[test]
fn copilot_workspace_and_global_records_with_equal_native_ids_remain_separate() {
    let fixture = Fixture::new();
    fixture.write(&format!("{WORKSPACE}/same.jsonl"), &[
        json!({"kind":0,"v":{"sessionId":"same-native-id","requests":[{"message":{"text":"工作区对话"}}]}}),
    ]);
    fixture.write(&format!("{GLOBAL}/same.jsonl"), &[
        json!({"kind":0,"v":{"sessionId":"same-native-id","requests":[{"message":{"text":"空窗口对话"}}]}}),
    ]);
    fixture.write("Library/Application Support/Code/User/workspaceStorage/project/unrelated.jsonl", &[
        json!({"kind":0,"v":{"sessionId":"unrelated","requests":[{"message":{"text":"非聊天日志"}}]}}),
    ]);
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service.query(query(&snapshot, ""), &cancel).unwrap();
    assert_eq!(page.total, 2);
    assert_eq!(
        page.items
            .iter()
            .map(|item| item.key.as_str())
            .collect::<HashSet<_>>()
            .len(),
        2
    );
    assert!(page
        .items
        .iter()
        .all(|item| item.agent == SessionAgent::Copilot
            && item.session_id.as_deref() == Some("same-native-id")));
    assert_eq!(
        snapshot
            .sources
            .iter()
            .find(|source| source.agent == SessionAgent::Copilot)
            .unwrap()
            .count,
        2
    );
}

#[test]
fn copilot_empty_shells_do_not_increase_source_count_or_session_results() {
    let fixture = Fixture::new();
    fixture.write(
        &format!("{WORKSPACE}/empty.jsonl"),
        &[json!({"kind":0,"v":{"sessionId":"empty","customTitle":"空会话标题","requests":[]}})],
    );
    fixture.write(
        &format!("{GLOBAL}/empty.jsonl"),
        &[json!({"kind":0,"v":{"sessionId":"empty-global","requests":[]}})],
    );
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service.query(query(&snapshot, ""), &cancel).unwrap();
    let source = snapshot
        .sources
        .iter()
        .find(|source| source.agent == SessionAgent::Copilot)
        .unwrap();
    assert_eq!(
        (source.available, source.count, snapshot.total, page.total),
        (true, 0, 0, 0)
    );
    assert!(snapshot.complete);
}

#[test]
fn copilot_search_reaches_final_long_response_and_detail_pages_have_no_gaps() {
    let fixture = Fixture::new();
    let mut requests = (0..102).map(|index| json!({
        "message":{"text":format!("第{index}次提问")},"response":[{"value":format!("第{index}次回复")}]
    })).collect::<Vec<_>>();
    requests[101]["response"][0]["value"] = json!("长".repeat(70_000) + "末尾正文目标");
    let path = fixture.write(
        &format!("{WORKSPACE}/long.jsonl"),
        &[
            json!({"kind":0,"v":{"sessionId":"long-native-id","requests":[]}}),
            json!({"kind":2,"k":["requests"],"v":requests}),
        ],
    );
    let original = std::fs::read(&path).unwrap();
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service
        .query(query(&snapshot, "末尾正文目标"), &cancel)
        .unwrap();
    assert_eq!(
        (
            page.total,
            page.items[0].match_index,
            page.items[0].message_count
        ),
        (1, Some(205), 204)
    );
    let key = &page.items[0].key;
    let first = service
        .detail(&snapshot.generation, key, 0, 100, &cancel)
        .unwrap();
    let second = service
        .detail(
            &snapshot.generation,
            key,
            first.next_offset.unwrap(),
            100,
            &cancel,
        )
        .unwrap();
    let last = service
        .detail(
            &snapshot.generation,
            key,
            second.next_offset.unwrap(),
            100,
            &cancel,
        )
        .unwrap();
    let indices = first
        .messages
        .iter()
        .chain(&second.messages)
        .chain(&last.messages)
        .map(|message| message.index)
        .collect::<Vec<_>>();
    assert_eq!(indices, (0..206).collect::<Vec<_>>());
    assert_eq!((last.total, last.next_offset), (206, None));
    assert!(last.messages.last().unwrap().text.contains("末尾正文目标"));
    assert_eq!(std::fs::read(path).unwrap(), original);
}

#[test]
fn copilot_appending_mutations_requires_refresh_before_detail_and_body_search() {
    use std::io::Write;
    let fixture = Fixture::new();
    let path = fixture.write(&format!("{WORKSPACE}/append.jsonl"), &[
        json!({"kind":0,"v":{"sessionId":"append-id","requests":[{"message":{"text":"原有提问"},"response":[{"value":"原有回复"}]}]}}),
    ]);
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let before = service.snapshot(false, &cancel).unwrap();
    let old = service.query(query(&before, ""), &cancel).unwrap();
    std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all((
        json!({"kind":2,"k":["requests"],"v":[{"message":{"text":"追加提问"},"response":[{"value":"追加回复"}]}]}).to_string()+"\n"
    ).as_bytes()).unwrap();
    let error = service
        .detail(&before.generation, &old.items[0].key, 0, 100, &cancel)
        .unwrap_err();
    assert_eq!(error.code, "agent_sessions:changed");
    let stale = service.query(query(&before, "追加回复"), &cancel).unwrap();
    assert_eq!((stale.total, stale.complete), (0, false));
    assert!(stale
        .issues
        .iter()
        .any(|issue| issue.error.code == "agent_sessions:changed"));
    let after = service.snapshot(true, &cancel).unwrap();
    let updated = service.query(query(&after, "追加回复"), &cancel).unwrap();
    assert_eq!((updated.total, updated.items[0].message_count), (1, 4));
    assert_eq!(updated.items[0].key, old.items[0].key);
    assert_ne!(after.generation, before.generation);
}

#[test]
fn copilot_same_inode_rewrite_to_larger_log_requires_refresh() {
    use std::os::unix::fs::MetadataExt;
    let fixture = Fixture::new();
    let path = fixture.write(&format!("{GLOBAL}/rewrite.jsonl"), &[
        json!({"kind":0,"v":{"sessionId":"rewrite-id","requests":[{"message":{"text":"旧内容"}}]}}),
    ]);
    let inode = std::fs::metadata(&path).unwrap().ino();
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let before = service.snapshot(false, &cancel).unwrap();
    let old = service.query(query(&before, ""), &cancel).unwrap();
    std::fs::write(&path, json!({"kind":0,"v":{"sessionId":"rewrite-id","requests":[{"message":{"text":"同一个文件中重写后的更长对话内容"}}]}}).to_string()+"\n").unwrap();
    assert_eq!(std::fs::metadata(&path).unwrap().ino(), inode);
    assert_eq!(
        service
            .detail(&before.generation, &old.items[0].key, 0, 100, &cancel)
            .unwrap_err()
            .code,
        "agent_sessions:changed"
    );
    let after = service.snapshot(true, &cancel).unwrap();
    let current = service.query(query(&after, "重写后的"), &cancel).unwrap();
    assert_eq!(current.total, 1);
    let detail = service
        .detail(&after.generation, &current.items[0].key, 0, 100, &cancel)
        .unwrap();
    assert_eq!(detail.messages[0].text, "同一个文件中重写后的更长对话内容");
}

fn create_qoder_old(path: &Path) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let connection = Connection::open(path).unwrap();
    connection.execute_batch("CREATE TABLE chat_session(session_id TEXT PRIMARY KEY,session_title TEXT,project_uri TEXT,preferred_model_info TEXT,gmt_create INTEGER,gmt_modified INTEGER); CREATE TABLE chat_message(id TEXT PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,tool_result TEXT,gmt_create INTEGER)").unwrap();
    connection
        .execute(
            "INSERT INTO chat_session VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                "shared-id",
                "旧库会话",
                "/old/project",
                "{}",
                1795500000000i64,
                1795501000000i64
            ],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO chat_message VALUES(?1,?2,?3,?4,NULL,?5)",
            params![
                "old-user",
                "shared-id",
                "user",
                "opaque-ciphertext-fixture",
                1795500000000i64
            ],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO chat_message VALUES(?1,?2,?3,NULL,?4,?5)",
            params![
                "old-tool",
                "shared-id",
                "tool",
                json!({"toolCallName":"fixture-tool","content":"旧库可读工具"}).to_string(),
                1795500100000i64
            ],
        )
        .unwrap();
}

fn create_qoder_desktop(path: &Path) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let connection = Connection::open(path).unwrap();
    connection.execute_batch("CREATE TABLE chat_sessions(session_id TEXT PRIMARY KEY,title TEXT,cwd TEXT,model TEXT,created_at INTEGER,updated_at INTEGER,archived INTEGER,deleted_at INTEGER); CREATE TABLE chat_session_messages(session_id TEXT,sequence INTEGER,message_id TEXT,role TEXT,payload_json TEXT,created_at INTEGER)").unwrap();
    connection
        .execute(
            "INSERT INTO chat_sessions VALUES(?1,?2,?3,?4,?5,?6,0,NULL)",
            params![
                "shared-id",
                "新库会话",
                "/new/project",
                "recorded-model",
                1795500000000i64,
                1795501000000i64
            ],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO chat_session_messages VALUES(?1,1,?2,?3,?4,?5)",
            params![
                "shared-id",
                "new-user",
                "user",
                json!({"parts":[{"type":"text","text":"新库可读正文"}]}).to_string(),
                1795500000000i64
            ],
        )
        .unwrap();
}

#[test]
fn qoder_databases_with_same_native_id_keep_distinct_capabilities_and_resource_keys() {
    let fixture = Fixture::new();
    let old_path = fixture
        .0
        .join("Library/Application Support/Qoder/SharedClientCache/cache/db/local.db");
    let new_path = fixture
        .0
        .join("Library/Application Support/com.qodercn.app.stable/main.sqlite");
    create_qoder_old(&old_path);
    create_qoder_desktop(&new_path);
    let old_bytes = std::fs::read(&old_path).unwrap();
    let new_bytes = std::fs::read(&new_path).unwrap();
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let page = service
        .query(query(&snapshot, "shared-id"), &cancel)
        .unwrap();
    assert_eq!(page.total, 2);
    assert_ne!(page.items[0].key, page.items[1].key);
    assert!(page
        .items
        .iter()
        .all(|item| item.agent == SessionAgent::Qoder
            && item.session_id.as_deref() == Some("shared-id")));
    let legacy = service
        .query(query(&snapshot, "旧库可读工具"), &cancel)
        .unwrap();
    let modern = service
        .query(query(&snapshot, "新库可读正文"), &cancel)
        .unwrap();
    assert_eq!(
        (
            legacy.items[0].content_availability,
            modern.items[0].content_availability
        ),
        (
            SessionContentAvailability::Encrypted,
            SessionContentAvailability::Full
        )
    );
    let legacy_detail = service
        .detail(&snapshot.generation, &legacy.items[0].key, 0, 100, &cancel)
        .unwrap();
    let modern_detail = service
        .detail(&snapshot.generation, &modern.items[0].key, 0, 100, &cancel)
        .unwrap();
    assert!(legacy_detail
        .messages
        .iter()
        .any(|message| message.text.contains("旧库可读工具")));
    assert_eq!(modern_detail.messages[0].text, "新库可读正文");
    assert!(!legacy_detail
        .messages
        .iter()
        .any(|message| message.text.contains("opaque-ciphertext-fixture")));
    assert_eq!(std::fs::read(&old_path).unwrap(), old_bytes);
    assert_eq!(std::fs::read(&new_path).unwrap(), new_bytes);
    assert_eq!(
        std::fs::read_dir(old_path.parent().unwrap())
            .unwrap()
            .count(),
        1
    );
    assert_eq!(
        std::fs::read_dir(new_path.parent().unwrap())
            .unwrap()
            .count(),
        1
    );
}
