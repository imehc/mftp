use super::log_result;
use crate::error::{AppError, CustomErrorCode};

#[test]
fn cancellation_classifies_by_kind_and_code_not_text() {
    let cancelled = AppError::custom(CustomErrorCode::LanTransferCancelled);
    assert_eq!(log_result(&cancelled), "canceled");

    let failed = AppError::custom(CustomErrorCode::LanUploadTargetBusy);
    assert_eq!(log_result(&failed), "failed");

    // External errors may echo the same code string (E4-era legacy payloads or
    // mislabelled sources); kind still decides the recorded outcome.
    let external = AppError::external("lan:transfer_cancelled", "External failure");
    assert_eq!(log_result(&external), "failed");
}
