use super::*;
use crate::error::CustomErrorCode;

#[test]
fn task_failure_event_has_a_stable_kind_and_a_separate_complete_error() {
    for error in [
        AppError::custom(CustomErrorCode::BtArchiveAlreadyExists).with_arg("path", "archive.tar"),
        AppError::from(std::io::Error::from_raw_os_error(13)),
    ] {
        let event = BtTaskEvent::PackageFailed {
            info_hash: "a".repeat(40),
            error: error.clone(),
        };
        let value = serde_json::to_value(event).unwrap();
        assert_eq!(value["kind"], "package-failed");
        assert_eq!(value["infoHash"], "a".repeat(40));
        assert_eq!(
            serde_json::from_value::<AppError>(value["error"].clone()).unwrap(),
            error
        );
    }
}
