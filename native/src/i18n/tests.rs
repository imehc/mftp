use super::{LanguagePreference, Locale, text};

#[test]
fn unsupported_system_languages_use_english() {
    for language in ["de-DE", "zh-Hant-TW", "zh-TW", "zh-HK", ""] {
        assert_eq!(Locale::from_system(language), Locale::English);
    }
}

#[test]
fn simplified_chinese_system_aliases_are_supported() {
    for language in ["zh", "zh_CN", "zh-SG", "zh-Hans-CN"] {
        assert_eq!(Locale::from_system(language), Locale::Chinese);
    }
}

#[test]
fn switching_locale_changes_the_same_message() {
    assert_eq!(text("settings.title", Locale::Chinese), "设置");
    assert_eq!(text("settings.title", Locale::English), "Settings");
}

#[test]
fn explicit_language_overrides_system_language() {
    assert_eq!(
        LanguagePreference::Chinese.resolve(Locale::English),
        Locale::Chinese
    );
    assert_eq!(
        LanguagePreference::English.resolve(Locale::Chinese),
        Locale::English
    );
    assert_eq!(
        LanguagePreference::System.resolve(Locale::Chinese),
        Locale::Chinese
    );
}

#[test]
fn language_options_keep_their_own_names() {
    for locale in [Locale::Chinese, Locale::English] {
        assert_eq!(LanguagePreference::Chinese.label(locale), "简体中文");
        assert_eq!(LanguagePreference::English.label(locale), "English");
    }
}

#[test]
fn both_catalogs_contain_every_application_message_without_fallback() {
    let keys = [
        "app.quit",
        "settings.title",
        "settings.system",
        "settings.language",
        "settings.appearance",
        "settings.light",
        "settings.dark",
        "languages.chinese",
        "languages.english",
        "todo.save_changes",
        "todo.details",
        "todo.image_count",
        "todo.image_count_one",
        "todo.overdue",
        "todo.abandoned",
        "todo.abandon",
        "todo.category",
        "todo.category_options",
        "todo.priority",
        "todo.priority_high",
        "todo.priority_medium",
        "todo.priority_low",
        "todo.no_priority",
        "todo.all_priorities",
        "todo.all_categories",
        "todo.planned",
        "todo.no_date",
        "todo.specify_time",
        "todo.unscheduled",
        "todo.untracked",
        "todo.state",
        "todo.created_at",
        "todo.updated_at",
        "todo.completed_at",
        "todo.abandoned_at",
        "todo.empty_overdue",
        "todo.empty_abandoned",
        "errors.due_date_invalid",
        "errors.due_time_invalid",
        "todo.priority_high_label",
        "todo.priority_medium_label",
        "todo.priority_low_label",
        "todo.title",
        "todo.active",
        "todo.completed",
        "todo.new",
        "todo.new_title",
        "todo.edit_title",
        "todo.search",
        "todo.notes",
        "todo.create",
        "todo.save",
        "todo.cancel",
        "todo.close_editor",
        "todo.complete",
        "todo.restore",
        "todo.more",
        "todo.edit",
        "todo.delete",
        "todo.delete_title",
        "todo.delete_body",
        "todo.unsaved_title",
        "todo.unsaved_body",
        "todo.keep_editing",
        "todo.discard",
        "todo.loading",
        "todo.retry",
        "todo.no_results",
        "todo.empty_active",
        "todo.empty_completed",
        "todo.clear_search",
        "todo.add_notes",
        "errors.title_required",
        "errors.conflict",
        "errors.not_found",
        "errors.queue_busy",
        "errors.permission",
        "errors.state_invalid",
        "errors.operation",
        "errors.startup",
        "errors.persistence",
        "rich_text.bold",
        "rich_text.italic",
        "rich_text.format",
        "rich_text.character_count",
        "rich_text.paragraph",
        "rich_text.heading",
        "rich_text.bullets",
        "rich_text.numbered",
        "rich_text.quote",
        "rich_text.code_block",
        "rich_text.strike",
        "rich_text.inline_code",
        "rich_text.undo",
        "rich_text.redo",
        "rich_text.link",
        "rich_text.url",
        "rich_text.url_invalid",
        "rich_text.invalid",
        "rich_text.image",
        "rich_text.insert_image",
        "rich_text.image_processing",
        "rich_text.image_retry",
        "rich_text.image_remove",
        "rich_text.image_input_too_large",
        "rich_text.image_dimensions",
        "rich_text.image_unsupported",
        "rich_text.image_limit",
        "rich_text.image_output_too_large",
        "rich_text.image_one_at_a_time",
        "rich_text.image_missing",
        "rich_text.image_rejected",
        "rich_text.image_failed",
        "rich_text.image_position",
        "rich_text.copy_image",
        "rich_text.copy_image_number",
    ];
    for locale in ["en", "zh-CN"] {
        for key in keys {
            let translated = crate::_rust_i18n_backend().translate(locale, key);
            assert!(
                translated.is_some_and(|value| !value.is_empty()),
                "{locale}: {key}"
            );
        }
    }
}
