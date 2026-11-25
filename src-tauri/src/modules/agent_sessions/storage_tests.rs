use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use super::*;
use crate::modules::agent_sessions::discovery::Candidate;
use crate::modules::agent_sessions::model::{AgentSessionSummary, SessionContentAvailability};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("mftp-agent-storage-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }

    fn resource(&self, agent: SessionAgent, key: &str, filename: &str) -> StorageResource {
        let path = self.0.join(filename);
        StorageResource {
            summary: AgentSessionSummary {
                key: key.into(),
                agent,
                session_id: Some(key.into()),
                title: "Fixture".into(),
                preview: String::new(),
                cwd: String::new(),
                path: path.to_string_lossy().into_owned(),
                updated_at: 0.0,
                created_at: None,
                message_count: 1,
                revision: String::new(),
                match_index: None,
                model: None,
                archived: false,
                content_availability: SessionContentAvailability::Full,
            },
            resource: Candidate {
                agent,
                path,
                id: Some(key.into()),
                archived: false,
                codebuddy: None,
            },
            complete: true,
        }
    }

    fn source(&self, agent: SessionAgent) -> Vec<SessionSource> {
        vec![SessionSource {
            agent,
            root: self.0.to_string_lossy().into_owned(),
            available: true,
            count: 2,
        }]
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn sqlite_sessions_have_unknown_sizes_and_source_files_are_counted_once() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("sessions.sqlite"), [0_u8; 64]).unwrap();
    fs::write(fixture.0.join("sessions.sqlite-wal"), [0_u8; 16]).unwrap();
    let resources = [
        fixture.resource(SessionAgent::Opencode, "one", "sessions.sqlite"),
        fixture.resource(SessionAgent::Opencode, "two", "sessions.sqlite"),
    ];
    let result = snapshot(
        "generation",
        &fixture.source(SessionAgent::Opencode),
        &resources,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(
        (
            result.sources[0].bytes,
            result
                .items
                .iter()
                .map(|item| item.bytes)
                .collect::<Vec<_>>()
        ),
        (80.0, vec![None, None])
    );
}

#[test]
fn hard_linked_records_do_not_double_the_source_total() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("one.jsonl"), [0_u8; 23]).unwrap();
    fs::hard_link(fixture.0.join("one.jsonl"), fixture.0.join("two.jsonl")).unwrap();
    let resources = [
        fixture.resource(SessionAgent::Codex, "one", "one.jsonl"),
        fixture.resource(SessionAgent::Codex, "two", "two.jsonl"),
    ];
    let result = snapshot(
        "generation",
        &fixture.source(SessionAgent::Codex),
        &resources,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(result.sources[0].bytes, 23.0);
}

#[test]
fn codebuddy_index_and_referenced_messages_are_measured_together() {
    let fixture = Fixture::new();
    let index = br#"{"messages":["one","two"]}"#;
    fs::write(fixture.0.join("session.json"), index).unwrap();
    fs::create_dir_all(fixture.0.join("messages")).unwrap();
    fs::write(fixture.0.join("messages/one.json"), [0_u8; 23]).unwrap();
    fs::write(fixture.0.join("messages/two.json"), [0_u8; 17]).unwrap();
    let result = snapshot(
        "generation",
        &fixture.source(SessionAgent::Codebuddy),
        &[fixture.resource(SessionAgent::Codebuddy, "session", "session.json")],
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(
        (result.items[0].bytes, result.complete),
        (Some((index.len() + 40) as f64), true)
    );
}

#[test]
fn storage_does_not_follow_a_symbolic_record_link() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("original.jsonl"), [0_u8; 23]).unwrap();
    std::os::unix::fs::symlink(
        fixture.0.join("original.jsonl"),
        fixture.0.join("link.jsonl"),
    )
    .unwrap();
    let resource = fixture.resource(SessionAgent::Codex, "one", "link.jsonl");
    let result = snapshot(
        "generation",
        &fixture.source(SessionAgent::Codex),
        &[resource],
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(
        (
            result.sources[0].bytes,
            result.complete,
            result.items[0].bytes
        ),
        (0.0, false, None)
    );
}

#[test]
fn missing_records_are_reported_as_incomplete_and_unknown() {
    let fixture = Fixture::new();
    let resource = fixture.resource(SessionAgent::Claude, "one", "missing.jsonl");
    let result = snapshot(
        "generation",
        &fixture.source(SessionAgent::Claude),
        &[resource],
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!((result.complete, result.items[0].bytes), (false, None));
}

#[test]
fn cancelled_storage_scan_returns_a_structured_cancellation() {
    let fixture = Fixture::new();
    let resource = fixture.resource(SessionAgent::Claude, "one", "session.jsonl");
    let result = snapshot(
        "generation",
        &fixture.source(SessionAgent::Claude),
        &[resource],
        &AtomicBool::new(true),
    );
    assert_eq!(result.unwrap_err().code, "agent_sessions:cancelled");
}
