use super::super::super::types::AuthMethod;
use super::*;
use std::ffi::OsStr;

fn options<'a>(local_rsync: &'a Path, direction: RsyncDirection) -> BridgeOptions<'a> {
    BridgeOptions {
        local_rsync,
        remote_rsync: "/usr/bin/rsync",
        material: Arc::new(AuthMaterial {
            host: "127.0.0.1".into(),
            port: 2222,
            username: "tester".into(),
            method: AuthMethod::Password(Some("test-only".into())),
            identity_files: Vec::new(),
        }),
        direction,
        local_dir: "/data/src",
        remote_dir: "/srv/dst",
        delete_extraneous: false,
        dry_run: false,
        events: None,
        transfer_id: None,
        transfer: None,
        phase: "同步中",
    }
}

fn strings(args: &[OsString]) -> Vec<String> {
    args.iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

#[test]
fn upload_destination_uses_remote_transport_syntax() {
    let path = Path::new("/opt/homebrew/bin/rsync");
    let opts = options(path, RsyncDirection::Upload);
    let (source, destination) = sync_specs(&opts).unwrap();
    assert_eq!(source, OsString::from("/data/src/"));
    assert_eq!(destination, OsString::from("mftp:/srv/dst"));
}

#[test]
fn download_source_uses_remote_transport_syntax() {
    let path = Path::new("/opt/homebrew/bin/rsync");
    let opts = options(path, RsyncDirection::Download);
    let (source, destination) = sync_specs(&opts).unwrap();
    assert_eq!(source, OsString::from("mftp:/srv/dst/"));
    assert_eq!(destination, OsString::from("/data/src"));
}

#[test]
fn trailing_slashes_do_not_nest_an_extra_directory() {
    let path = Path::new("/opt/homebrew/bin/rsync");
    let mut opts = options(path, RsyncDirection::Upload);
    opts.local_dir = "/data/src///";
    opts.remote_dir = "/srv/dst///";
    let (source, destination) = sync_specs(&opts).unwrap();
    assert_eq!(source, OsString::from("/data/src/"));
    assert_eq!(destination, OsString::from("mftp:/srv/dst"));
}

#[test]
fn dry_run_and_delete_are_only_added_when_requested() {
    let path = Path::new("/opt/homebrew/bin/rsync");
    let mut opts = options(path, RsyncDirection::Upload);
    let helper = Path::new("/tmp/mftp-rsync-a/mftp-rsync-bridge");
    let plain = strings(&build_args(
        &opts,
        helper,
        OsStr::new("src/"),
        OsStr::new("mftp:dst"),
    ));
    assert!(!plain.iter().any(|arg| arg == "-n"));
    assert!(!plain.iter().any(|arg| arg == "--delete"));
    assert!(plain.iter().any(|arg| arg == "--info=progress2"));

    opts.dry_run = true;
    opts.delete_extraneous = true;
    let preview = strings(&build_args(
        &opts,
        helper,
        OsStr::new("src/"),
        OsStr::new("mftp:dst"),
    ));
    assert!(preview.iter().any(|arg| arg == "-n"));
    assert!(preview.iter().any(|arg| arg == "--delete"));
    assert!(!preview.iter().any(|arg| arg == "--info=progress2"));
}

#[test]
fn helper_and_remote_path_are_structured_arguments() {
    let path = Path::new("/opt/homebrew/bin/rsync");
    let opts = options(path, RsyncDirection::Upload);
    let helper = Path::new("/tmp/mftp-rsync-a/mftp-rsync-bridge");
    let args = strings(&build_args(
        &opts,
        helper,
        OsStr::new("/data/src/"),
        OsStr::new("mftp:/srv/dst"),
    ));
    let position = args.iter().position(|arg| arg == "-e").unwrap();
    assert_eq!(args[position + 1], "/tmp/mftp-rsync-a/mftp-rsync-bridge");
    assert!(args.iter().any(|arg| arg == "--rsync-path=/usr/bin/rsync"));
    assert_eq!(args[args.len() - 2], "/data/src/");
    assert_eq!(args[args.len() - 1], "mftp:/srv/dst");
}

#[test]
fn package_manager_overrides_are_disabled() {
    let path = Path::new("/opt/homebrew/bin/rsync");
    let opts = options(path, RsyncDirection::Download);
    let args = strings(&build_args(
        &opts,
        Path::new("/tmp/mftp-rsync-a/mftp-rsync-bridge"),
        OsStr::new("mftp:/srv/dst/"),
        OsStr::new("/data/src"),
    ));
    for flag in ["--no-owner", "--no-group", "--no-devices", "--no-specials"] {
        assert!(args.iter().any(|arg| arg == flag), "{flag}");
    }
}

#[test]
fn unsafe_targets_are_rejected() {
    let path = Path::new("/opt/homebrew/bin/rsync");
    for direction in [RsyncDirection::Upload, RsyncDirection::Download] {
        let mut opts = options(path, direction);
        for local in ["", "relative", "/", "/data\nsrc"] {
            opts.local_dir = local;
            assert!(sync_specs(&opts).is_err(), "local {local:?}");
        }
        opts.local_dir = "/data/src";
        for remote in ["", "relative", "/", "/srv\n dst"] {
            opts.remote_dir = remote;
            assert!(sync_specs(&opts).is_err(), "remote {remote:?}");
        }
    }
}

#[test]
fn remote_path_must_stay_absolute() {
    let path = Path::new("/opt/homebrew/bin/rsync");
    let mut opts = options(path, RsyncDirection::Upload);
    opts.remote_dir = "~/data";
    assert!(sync_specs(&opts).is_err());
}
