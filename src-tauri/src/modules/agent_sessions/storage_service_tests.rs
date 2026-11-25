use std::sync::atomic::AtomicBool;

use serde_json::json;

use super::model::*;
use super::tests::Fixture;
use super::AgentSessionService;

fn query(generation: &str) -> AgentSessionQuery {
    AgentSessionQuery {
        generation: generation.to_owned(),
        agent: None,
        archived: None,
        search: String::new(),
        from: None,
        to: None,
        sort: SessionSort::Size,
        min_bytes: None,
        offset: 0,
        limit: 1,
    }
}

#[test]
fn size_sort_is_applied_before_pagination() {
    let fixture = Fixture::new();
    fixture.write(
        ".claude/projects/project/large.jsonl",
        &[json!({"type":"user","sessionId":"large","message":{"content":"x".repeat(4096)}})],
    );
    fixture.write(
        ".claude/projects/project/small.jsonl",
        &[json!({"type":"user","sessionId":"small","message":{"content":"small"}})],
    );
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let mut input = query(&snapshot.generation);
    let first = service.query(input.clone(), &cancel).unwrap();
    input.offset = 1;
    let second = service.query(input, &cancel).unwrap();
    assert_eq!(
        (
            first.items[0].session_id.as_deref(),
            second.items[0].session_id.as_deref(),
            first.total,
            first.next_offset,
        ),
        (Some("large"), Some("small"), 2, Some(1))
    );
}

#[test]
fn minimum_size_filters_by_real_session_file_bytes() {
    let fixture = Fixture::new();
    fixture.write(
        ".claude/projects/project/large.jsonl",
        &[json!({"type":"user","sessionId":"large","message":{"content":"x".repeat(4096)}})],
    );
    fixture.write(
        ".claude/projects/project/small.jsonl",
        &[json!({"type":"user","sessionId":"small","message":{"content":"small"}})],
    );
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let mut input = query(&snapshot.generation);
    input.min_bytes = Some(1024.0);
    let page = service.query(input, &cancel).unwrap();
    assert_eq!(
        (page.total, page.items[0].session_id.as_deref()),
        (1, Some("large"))
    );
}

#[test]
fn storage_rejects_an_old_generation() {
    let fixture = Fixture::new();
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let old = service.snapshot(false, &cancel).unwrap();
    service.snapshot(true, &cancel).unwrap();
    let error = service.storage(&old.generation, &cancel).unwrap_err();
    assert_eq!(error.code, "agent_sessions:changed");
}

#[test]
fn metadata_only_files_contribute_to_usage_without_appearing_in_the_reading_list() {
    let fixture = Fixture::new();
    let empty = fixture.write(
        ".codex/sessions/rollout-empty.jsonl",
        &[json!({"type":"session_meta","payload":{"id":"empty","cwd":"/project"}})],
    );
    let visible = fixture.write(
        ".codex/sessions/rollout-visible.jsonl",
        &[
            json!({"type":"session_meta","payload":{"id":"visible","cwd":"/project"}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"visible"}]}}),
        ],
    );
    let service = AgentSessionService::new(fixture.0.clone());
    let cancel = AtomicBool::new(false);
    let snapshot = service.snapshot(false, &cancel).unwrap();
    let storage = service.storage(&snapshot.generation, &cancel).unwrap();
    let total = std::fs::metadata(empty).unwrap().len() + std::fs::metadata(visible).unwrap().len();
    let codex = storage
        .sources
        .iter()
        .find(|item| item.agent == SessionAgent::Codex)
        .unwrap();
    assert_eq!(
        (snapshot.total, storage.items.len(), codex.bytes),
        (1, 2, total as f64)
    );
}
