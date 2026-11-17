#![expect(
    clippy::unwrap_used,
    reason = "Repository tests use isolated databases."
)]

use super::*;
use crate::platform::AppPaths;
use mftp_todo::TodoRepository;
use std::sync::Arc;
mod images;
mod transfers;

fn fixture() -> (tempfile::TempDir, TodoDatabase, TodoRepository) {
    let root = tempfile::tempdir().unwrap();
    let database = TodoDatabase::open(&AppPaths {
        data_dir: root.path().join("native"),
    })
    .unwrap();
    let repository = TodoRepository::new(Arc::new(database.clone()));
    (root, database, repository)
}

#[test]
fn formatted_document_and_summary_reopen_at_the_same_revision() {
    let (_root, database, repository) = fixture();
    let mut draft = Draft::new();
    draft.title = "格式持久化".into();
    draft.document = Some(RichTextDocument::from_markdown("**重点**\n\n- 项目"));
    let item = commit(&database, &draft).unwrap();
    let record = repository.get(&item.id).unwrap();
    let document = load(&database, &item.id, record.item().notes.as_deref()).unwrap();
    assert_eq!(document, draft.document.unwrap());
    assert_eq!(record.item().notes.as_deref(), Some("重点\n项目"));
    assert_eq!(record.revision(), 0);
}

#[test]
fn document_failure_rolls_back_metadata_and_creation() {
    let (_root, database, repository) = fixture();
    database.conn().unwrap().execute_batch("CREATE TRIGGER reject_document BEFORE INSERT ON native_rich_text_notes BEGIN SELECT RAISE(ABORT,'isolated failure'); END;").unwrap();
    let mut draft = Draft::new();
    draft.title = "不会部分创建".into();
    draft.document = Some(RichTextDocument::from_markdown("**保留**"));
    assert!(commit(&database, &draft).is_err());
    assert_eq!(
        repository.get(&draft.id).unwrap_err().code,
        "todo:item_not_found"
    );
    assert!(draft.document.unwrap().source().contains("**"));
}

#[test]
fn stale_revision_never_overwrites_document_or_metadata() {
    let (_root, database, repository) = fixture();
    let mut draft = Draft::new();
    draft.title = "初稿".into();
    draft.document = Some(RichTextDocument::from_markdown("**初稿**"));
    let item = commit(&database, &draft).unwrap();
    let record = repository.get(&item.id).unwrap();
    let mut edit = Draft::edit(&record);
    edit.document = Some(RichTextDocument::from_markdown("*新版*"));
    edit.title = "新版".into();
    commit(&database, &edit).unwrap();
    let mut stale = Draft::edit(&record);
    stale.title = "过期".into();
    stale.document = Some(RichTextDocument::from_markdown("过期内容"));
    assert_eq!(
        commit(&database, &stale).unwrap_err().code,
        "todo:note_conflict"
    );
    assert_eq!(repository.get(&item.id).unwrap().item().title, "新版");
    assert_eq!(load(&database, &item.id, None).unwrap().source(), "*新版*");
}

#[test]
fn missing_document_imports_literal_notes_but_read_errors_do_not_fallback() {
    let (_root, database, _) = fixture();
    let plain = "# 字面 **文字**";
    assert_eq!(
        load(&database, "unused", Some(plain))
            .unwrap()
            .plain_text()
            .unwrap(),
        plain
    );
    database
        .conn()
        .unwrap()
        .execute_batch("ALTER TABLE native_rich_text_notes RENAME TO isolated_notes")
        .unwrap();
    assert!(load(&database, "unused", Some(plain)).is_err());
}

#[test]
fn failed_document_update_rolls_back_existing_title_summary_and_revision() {
    let (_root, database, repository) = fixture();
    let mut draft = Draft::new();
    draft.title = "原有标题".into();
    draft.document = Some(RichTextDocument::from_markdown("**原有备注**"));
    let item = commit(&database, &draft).unwrap();
    let record = repository.get(&item.id).unwrap();
    database.conn().unwrap().execute_batch("CREATE TRIGGER reject_update BEFORE UPDATE ON native_rich_text_notes BEGIN SELECT RAISE(ABORT,'isolated update failure'); END;").unwrap();
    let mut edit = Draft::edit(&record);
    edit.title = "不会部分更新".into();
    edit.document = Some(RichTextDocument::from_markdown("*新备注*"));
    assert!(commit(&database, &edit).is_err());
    let record = repository.get(&item.id).unwrap();
    assert_eq!(
        (
            record.item().title.as_str(),
            record.item().notes.as_deref(),
            record.revision()
        ),
        ("原有标题", Some("原有备注"), 0)
    );
    assert_eq!(
        load(&database, &item.id, None).unwrap().source(),
        "**原有备注**"
    );
}

#[test]
fn reading_a_newer_document_with_an_old_metadata_revision_is_rejected() {
    let (_root, database, repository) = fixture();
    let mut draft = Draft::new();
    draft.title = "一致读取".into();
    let item = commit(&database, &draft).unwrap();
    let mut edit = Draft::edit(&repository.get(&item.id).unwrap());
    edit.document = Some(RichTextDocument::from_markdown("新版"));
    commit(&database, &edit).unwrap();
    assert_eq!(
        load_at_revision(&database, &item.id, 0, None)
            .unwrap_err()
            .code,
        "todo:note_conflict"
    );
}
