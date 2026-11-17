#![expect(
    clippy::unwrap_used,
    reason = "Session fixtures use isolated databases."
)]

use super::*;
use crate::{i18n::LanguagePreference, platform::AppPaths, preferences::AppearancePreference};
use mftp_todo::{TodoRepository, model::TodoPriority};
use std::sync::Arc;

fn fixture() -> (tempfile::TempDir, TodoDatabase) {
    let root = tempfile::tempdir().unwrap();
    let database = TodoDatabase::open(&AppPaths {
        data_dir: root.path().join("native"),
    })
    .unwrap();
    (root, database)
}

#[test]
fn preferences_and_unicode_draft_round_trip_without_a_business_write() {
    let (_root, database) = fixture();
    assert!(load(&database).unwrap().draft.is_none());
    let mut state = Session {
        preferences: Preferences::new(LanguagePreference::Chinese, AppearancePreference::Dark),
        ..Default::default()
    };
    let mut draft = Draft::new();
    draft.title = "资料 José 中文 📝".into();
    draft.notes = "第一行\n第二行".into();
    state.draft = Some(draft);
    save(&database, &state).unwrap();
    let restored = load(&database).unwrap();
    assert_eq!(restored.preferences, state.preferences);
    assert_eq!(restored.draft.unwrap().notes, "第一行\n第二行");
    assert_eq!(
        database
            .conn()
            .unwrap()
            .query_row("SELECT count(*) FROM todo_items", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn version_one_draft_gains_a_literal_document_without_replaying_or_rewriting_state() {
    let (_root, database) = fixture();
    let mut draft = Draft::new();
    draft.title = "旧草稿".into();
    draft.notes = "# 字面 **文字**\n第二行".into();
    let mut state = serde_json::to_value(Session {
        draft: Some(draft),
        ..Default::default()
    })
    .unwrap();
    state["version"] = 1.into();
    state["draft"].as_object_mut().unwrap().remove("document");
    state["draft"]
        .as_object_mut()
        .unwrap()
        .remove("original_document");
    let bytes = state.to_string();
    database
        .conn()
        .unwrap()
        .execute(
            "INSERT INTO app_meta(key,value) VALUES(?1,?2)",
            params![KEY, bytes],
        )
        .unwrap();
    let state = load(&database).unwrap();
    assert_eq!(state.version, 3);
    assert_eq!(
        state.draft.unwrap().document.unwrap().plain_text().unwrap(),
        "# 字面 **文字**\n第二行"
    );
    let retained: String = database
        .conn()
        .unwrap()
        .query_row("SELECT value FROM app_meta WHERE key=?1", [KEY], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(retained, bytes);
}

#[test]
fn invalid_state_is_rejected_without_replacing_the_payload() {
    let (_root, database) = fixture();
    let mut state = serde_json::to_value(Session::default()).unwrap();
    state["version"] = 99.into();
    let mut draft = Draft::new();
    draft.id = "invalid".into();
    let invalid_identity = Session {
        draft: Some(draft),
        ..Default::default()
    };
    let mut draft = Draft::new();
    draft.revision = Some(-1);
    let invalid_revision = Session {
        draft: Some(draft),
        ..Default::default()
    };
    for bytes in [
        "broken JSON".into(),
        state.to_string(),
        serde_json::to_string(&invalid_identity).unwrap(),
        serde_json::to_string(&invalid_revision).unwrap(),
        "x".repeat(MAX_STATE_BYTES + 1),
    ] {
        database.conn().unwrap().execute("INSERT INTO app_meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![KEY, bytes]).unwrap();
        assert_eq!(load(&database).unwrap_err().code, "native:state_invalid");
        let retained: String = database
            .conn()
            .unwrap()
            .query_row("SELECT value FROM app_meta WHERE key=?1", [KEY], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(retained, bytes);
    }
}

#[test]
fn oversized_save_keeps_the_previously_stored_draft() {
    let (_root, database) = fixture();
    let mut draft = Draft::new();
    draft.title = "Retained".into();
    let mut state = Session {
        draft: Some(draft),
        ..Default::default()
    };
    save(&database, &state).unwrap();
    state.draft.as_mut().unwrap().notes = "x".repeat(MAX_STATE_BYTES);
    assert_eq!(
        save(&database, &state).unwrap_err().code,
        "native:state_invalid"
    );
    assert_eq!(load(&database).unwrap().draft.unwrap().title, "Retained");
}

#[test]
fn editing_plain_fields_retains_the_original_optional_metadata() {
    let (_root, database) = fixture();
    let repo = TodoRepository::new(Arc::new(database));
    let input = TodoItemInput {
        title: "Original".into(),
        notes: Some("note".into()),
        category: Some("work".into()),
        due_date: Some("2026-11-17".into()),
        due_at: None,
        priority: Some(TodoPriority::High),
        completed: true,
    };
    let item = repo.create(input).unwrap();
    let mut draft = Draft::edit(&repo.get(&item.id).unwrap());
    assert!(!draft.is_dirty());
    draft.title = "Edited".into();
    assert!(draft.is_dirty());
    let input = draft.input();
    assert_eq!(input.category.as_deref(), Some("work"));
    assert_eq!(input.due_date.as_deref(), Some("2026-11-17"));
    assert_eq!(input.priority, Some(TodoPriority::High));
    assert!(input.completed);
}
