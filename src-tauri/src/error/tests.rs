use super::*;
use serde_json::json;

#[test]
fn wire_shape_is_identical_for_both_kinds() {
    let errors = [
        AppError::custom(CustomErrorCode::BtFileNotInTask),
        AppError::from(std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
    ];
    for error in errors {
        let value = serde_json::to_value(&error).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 4);
        assert_eq!(value["args"], json!({}));
        assert_eq!(value["code"], error.code);
        assert_eq!(value["message"], error.message);
        let restored: AppError = serde_json::from_value(value).unwrap();
        assert_eq!(restored, error);
    }
    assert_eq!(
        serde_json::to_value(AppError::custom(CustomErrorCode::BtFileNotInTask)).unwrap(),
        json!({
            "kind": "custom", "code": "bt:file_not_in_task",
            "message": "File does not belong to this download task", "args": {}
        })
    );
}

#[test]
fn io_roundtrip_preserves_custom_and_external_payloads() {
    for original in [
        AppError::custom(CustomErrorCode::BtFileNotInTask).with_arg("path", "目录/文件.txt"),
        AppError::from(std::io::Error::from(std::io::ErrorKind::TimedOut))
            .with_arg("operation", "read"),
    ] {
        let wrapped = std::io::Error::other(original.clone());
        assert_eq!(AppError::from(wrapped), original);
        let wrapped = std::io::Error::other(std::io::Error::other(original.clone()));
        assert_eq!(AppError::from(wrapped), original);
    }
}

#[test]
fn external_context_keeps_category_and_os_code() {
    let original = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
    let error = AppError::from(original).context("Failed to access file");
    assert_eq!(error.kind, AppErrorKind::External);
    assert_eq!(error.code, "io:permission_denied");
    // Native numeric values have different meanings on Windows and Unix.
    let native = AppError::from(std::io::Error::from_raw_os_error(13));
    assert_eq!(native.args["osCode"], "13");
    assert!(error.message.starts_with("Failed to access file: "));
}

#[test]
fn ssh_categories_keep_numeric_diagnostics() {
    for (number, code) in [
        (-9, "ssh:timed_out"),
        (-30, "ssh:timed_out"),
        (-18, "ssh:authentication_failed"),
        (-7, "ssh:disconnected"),
        (-13, "ssh:disconnected"),
        (-43, "ssh:disconnected"),
        (-45, "ssh:disconnected"),
        (-1, "ssh:session"),
    ] {
        let error = AppError::from(ssh2::Error::from_errno(ssh2::ErrorCode::Session(number)));
        assert_eq!(error.kind, AppErrorKind::External);
        assert_eq!(error.code, code);
        assert_eq!(error.args["sourceCode"], number.to_string());
    }
}

#[test]
fn json_diagnostic_does_not_echo_values() {
    let error = serde_json::from_str::<u64>(r#""secret-token""#).unwrap_err();
    let error = AppError::from(error);
    assert_eq!(error.code, "json:data");
    assert!(error.args.contains_key("column"));
    assert!(!serde_json::to_string(&error)
        .unwrap()
        .contains("secret-token"));
}

#[test]
fn database_diagnostic_does_not_echo_sql() {
    let db = rusqlite::Connection::open_in_memory().unwrap();
    let error = db
        .execute("SELECT secret_token FROM missing", [])
        .unwrap_err();
    let error = AppError::from(error);
    assert_eq!(error.code, "db:sqlite");
    assert!(error.args.contains_key("sourceCode"));
    assert!(!serde_json::to_string(&error)
        .unwrap()
        .contains("secret_token"));
}

#[test]
fn http_diagnostic_does_not_echo_credentials_url_or_body() {
    let error = reqwest::Client::new()
        .get("https://user:password@example.invalid/private?token=secret-token")
        .header("x-test", "invalid\nsecret-body")
        .build()
        .unwrap_err();
    let error = AppError::from(error);
    assert_eq!(error.code, "http:invalid_request");
    let json = serde_json::to_string(&error).unwrap();
    for secret in ["password", "example.invalid", "secret-token", "secret-body"] {
        assert!(!json.contains(secret));
    }
}

#[test]
fn domain_errors_survive_the_rusqlite_row_mapper_wrapper() {
    // Row mappers surface classified AppErrors through ToSqlConversionFailure;
    // the custom payload must be restored, not flattened into db:operation.
    let original = AppError::custom(CustomErrorCode::HostAuthTypeInvalid);
    let wrapped = rusqlite::Error::ToSqlConversionFailure(Box::new(original.clone()));
    let converted = AppError::from(wrapped);
    assert_eq!(converted, original);

    // A foreign (non-AppError) wrapper still degrades to the generic code.
    let foreign = rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other("x")));
    assert_eq!(AppError::from(foreign).code, "db:operation");
}
