use super::{APP_ID, AppPaths, Startup, StartupError};
use std::{ffi::OsString, path::PathBuf};

#[test]
fn default_directory_uses_independent_native_identity() {
    let result = Startup::parse([], || Some(PathBuf::from("/isolated/apps")), None);
    assert_eq!(
        result,
        Ok(Startup::Run(AppPaths {
            data_dir: PathBuf::from("/isolated/apps").join(APP_ID),
        }))
    );
}

#[test]
fn explicit_directory_does_not_require_system_directory() {
    let result = Startup::parse(
        ["--data-dir", "/isolated/原生验收"].map(OsString::from),
        || None,
        None,
    );
    assert_eq!(
        result,
        Ok(Startup::Run(AppPaths {
            data_dir: PathBuf::from("/isolated/原生验收"),
        }))
    );
}

#[test]
fn invalid_arguments_never_silently_use_real_app_data() {
    for args in [
        vec!["--data-dir"],
        vec!["--data-dir", ""],
        vec!["--data-dir", "--help"],
    ] {
        assert_eq!(
            Startup::parse(args.into_iter().map(OsString::from), || None, None),
            Err(StartupError::MissingDataDirectory)
        );
    }
    assert_eq!(
        Startup::parse([OsString::from("--unknown")], || None, None),
        Err(StartupError::UnknownArgument)
    );
}

#[test]
fn repeated_directory_is_rejected() {
    let args = ["--data-dir", "/isolated/a", "--data-dir", "/isolated/b"].map(OsString::from);
    assert_eq!(
        Startup::parse(args, || None, None),
        Err(StartupError::DuplicateDataDirectory)
    );
}

#[test]
fn help_does_not_need_or_initialize_any_data_directory() {
    assert_eq!(
        Startup::parse([OsString::from("--help")], || None, None),
        Ok(Startup::Help)
    );
}

#[test]
fn environment_directory_supports_a_standard_application_bundle() {
    let result = Startup::parse([], || None, Some(OsString::from("/isolated/native-bundle")));
    assert_eq!(
        result,
        Ok(Startup::Run(AppPaths {
            data_dir: "/isolated/native-bundle".into()
        }))
    );
}

#[test]
fn explicit_directory_takes_precedence_over_environment() {
    let result = Startup::parse(
        ["--data-dir", "/isolated/explicit"].map(OsString::from),
        || None,
        Some(OsString::from("/isolated/environment")),
    );
    assert_eq!(
        result,
        Ok(Startup::Run(AppPaths {
            data_dir: "/isolated/explicit".into()
        }))
    );
}

#[test]
fn empty_environment_directory_cannot_fall_back_to_default_data() {
    let result = Startup::parse([], || Some("/isolated/apps".into()), Some(OsString::new()));
    assert_eq!(result, Err(StartupError::MissingDataDirectory));
}
