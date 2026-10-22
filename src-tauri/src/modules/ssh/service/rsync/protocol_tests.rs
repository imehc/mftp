use super::*;
use crate::modules::ssh::RsyncDirection;

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

#[test]
fn accepts_upload_and_download_server_commands() {
    let upload = args(&["/usr/bin/rsync", "--server", "-svlogDtpre.iLsfxCIvu"]);
    assert!(validate_remote_command(&upload, "/usr/bin/rsync", RsyncDirection::Upload).is_ok());

    let download = args(&[
        "/usr/bin/rsync",
        "--server",
        "--sender",
        "-slogDtpre.iLsfxCIvu",
    ]);
    assert!(validate_remote_command(&download, "/usr/bin/rsync", RsyncDirection::Download).is_ok());
}

#[test]
fn rejects_commands_outside_the_registered_shape() {
    let upload = args(&["/usr/bin/rsync", "--server", "-slogDtpre.iLsfxCIvu"]);
    for (argv, expected) in [
        (
            args(&["/evil/rsync", "--server", "-slogDtpre.iLsfxCIvu"]),
            "program",
        ),
        (
            args(&["/usr/bin/rsync", "--sender", "-slogDtpre.iLsfxCIvu"]),
            "server",
        ),
        (
            args(&["/usr/bin/rsync", "--server", "-slogDtpre.iLsfxCIvu", "/"]),
            "unexpected",
        ),
        (
            args(&["/usr/bin/rsync", "--server", "-logDtpre.iLsfxCIvu"]),
            "protected",
        ),
        (
            args(&["/usr/bin/rsync", "--server", "-slogDtpre;id"]),
            "protected",
        ),
    ] {
        let error = validate_remote_command(&argv, "/usr/bin/rsync", RsyncDirection::Upload)
            .expect_err(expected);
        assert_eq!(error.code, "rsync:remote_command_rejected");
    }
    assert!(validate_remote_command(&upload, "/usr/bin/rsync", RsyncDirection::Download).is_err());
}

#[test]
fn remote_program_requires_a_safe_absolute_path() {
    for allowed in [
        "/usr/bin/rsync",
        "/opt/homebrew/bin/rsync",
        "/usr/local/bin/rsync-3.5.1",
    ] {
        assert!(is_safe_remote_program(allowed), "{allowed}");
    }
    for rejected in [
        "rsync",
        "/usr/bin/rsync --fake",
        "/usr/bin/rs'ync",
        "/usr/bin/rs\nync",
        " /usr/bin/rsync",
    ] {
        assert!(!is_safe_remote_program(rejected), "{rejected}");
    }
}

#[test]
fn command_line_quotes_the_remote_program() {
    let line = remote_command_line(
        "/usr/local/my rsync",
        &args(&["--server", "-slogDtpre.iLsfxCIvu"]),
    );
    assert_eq!(
        line,
        "'/usr/local/my rsync' '--server' '-slogDtpre.iLsfxCIvu'"
    );
}

#[test]
fn handshake_frames_round_trip_and_enforce_the_limit() {
    let handshake = HelperHandshake {
        token: "token-value".into(),
        argv: args(&["/usr/bin/rsync", "--server", "-slog"]),
    };
    let encoded = encode_handshake(&handshake).expect("encode");
    let mut framed = Vec::new();
    write_frame(&mut framed, &encoded).expect("write");
    let decoded =
        decode_handshake(&read_frame(&mut framed.as_slice(), HANDSHAKE_LIMIT).expect("read"))
            .expect("decode");
    assert_eq!(decoded.token, handshake.token);
    assert_eq!(decoded.argv, handshake.argv);

    let mut oversized = Vec::new();
    oversized.extend_from_slice(&(HANDSHAKE_LIMIT as u32 + 1).to_be_bytes());
    oversized.extend(std::iter::repeat_n(0u8, HANDSHAKE_LIMIT + 1));
    assert!(read_frame(&mut oversized.as_slice(), HANDSHAKE_LIMIT).is_err());
}
