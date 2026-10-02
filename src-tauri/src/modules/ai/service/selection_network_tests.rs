use super::*;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::mpsc,
    thread,
    time::Instant,
};

struct Probe {
    url: String,
    request: tokio::sync::oneshot::Receiver<(String, String, serde_json::Value)>,
    release: Option<mpsc::Sender<()>>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Probe {
    fn new(failure: bool) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/custom", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let (sent, request) = tokio::sync::oneshot::channel();
        let (release, resume) = mpsc::channel();
        let worker = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            && Instant::now() < deadline =>
                    {
                        thread::sleep(Duration::from_millis(2))
                    }
                    Err(error) => panic!("Probe accept failed: {error}"),
                }
            };
            // macOS may inherit listener flags onto accepted sockets.
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let captured = read_request(&mut stream);
            sent.send(captured).unwrap();
            let _ = resume.recv_timeout(Duration::from_secs(5));
            let (status, body) = if failure {
                (
                    "503 Service Unavailable",
                    r#"{"error":{"code":"temporarily_unavailable","message":"private-secret-b"}}"#,
                )
            } else {
                (
                    "200 OK",
                    r#"{"output":[{"content":[{"type":"output_text","text":"OK"}]}]}"#,
                )
            };
            write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        Self {
            url,
            request,
            release: Some(release),
            worker: Some(worker),
        }
    }
    async fn captured(&mut self) -> (String, String, serde_json::Value) {
        tokio::time::timeout(Duration::from_secs(5), &mut self.request)
            .await
            .unwrap()
            .unwrap()
    }
    fn finish(&mut self) {
        self.release.take().unwrap().send(()).unwrap();
        self.worker.take().unwrap().join().unwrap();
    }
}
impl Drop for Probe {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() {
            let _ = release.send(());
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
fn read_request(stream: &mut TcpStream) -> (String, String, serde_json::Value) {
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut bytes = Vec::new();
    loop {
        assert!(Instant::now() < deadline && bytes.len() <= 16_384);
        let mut chunk = [0; 1024];
        let n = stream.read(&mut chunk).unwrap();
        assert_ne!(n, 0);
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
            let headers = String::from_utf8(bytes[..end].to_vec()).unwrap();
            let length: usize = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse().unwrap())
                })
                .unwrap();
            assert!(length <= 16_384);
            if bytes.len() < end + 4 + length {
                continue;
            }
            let auth = headers
                .lines()
                .find(|l| l.to_ascii_lowercase().starts_with("authorization:"))
                .unwrap()
                .split_once(':')
                .unwrap()
                .1
                .trim()
                .to_string();
            let path = headers.lines().next().unwrap().to_string();
            return (
                path,
                auth,
                serde_json::from_slice(&bytes[end + 4..end + 4 + length]).unwrap(),
            );
        }
    }
}

#[tokio::test]
async fn targeted_request_keeps_saved_identity_during_switch_replace_and_delete() {
    let f = Fixture::new();
    let a = f.service.create_provider(create(0, "a")).await.unwrap();
    let mut probe = Probe::new(false);
    let mut draft = create(a.revision, "b");
    draft.base_url = probe.url.clone();
    let b = f.service.create_provider(draft).await.unwrap();
    let pb = b.providers.iter().find(|p| p.name == "b").unwrap().clone();
    let input = target(&b, &pb.id);
    let service = f.service.clone();
    let test = tokio::spawn(async move { service.test_provider(input).await });
    let (path, auth, body) = probe.captured().await;
    assert_eq!(path, "POST /custom/v1/responses HTTP/1.1");
    assert_eq!(auth, "Bearer private-secret-b");
    assert_eq!(body["model"], "model-a");
    assert_eq!(body["input"], "Reply with only OK.");
    assert_eq!(f.service.configuration().await.unwrap(), b);
    let v = tokio::time::timeout(
        Duration::from_secs(2),
        f.service.activate_provider(target(&b, &pb.id)),
    )
    .await
    .unwrap()
    .unwrap();
    let v = f
        .service
        .save_key(key_save(
            &v,
            &pb.id,
            Some(pb.keys[0].id.clone()),
            "replaced",
            Some("private-replaced"),
        ))
        .await
        .unwrap();
    let v = f
        .service
        .delete_provider(AiProviderDeleteInput {
            expected_revision: v.revision,
            provider_id: pb.id.clone(),
        })
        .await
        .unwrap();
    assert!(v.active_provider_id.is_none());
    probe.finish();
    test.await.unwrap().unwrap();
    assert!(!f.logs.0.lock().join(" ").contains("private-secret"));
}

#[tokio::test]
async fn abandoned_native_http_waiter_keeps_maintenance_until_worker_finishes() {
    let f = Fixture::new();
    let mut probe = Probe::new(false);
    let mut draft = create(0, "a");
    draft.base_url = probe.url.clone();
    f.service.create_provider(draft).await.unwrap();
    // Exercise the old test command's shared path as well as the new target path.
    let service = f.service.clone();
    let waiter = tokio::spawn(async move { service.test_saved(None).await });
    let (_, auth, _) = probe.captured().await;
    assert_eq!(auth, "Bearer private-secret-a");
    waiter.abort();
    assert!(f
        .service
        .operations
        .maintenance(Duration::from_millis(30))
        .await
        .is_err());
    probe.finish();
    let _lease = f
        .service
        .operations
        .maintenance(Duration::from_secs(3))
        .await
        .unwrap();
}

#[tokio::test]
async fn provider_failure_does_not_change_selection_or_echo_remote_message() {
    let f = Fixture::new();
    let mut probe = Probe::new(true);
    let mut draft = create(0, "a");
    draft.base_url = probe.url.clone();
    let original = f.service.create_provider(draft).await.unwrap();
    let input = target(&original, &original.providers[0].id);
    let service = f.service.clone();
    let test = tokio::spawn(async move { service.test_provider(input).await });
    probe.captured().await;
    probe.finish();
    let error = test.await.unwrap().unwrap_err();
    assert_eq!(error.kind, crate::error::AppErrorKind::External);
    assert!(!format!("{error:?}").contains("private-secret"));
    assert_eq!(f.service.configuration().await.unwrap(), original);
}
