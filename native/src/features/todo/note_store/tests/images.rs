use super::*;
use crate::resources::images::ImageInput;
use std::{io::Cursor, sync::atomic::AtomicBool};

pub(super) fn import(database: &TodoDatabase, draft: &Draft) -> String {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        8,
        8,
        image::Rgba([30, 80, 140, 255]),
    ))
    .write_to(&mut bytes, image::ImageFormat::Png)
    .unwrap();
    let clipboard = gpui_kit::ClipboardItem::new_image(&gpui_kit::Image::from_bytes(
        gpui_kit::ImageFormat::Png,
        bytes.into_inner(),
    ));
    let input = ImageInput::from_clipboard(&clipboard).unwrap().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    super::super::super::note_images::import(
        database,
        &draft.id,
        &id,
        &input,
        &AtomicBool::new(false),
    )
    .unwrap();
    id
}

fn image_document(id: &str) -> RichTextDocument {
    RichTextDocument::from_markdown(format!("正文 ![图片](mftp-image:{id})"))
}

#[test]
fn resource_ownership_failure_rolls_back_entire_creation_and_retry_can_commit() {
    let (_root, database, repository) = fixture();
    let mut draft = Draft::new();
    draft.title = "原子提交".into();
    let id = import(&database, &draft);
    draft.document = Some(image_document(&id));
    database.conn().unwrap().execute_batch("CREATE TRIGGER reject_image BEFORE UPDATE OF item_id ON native_note_images BEGIN SELECT RAISE(ABORT,'isolated image failure'); END;").unwrap();
    assert!(commit(&database, &draft).is_err());
    assert_eq!(
        repository.get(&draft.id).unwrap_err().code,
        "todo:item_not_found"
    );
    let owner: String = database
        .conn()
        .unwrap()
        .query_row(
            "SELECT draft_id FROM native_note_images WHERE id=?1",
            [&id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(owner, draft.id);
    database
        .conn()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_image")
        .unwrap();
    let item = commit(&database, &draft).unwrap();
    repository.delete_at_revision(&item.id, Some(0)).unwrap();
    assert_eq!(
        database
            .conn()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM native_note_images", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn foreign_resource_is_never_attached_and_missing_resource_keeps_draft() {
    let (_root, database, repository) = fixture();
    let owner = Draft::new();
    let id = import(&database, &owner);
    let mut other = Draft::new();
    other.title = "不能借用".into();
    other.document = Some(image_document(&id));
    assert_eq!(
        commit(&database, &other).unwrap_err().code,
        "todo:note_image_missing"
    );
    assert_eq!(
        repository.get(&other.id).unwrap_err().code,
        "todo:item_not_found"
    );
    assert_eq!(
        super::super::super::note_images::load(&database, &other).unwrap()[0].1,
        None
    );
}
