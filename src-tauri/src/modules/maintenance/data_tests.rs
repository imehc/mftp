use super::*;
use crate::error::AppErrorKind;

#[test]
fn clear_only_waits_for_the_participant_that_owns_live_work() {
    assert_eq!(participants_for(AppDataModule::Hosts), [participants::SSH]);
    assert_eq!(
        participants_for(AppDataModule::Poetry),
        [participants::POETRY]
    );
    // LAN HTTP log rows are appended outside the Executor lease, so its
    // service must drain before the activity-log table is cleared.
    assert_eq!(
        participants_for(AppDataModule::ActivityLogs),
        [participants::LAN_TRANSFER]
    );
    for module in [AppDataModule::Vault, AppDataModule::Todo] {
        assert!(participants_for(module).is_empty(), "{module:?}");
    }
}

// The reset participant list is now derived from the single Lifecycle
// registration (both paths query it), covered by
// `app::lifecycle::tests::maintenance_and_exit_share_one_participant_registry`.

#[test]
fn busy_error_is_custom_with_stable_participant_argument() {
    let error = participants::busy_error("lan_transfer");
    assert_eq!(error.kind, AppErrorKind::Custom);
    assert_eq!(error.code, "app:data_busy");
    assert_eq!(
        error.args.get("participant").map(String::as_str),
        Some("lan_transfer")
    );
    // Backend diagnostics stay English-only; user copy belongs to the frontend.
    assert!(!error.message.chars().any(|c| c as u32 > 0x2FFF));
}

#[test]
fn preserved_report_uses_a_localizable_key_not_display_copy() {
    assert_eq!(PRESERVED_USER_FILES, "bt-downloads-and-lan-shared-files");
    assert!(PRESERVED_USER_FILES.is_ascii());
}
