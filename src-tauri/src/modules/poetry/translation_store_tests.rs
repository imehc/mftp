use std::fs;

use crate::storage::Storage;

use super::*;

fn test_storage() -> (Storage, std::path::PathBuf) {
    let root = std::env::temp_dir().join(format!(
        "mftp-poetry-translation-store-{}",
        uuid::Uuid::new_v4()
    ));
    (Storage::new(root.clone()).unwrap(), root)
}

#[test]
fn translations_are_isolated_by_uid_and_fingerprint() {
    let (storage, root) = test_storage();
    let fingerprint = "a".repeat(64);
    upsert(
        &storage,
        "uid-a",
        &fingerprint,
        "zh-CN",
        PoetryTranslationMode::Literal,
        1,
        "译文甲",
        "model",
    )
    .unwrap();
    assert_eq!(
        list(&storage, "uid-b", &fingerprint, "zh-CN", 1)
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        list(&storage, "uid-a", &"b".repeat(64), "zh-CN", 1)
            .unwrap()
            .len(),
        0
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn repeated_generation_updates_one_record_and_user_edits_are_marked() {
    let (storage, root) = test_storage();
    let fingerprint = "c".repeat(64);
    for content in ["第一版", "第二版"] {
        upsert(
            &storage,
            "uid",
            &fingerprint,
            "zh-CN",
            PoetryTranslationMode::Literary,
            1,
            content,
            "model",
        )
        .unwrap();
    }
    let translations = list(&storage, "uid", &fingerprint, "zh-CN", 1).unwrap();
    assert_eq!(translations.len(), 1);
    assert_eq!(translations[0].content, "第二版");

    let edited = update(
        &storage,
        "uid",
        &fingerprint,
        "zh-CN",
        PoetryTranslationMode::Literary,
        1,
        "人工修订",
    )
    .unwrap();
    assert_eq!(edited.source, PoetryTranslationSource::User);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn user_edited_rows_survive_regenerated_content() {
    let (storage, root) = test_storage();
    let fingerprint = "d".repeat(64);
    upsert(
        &storage,
        "uid",
        &fingerprint,
        "zh-CN",
        PoetryTranslationMode::Literal,
        1,
        "初版",
        "model",
    )
    .unwrap();
    update(
        &storage,
        "uid",
        &fingerprint,
        "zh-CN",
        PoetryTranslationMode::Literal,
        1,
        "用户修订",
    )
    .unwrap();
    // Regeneration (upsert) overwrites content and marks the row as AI again.
    let regenerated = upsert(
        &storage,
        "uid",
        &fingerprint,
        "zh-CN",
        PoetryTranslationMode::Literal,
        1,
        "再生成",
        "model",
    )
    .unwrap();
    assert_eq!(regenerated.content, "再生成");
    assert_eq!(regenerated.source, PoetryTranslationSource::Ai);
    assert_eq!(
        list(&storage, "uid", &fingerprint, "zh-CN", 1)
            .unwrap()
            .len(),
        1
    );
    assert!(delete(
        &storage,
        "uid",
        &fingerprint,
        "zh-CN",
        PoetryTranslationMode::Literal,
        1,
    )
    .unwrap());
    assert!(!delete(
        &storage,
        "uid",
        &fingerprint,
        "zh-CN",
        PoetryTranslationMode::Literal,
        1,
    )
    .unwrap());
    fs::remove_dir_all(root).unwrap();
}
