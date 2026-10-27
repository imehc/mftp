use super::*;
use crate::modules::game_room::service::framing::{read_message_logged, HANDSHAKE_FRAME_LIMIT};
use crate::modules::game_room::service::runtime::StopSignal;
use crate::modules::game_room::service::wire::{PeerLink, WireMsg};
use std::io::BufReader;
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

#[test]
fn socket_frames_keep_payload_and_redact_room_credentials_before_recording() {
    let diagnostics = Arc::new(Diagnostics::default());
    let logs = RoomDiagnostics {
        diagnostics: diagnostics.clone(),
        activity: None,
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let sender = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let receiver = listener.accept().unwrap().0;
    let peer = PeerLink::new(sender).unwrap().with_logs(logs.clone());
    peer.send(&WireMsg::Hello {
        game_id: "junqi/hidden".into(),
        code: Some("private-room-code".into()),
        player_name: "guest".into(),
    })
    .unwrap();
    let frame = read_message_logged(
        &mut BufReader::new(receiver),
        &StopSignal::default(),
        HANDSHAKE_FRAME_LIMIT,
        Duration::from_secs(1),
        Some(&logs),
    )
    .unwrap();
    assert!(
        matches!(frame, WireMsg::Hello { code: Some(code), .. } if code == "private-room-code")
    );
    let snapshot = diagnostics.snapshot(0);
    let operations = snapshot.operations.unwrap();
    assert_eq!(operations.len(), 2);
    let serialized = serde_json::to_string(&operations).unwrap();
    assert!(serialized.contains("junqi/hidden"));
    assert!(serialized.contains("guest"));
    assert!(serialized.contains("[REDACTED]"));
    assert!(!serialized.contains("private-room-code"));
    assert!(operations.iter().all(|operation| operation
        .trace
        .as_ref()
        .unwrap()
        .text
        .contains("\"complete\":true")));
}

#[test]
fn malformed_partial_frames_report_bytes_without_inventing_a_complete_message() {
    let diagnostics = Arc::new(Diagnostics::default());
    let logs = RoomDiagnostics {
        diagnostics: diagnostics.clone(),
        activity: None,
    };
    let error = AppError::from(std::io::Error::new(
        std::io::ErrorKind::UnexpectedEof,
        "Peer closed a partial frame",
    ));
    logs.frame(
        "receive_frame",
        "127.0.0.1:1",
        b"{\"type\":\"hello\",\"code\":\"secret",
        false,
        Some(&error),
    );
    let operation = diagnostics.snapshot(0).operations.unwrap().remove(0);
    let trace = operation.trace.unwrap().text;
    assert!(trace.contains("\"complete\":false"));
    assert!(trace.contains("notCaptured"));
    assert!(!trace.contains("secret"));
    assert_eq!(operation.error.unwrap().code, error.code);
}

#[test]
fn escaped_application_credentials_are_masked_without_removing_game_data() {
    let diagnostics = Arc::new(Diagnostics::default());
    let logs = RoomDiagnostics {
        diagnostics: diagnostics.clone(),
        activity: None,
    };
    let frame = serde_json::to_vec(&json!({"type":"app","payload":json!({"token":"test-token","move":{"from":30,"to":25}}).to_string()})).unwrap();
    logs.frame("send_frame", "peer", &frame, true, None);
    let trace = diagnostics
        .snapshot(0)
        .operations
        .unwrap()
        .remove(0)
        .trace
        .unwrap()
        .text;
    assert!(!trace.contains("test-token"));
    assert!(trace.contains("move"));
    assert!(trace.contains("30"));
}

#[test]
fn nested_credentials_preserve_unrelated_wire_bytes_and_escape_styles() {
    let raw = br#"{ "type":"app", "payload":"{ \"token\":\"a\\\"b\\n\\u4e2d\", \"move\": 30, \"code\":\"ordinary\" }" }"#;
    let (safe, redacted) =
        super::super::redaction::sanitize(raw, &mut Redactor::default()).unwrap();
    assert!(redacted);
    assert_eq!(
        String::from_utf8(safe).unwrap(),
        r#"{ "type":"app", "payload":"{ \"token\":\"[REDACTED]\", \"move\": 30, \"code\":\"ordinary\" }" }"#
    );
    let duplicate = br#"{"type":"hello","code":"first","code":"\u0073econd","gameId":"junqi"}"#;
    let (safe, _) = super::super::redaction::sanitize(duplicate, &mut Redactor::default()).unwrap();
    assert_eq!(
        String::from_utf8(safe).unwrap(),
        r#"{"type":"hello","code":"[REDACTED]","code":"[REDACTED]","gameId":"junqi"}"#
    );
}

#[test]
fn malformed_embedded_payload_never_leaks_credentials() {
    let raw = serde_json::to_vec(&json!({"type":"app","payload":"{\"token\":\"secret"})).unwrap();
    assert!(super::super::redaction::sanitize(&raw, &mut Redactor::default()).is_none());
}
