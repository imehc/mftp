use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::database;
use super::model::{AgentSessionMessage, SessionAgent, SessionContentAvailability, SessionRole};

const CREATED: i64 = 1_790_000_000_000;
const UPDATED: i64 = CREATED + 10_000;

fn opencode() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("CREATE TABLE session_v2(id TEXT PRIMARY KEY,title TEXT,directory TEXT,model TEXT,time_created INTEGER,time_updated INTEGER,time_archived INTEGER); CREATE TABLE session_message(id TEXT,session_id TEXT,type TEXT,seq INTEGER,data TEXT,time_created INTEGER)").unwrap();
    connection
        .execute(
            "INSERT INTO session_v2 VALUES(?1,'Native session','/fixture/project',?2,?3,?4,NULL)",
            params![
                "native-id",
                json!({"id":"session-model"}).to_string(),
                CREATED,
                UPDATED
            ],
        )
        .unwrap();
    connection
}

fn opencode_message(connection: &Connection, sequence: i64, role: &str, value: Value) {
    connection
        .execute(
            "INSERT INTO session_message VALUES(?1,'native-id',?2,?3,?4,?5)",
            params![
                format!("message-{sequence}"),
                role,
                sequence,
                value.to_string(),
                CREATED - 1_000 + sequence
            ],
        )
        .unwrap();
}

fn read(
    connection: &Connection,
    agent: SessionAgent,
    id: &str,
) -> (super::transcript::Transcript, Vec<AgentSessionMessage>) {
    let mut messages = Vec::new();
    let result = database::visit(
        connection,
        agent,
        id,
        &AtomicBool::new(false),
        |message, _| {
            messages.push(message);
            Ok(())
        },
    )
    .unwrap();
    (result, messages)
}

fn qoder_desktop() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("CREATE TABLE chat_sessions(session_id TEXT PRIMARY KEY,title TEXT,cwd TEXT,model TEXT,created_at INTEGER,updated_at INTEGER,archived INTEGER,deleted_at INTEGER); CREATE TABLE chat_session_messages(session_id TEXT,message_id TEXT,sequence INTEGER,role TEXT,payload_json TEXT,created_at INTEGER)").unwrap();
    connection.execute("INSERT INTO chat_sessions VALUES('desktop-id','Plaintext session','/fixture/project','recorded-model',?1,?2,1,NULL)", params![CREATED, UPDATED]).unwrap();
    connection
}

fn desktop_message(connection: &Connection, sequence: i64, role: &str, value: Value) {
    connection
        .execute(
            "INSERT INTO chat_session_messages VALUES('desktop-id',?1,?2,?3,?4,?5)",
            params![
                format!("message-{sequence}"),
                sequence,
                role,
                value.to_string(),
                CREATED - 1_000 + sequence
            ],
        )
        .unwrap();
}

#[test]
fn opencode_preserves_native_id_record_model_and_dialogue_count_across_parts() {
    let connection = opencode();
    opencode_message(
        &connection,
        2,
        "assistant",
        json!({"model":{"id":"response-model"},"content":[{"type":"text","text":"First answer"},{"type":"reasoning","text":"Reasoning"},{"type":"text","text":"Second answer"},{"type":"tool","name":"read","state":{"input":{"file":"fixture"},"content":[{"type":"text","text":"Readable result"}]}}]}),
    );
    opencode_message(&connection, 1, "user", json!({"text":"A question"}));
    let (result, messages) = read(&connection, SessionAgent::Opencode, "native-id");
    assert_eq!(
        (
            result.id.as_deref(),
            result.count,
            result.total,
            result.created,
            result.updated,
            messages[0].role,
            messages[1].model.as_deref()
        ),
        (
            Some("native-id"),
            2,
            5,
            Some(CREATED as f64),
            Some(UPDATED as f64),
            SessionRole::User,
            Some("response-model")
        )
    );
}

#[test]
fn opencode_uses_only_explicit_archive_and_skips_empty_sessions() {
    let connection = opencode();
    connection
        .execute(
            "UPDATE session_v2 SET time_archived=?1 WHERE id='native-id'",
            [UPDATED],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO session_v2 VALUES('empty','Empty','/fixture/empty',NULL,?1,?1,NULL)",
            [CREATED],
        )
        .unwrap();
    opencode_message(&connection, 1, "user", json!({"text":"Archived question"}));
    let ids =
        database::sessions(&connection, SessionAgent::Opencode, &AtomicBool::new(false)).unwrap();
    let (result, _) = read(&connection, SessionAgent::Opencode, "native-id");
    assert_eq!((ids, result.archived), (vec!["native-id".to_owned()], true));
}

#[test]
fn opencode_tool_retains_actual_content_blocks_and_structured_error() {
    let connection = opencode();
    opencode_message(
        &connection,
        1,
        "assistant",
        json!({"model":{"id":"response-model"},"content":[{"type":"tool","name":"read","state":{"status":"completed","input":{"file":"fixture"},"content":[{"type":"text","text":"Readable tool result"}]}},{"type":"tool","name":"write","state":{"status":"failed","input":{"file":"fixture"},"error":{"type":"ToolError","message":"Actual tool failure"}}}]}),
    );
    let (result, messages) = read(&connection, SessionAgent::Opencode, "native-id");
    assert_eq!(
        (
            result.count,
            messages.len(),
            messages[0].text.contains("Readable tool result"),
            messages[1].text.contains("Actual tool failure")
        ),
        (1, 2, true, true)
    );
}

#[test]
fn opencode_does_not_count_injected_notifications_as_user_dialogue() {
    let connection = opencode();
    opencode_message(
        &connection,
        1,
        "user",
        json!({"text":"<task-notification>Background completed</task-notification>"}),
    );
    opencode_message(&connection, 2, "user", json!({"text":"Actual question"}));
    let (result, messages) = read(&connection, SessionAgent::Opencode, "native-id");
    assert_eq!(
        (result.count, messages[0].role, messages[1].role),
        (1, SessionRole::System, SessionRole::User)
    );
}

#[test]
fn database_rejects_oversized_native_ids_before_returning_index_identity() {
    let connection = opencode();
    let id = "i".repeat(1024);
    connection
        .execute(
            "INSERT INTO session_v2 VALUES(?1,'Oversized identity','/fixture',NULL,?2,?2,NULL)",
            params![id, CREATED],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO session_message VALUES('message',?1,'user',1,?2,?3)",
            params![id, json!({"text":"Question"}).to_string(), CREATED],
        )
        .unwrap();
    let result = database::sessions(&connection, SessionAgent::Opencode, &AtomicBool::new(false));
    assert_eq!(result.err().unwrap().code, "agent_sessions:partial");
}

#[test]
fn opencode_splits_long_text_without_truncating_or_inflating_dialogue_count() {
    let connection = opencode();
    let raw = "中文正文".repeat(20_000);
    opencode_message(&connection, 1, "user", json!({"text":raw}));
    let (result, messages) = read(&connection, SessionAgent::Opencode, "native-id");
    let joined = messages
        .iter()
        .map(|message| message.text.as_str())
        .collect::<String>();
    assert_eq!(
        (
            result.count,
            messages.len(),
            messages[1].continuation,
            joined
        ),
        (1, 3, true, raw)
    );
}

#[test]
fn opencode_image_files_expose_only_local_or_inline_references() {
    let connection = opencode();
    opencode_message(
        &connection,
        1,
        "user",
        json!({"files":[{"mime":"image/png","filename":"fixture.png","url":"data:image/png;base64,aW1hZ2U="},{"mime":"image/png","url":"https://example.invalid/image.png"}]}),
    );
    let mut native_count = 0;
    let result = database::visit(
        &connection,
        SessionAgent::Opencode,
        "native-id",
        &AtomicBool::new(false),
        |_, images| {
            native_count += images.len();
            Ok(())
        },
    )
    .unwrap();
    assert_eq!((result.count, native_count), (1, 1));
}

#[test]
fn database_marks_malformed_record_partial_and_retains_later_readable_messages() {
    let connection = opencode();
    connection
        .execute(
            "INSERT INTO session_message VALUES('broken','native-id','user',1,'{bad',?1)",
            [CREATED],
        )
        .unwrap();
    opencode_message(&connection, 2, "user", json!({"text":"Still readable"}));
    let (result, messages) = read(&connection, SessionAgent::Opencode, "native-id");
    assert_eq!(
        (result.complete, messages.len(), messages[0].text.as_str()),
        (false, 1, "Still readable")
    );
}

#[test]
fn database_unknown_content_parts_are_reported_partial_without_dropping_known_text() {
    let connection = opencode();
    opencode_message(
        &connection,
        1,
        "assistant",
        json!({"content":[{"type":"future-format","text":"Unknown part"},{"type":"text","text":"Known answer"}]}),
    );
    let (result, messages) = read(&connection, SessionAgent::Opencode, "native-id");
    assert_eq!(
        (result.complete, messages[0].text.as_str()),
        (false, "Known answer")
    );
}

#[test]
fn database_bounds_json_tree_growth_before_decoding_tiny_scalar_arrays() {
    let connection = opencode();
    let raw = format!("{{\"content\":[{}0]}}", "0,".repeat(600_000));
    connection
        .execute(
            "INSERT INTO session_message VALUES('large','native-id','assistant',1,?1,?2)",
            params![raw, CREATED],
        )
        .unwrap();
    let result = database::visit(
        &connection,
        SessionAgent::Opencode,
        "native-id",
        &AtomicBool::new(false),
        |_, _| Ok(()),
    );
    assert_eq!(result.err().unwrap().code, "agent_sessions:limit");
}

#[test]
fn database_cancel_stops_reading_after_callback_without_returning_partial_success() {
    let connection = opencode();
    for sequence in 1..=3 {
        opencode_message(&connection, sequence, "user", json!({"text":"Message"}));
    }
    let cancel = AtomicBool::new(false);
    let mut calls = 0;
    let result = database::visit(
        &connection,
        SessionAgent::Opencode,
        "native-id",
        &cancel,
        |_, _| {
            calls += 1;
            cancel.store(true, Ordering::Release);
            Ok(())
        },
    );
    assert_eq!(
        (result.err().unwrap().code.as_str(), calls),
        ("agent_sessions:cancelled", 1)
    );
}

#[test]
fn database_native_id_is_parameterized_and_missing_is_not_an_empty_transcript() {
    let connection = opencode();
    let result = database::visit(
        &connection,
        SessionAgent::Opencode,
        "' OR 1=1 --",
        &AtomicBool::new(false),
        |_, _| Ok(()),
    );
    assert_eq!(result.err().unwrap().code, "agent_sessions:missing");
}

#[test]
fn qoder_desktop_keeps_plaintext_parts_roles_and_explicit_archiving() {
    let connection = qoder_desktop();
    desktop_message(
        &connection,
        1,
        "user",
        json!({"parts":[{"type":"text","text":"Question"}]}),
    );
    desktop_message(
        &connection,
        2,
        "assistant",
        json!({"parts":[{"type":"thinking","text":"Thought"},{"type":"text","text":"Answer one"},{"type":"tool","tool":{"name":"read","input":{"file":"fixture"},"response":"Tool result"}},{"type":"text","text":"Answer two"}]}),
    );
    desktop_message(
        &connection,
        3,
        "system",
        json!({"parts":[{"type":"hook","hook":{"status":"done"}},{"type":"contextCompression","id":"compression-id","status":"completed"}]}),
    );
    let (result, messages) = read(&connection, SessionAgent::Qoder, "desktop-id");
    let roles = messages
        .iter()
        .map(|message| message.role)
        .collect::<Vec<_>>();
    assert_eq!(
        (
            result.content_availability,
            result.count,
            result.total,
            result.archived,
            result.created,
            result.updated,
            roles
        ),
        (
            SessionContentAvailability::Full,
            2,
            7,
            true,
            Some(CREATED as f64),
            Some(UPDATED as f64),
            vec![
                SessionRole::User,
                SessionRole::Thinking,
                SessionRole::Assistant,
                SessionRole::Tool,
                SessionRole::Assistant,
                SessionRole::System,
                SessionRole::System
            ]
        )
    );
}

#[test]
fn qoder_desktop_does_not_count_notification_parts_as_user_dialogue() {
    let connection = qoder_desktop();
    desktop_message(
        &connection,
        1,
        "user",
        json!({"parts":[{"type":"text","text":"<buddy-notification>System notice</buddy-notification>"}]}),
    );
    let (result, messages) = read(&connection, SessionAgent::Qoder, "desktop-id");
    assert_eq!((result.count, messages[0].role), (0, SessionRole::System));
}

#[test]
fn qoder_desktop_keeps_session_model_without_inventing_historical_message_models() {
    let connection = qoder_desktop();
    desktop_message(
        &connection,
        1,
        "assistant",
        json!({"parts":[{"type":"text","text":"Answer"}]}),
    );
    let (result, messages) = read(&connection, SessionAgent::Qoder, "desktop-id");
    assert_eq!(
        (result.model.as_deref(), messages[0].model.as_deref()),
        (Some("recorded-model"), None)
    );
}

#[test]
fn qoder_desktop_unknown_parts_are_reported_partial() {
    let connection = qoder_desktop();
    desktop_message(
        &connection,
        1,
        "assistant",
        json!({"parts":[{"type":"future-format","text":"Unknown part"},{"type":"text","text":"Known answer"}]}),
    );
    let (result, messages) = read(&connection, SessionAgent::Qoder, "desktop-id");
    assert_eq!(
        (result.complete, messages[0].text.as_str()),
        (false, "Known answer")
    );
}

#[test]
fn qoder_desktop_returns_image_references_for_image_only_messages() {
    let connection = qoder_desktop();
    desktop_message(
        &connection,
        1,
        "user",
        json!({"parts":[{"type":"image","id":"image-part"}],"attachments":[{"kind":"image","name":"fixture.png","mimeType":"image/png","previewDataUrl":"data:image/png;base64,aW1hZ2U="}]}),
    );
    let mut sources = 0;
    let mut names = Vec::new();
    let result = database::visit(
        &connection,
        SessionAgent::Qoder,
        "desktop-id",
        &AtomicBool::new(false),
        |message, native| {
            sources += native.len();
            names.extend(message.images.into_iter().map(|image| image.name));
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(
        (result.count, sources, names),
        (1, 1, vec!["fixture.png".to_owned()])
    );
}

#[test]
fn qoder_desktop_deleted_session_is_excluded_instead_of_guessed_archived() {
    let connection = qoder_desktop();
    desktop_message(
        &connection,
        1,
        "user",
        json!({"parts":[{"type":"text","text":"Question"}]}),
    );
    connection
        .execute("UPDATE chat_sessions SET deleted_at=?1", [UPDATED])
        .unwrap();
    let ids =
        database::sessions(&connection, SessionAgent::Qoder, &AtomicBool::new(false)).unwrap();
    let result = database::visit(
        &connection,
        SessionAgent::Qoder,
        "desktop-id",
        &AtomicBool::new(false),
        |_, _| Ok(()),
    );
    assert_eq!(
        (ids.len(), result.err().unwrap().code.as_str()),
        (0, "agent_sessions:missing")
    );
}

#[test]
fn qoder_legacy_excludes_ciphertext_and_preserves_tools_and_memory_as_their_roles() {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("CREATE TABLE chat_session(session_id TEXT,session_title TEXT,project_uri TEXT,preferred_model_info TEXT,gmt_create INTEGER,gmt_modified INTEGER,status TEXT); CREATE TABLE chat_message(id TEXT,session_id TEXT,role TEXT,content TEXT,tool_result TEXT,gmt_create INTEGER); CREATE TABLE agent_memory(id TEXT,session_id TEXT,title TEXT,content TEXT,status TEXT,gmt_create INTEGER)").unwrap();
    connection.execute("INSERT INTO chat_session VALUES('legacy-id','Encrypted session','/fixture/project',?1,?2,?3,'unknown-archive-like-status')", params![json!({"model":"legacy-model"}).to_string(), CREATED, UPDATED]).unwrap();
    for (index, role) in ["user", "assistant"].into_iter().enumerate() {
        connection.execute("INSERT INTO chat_message VALUES(?1,'legacy-id',?2,'ciphertext-must-never-appear','',?3)", params![index.to_string(), role, CREATED]).unwrap();
    }
    connection.execute("INSERT INTO chat_message VALUES('tool','legacy-id','tool','',?1,?2)", params![json!({"toolCallName":"read","parameters":{"path":"fixture"},"content":"Readable tool"}).to_string(), CREATED]).unwrap();
    connection.execute("INSERT INTO agent_memory VALUES('memory','legacy-id','Memory title','Readable memory','active',?1)", [CREATED - 100]).unwrap();
    let (result, messages) = read(&connection, SessionAgent::Qoder, "legacy-id");
    let ciphertext_returned = messages
        .iter()
        .any(|message| message.text.contains("ciphertext-must-never-appear"));
    assert_eq!(
        (
            result.content_availability,
            result.count,
            result.archived,
            result.created,
            ciphertext_returned,
            messages
                .iter()
                .map(|message| message.role)
                .collect::<Vec<_>>()
        ),
        (
            SessionContentAvailability::Encrypted,
            2,
            false,
            Some(CREATED as f64),
            false,
            vec![SessionRole::Tool, SessionRole::System]
        )
    );
}

#[test]
fn qoder_unknown_schema_reports_format_instead_of_claiming_no_data() {
    let connection = Connection::open_in_memory().unwrap();
    let result = database::sessions(&connection, SessionAgent::Qoder, &AtomicBool::new(false));
    assert_eq!(result.err().unwrap().code, "agent_sessions:format");
}
