use super::*;
use crate::error::CustomErrorCode;

#[test]
fn engine_adapter_recovers_typed_errors_through_io_and_anyhow_context() {
    let original = AppError::custom(CustomErrorCode::BtTaskCancelled).with_arg("task", "test");
    let error =
        anyhow::Error::new(std::io::Error::other(original.clone())).context("engine wrapper");
    assert_eq!(AppError::bt_engine(error), original);
    let error = anyhow::Error::new(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
    assert_eq!(AppError::bt_engine(error).code, "io:permission_denied");
}

#[test]
fn untyped_engine_details_do_not_expose_tracker_credentials() {
    let error = AppError::bt_engine(anyhow::anyhow!(
        "https://user:secret@tracker/?token=private"
    ));
    assert_eq!(error.code, "bt:engine");
    assert!(!error.message.contains("secret"));
    assert!(!error.message.contains("private"));
}
