use super::{catalog, download, files, TranslationService};
use crate::core::{diagnostics::Diagnostics, operations::Operations};
use reqwest::StatusCode;
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

struct Fixture(std::path::PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("translation-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn cancellation_retains_admission_until_actual_worker_exit() {
    let fixture = Fixture::new();
    let operations = Arc::new(Operations::default());
    let service = Arc::new(TranslationService::new(
        fixture.0.clone(),
        operations.clone(),
    ));
    let id = uuid::Uuid::new_v4().to_string();
    let worker = service
        .begin("main".into(), id.clone(), catalog::CATALOG[0].id)
        .unwrap();
    service.cancel("other", &id);
    assert!(!worker.cancel.load(Ordering::Acquire));
    service.cancel("main", &id);
    assert!(worker.cancel.load(Ordering::Acquire));
    assert!(service.is_busy());
    assert!(service.clear().is_err());
    assert!(service
        .begin(
            "main".into(),
            uuid::Uuid::new_v4().to_string(),
            catalog::CATALOG[1].id
        )
        .is_err());
    assert!(!operations.wait_idle(std::time::Duration::from_millis(1)));
    drop(worker);
    assert!(!service.is_busy());
    assert!(operations.wait_idle(std::time::Duration::from_millis(1)));
}

#[test]
fn selection_is_versioned_and_unknown_models_do_not_replace_it() {
    let fixture = Fixture::new();
    files::select(&fixture.0, catalog::CATALOG[0].id).unwrap();
    files::select(&fixture.0, catalog::CATALOG[1].id).unwrap();
    assert!(files::select(&fixture.0, "../../unknown").is_err());
    assert_eq!(files::selected(&fixture.0).unwrap(), catalog::CATALOG[1].id);
    fs::write(
        fixture.0.join("selection.json"),
        r#"{"version":2,"selected":"future"}"#,
    )
    .unwrap();
    assert!(files::selected(&fixture.0).is_err());
}

#[test]
fn range_validation_restarts_only_for_full_responses() {
    assert_eq!(
        download::response_start(StatusCode::OK, None, 1, 3).unwrap(),
        0
    );
    assert_eq!(
        download::response_start(StatusCode::PARTIAL_CONTENT, Some("bytes 1-2/3"), 1, 3).unwrap(),
        1
    );
    for value in [
        "bytes 0-2/3",
        "bytes 1-1/3",
        "bytes 1-2/4",
        "bytes +1-2/3",
        "items 1-2/3",
    ] {
        assert!(download::response_start(StatusCode::PARTIAL_CONTENT, Some(value), 1, 3).is_err());
    }
}

#[test]
fn http_download_failure_uses_translation_error() {
    let fixture = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/model.gguf", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = Vec::new();
        let mut byte = [0];
        while !request.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        let request = String::from_utf8(request).unwrap().to_ascii_lowercase();
        stream
            .write_all(
                b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .unwrap();
        request
    });
    let model = catalog::ModelSpec {
        id: "fixture",
        name: "fixture",
        quantization: "fixture",
        profile: catalog::Profile::HyMt2,
        bytes: 3,
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        url: Box::leak(url.into_boxed_str()),
        legacy_stq: false,
    };
    let service = Arc::new(TranslationService::new(
        fixture.0.clone(),
        Arc::new(Operations::default()),
    ));
    let worker = service
        .begin(
            "main".into(),
            uuid::Uuid::new_v4().to_string(),
            catalog::CATALOG[0].id,
        )
        .unwrap();
    let error =
        download::install(&fixture.0, &model, &worker, &Diagnostics::default()).unwrap_err();
    let request = server.join().unwrap();
    assert!(request.contains(concat!(
        "user-agent: mftp/",
        env!("CARGO_PKG_VERSION"),
        "\r\n"
    )));
    assert_eq!(error.code, "translation:download");
    assert_eq!(error.args.get("reason").map(String::as_str), Some("status"));
    assert_eq!(error.args.get("status").map(String::as_str), Some("503"));
}

#[test]
fn resumed_download_is_verified_and_binary_is_not_recorded() {
    let fixture = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/model.gguf", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = Vec::new();
        let mut byte = [0];
        while !request.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        let request = String::from_utf8(request).unwrap().to_lowercase();
        assert!(request.contains("range: bytes=1-"));
        assert!(request.contains("if-range: \"revision\""));
        stream.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 2\r\nContent-Range: bytes 1-2/3\r\nETag: \"revision\"\r\nConnection: close\r\n\r\nbc").unwrap();
    });
    let model = catalog::ModelSpec {
        id: "fixture",
        name: "fixture",
        quantization: "fixture",
        profile: catalog::Profile::HyMt2,
        bytes: 3,
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        url: Box::leak(url.into_boxed_str()),
        legacy_stq: false,
    };
    fs::write(files::partial_path(&fixture.0, &model), b"a").unwrap();
    fs::write(
        files::partial_path(&fixture.0, &model).with_extension("etag"),
        "\"revision\"",
    )
    .unwrap();
    let service = Arc::new(TranslationService::new(
        fixture.0.clone(),
        Arc::new(Operations::default()),
    ));
    let worker = service
        .begin(
            "main".into(),
            uuid::Uuid::new_v4().to_string(),
            catalog::CATALOG[0].id,
        )
        .unwrap();
    let diagnostics = Diagnostics::default();
    download::install(&fixture.0, &model, &worker, &diagnostics).unwrap();
    server.join().unwrap();
    assert_eq!(
        fs::read(files::model_path(&fixture.0, &model)).unwrap(),
        b"abc"
    );
    assert!(!files::partial_path(&fixture.0, &model).exists());
    let snapshot = serde_json::to_value(diagnostics.snapshot(0)).unwrap();
    let response = &snapshot["operations"][0]["details"][1]["body"];
    assert_eq!(response["receivedBytes"], 2.0);
    assert_eq!(response["capturedBytes"], 0);
    assert_eq!(response["text"], "");
    assert!(snapshot["operations"][0]["trace"]["text"]
        .as_str()
        .unwrap()
        .contains("model binary"));
    let installed = files::model_path(&fixture.0, &model);
    assert!(files::verified_path(&installed).exists());
    // A matching marker skips hashing, so a cancelled check still succeeds.
    files::verify_once(&installed, &model, &AtomicBool::new(true)).unwrap();
    fs::write(files::model_path(&fixture.0, &model), b"xyz").unwrap();
    assert_eq!(
        files::verify_once(&installed, &model, &AtomicBool::new(false))
            .unwrap_err()
            .code,
        "translation:checksum"
    );
    assert_eq!(
        files::verify(
            &files::model_path(&fixture.0, &model),
            &model,
            &AtomicBool::new(false)
        )
        .unwrap_err()
        .code,
        "translation:checksum"
    );
    assert_eq!(
        fs::read(files::model_path(&fixture.0, &model)).unwrap(),
        b"xyz"
    );
}

#[test]
#[ignore = "Requires both explicitly supplied official models; uses isolated app data"]
fn installed_models_switch_and_translate_without_network() {
    let fixture = Fixture::new();
    let service = Arc::new(TranslationService::new(
        fixture.0.clone(),
        Arc::new(Operations::default()),
    ));
    let sources = ["MFTP_TEST_STQ_FILE", "MFTP_TEST_Q4_FILE"];
    for (spec, source) in catalog::CATALOG.iter().zip(sources) {
        let original = std::env::var(source).expect("isolated official model path");
        fs::hard_link(original, files::model_path(&fixture.0, spec)).unwrap();
        files::select(&fixture.0, spec.id).unwrap();
        let worker = service
            .begin("main".into(), uuid::Uuid::new_v4().to_string(), spec.id)
            .unwrap();
        let result = service
            .generate(
                &worker,
                super::model::TranslationRequest {
                    request_id: worker.id.clone(),
                    model_id: spec.id.into(),
                    source_language: "auto".into(),
                    target_language: "zh-CN".into(),
                    text: "The weather is lovely today. Let's go for a walk in the park.".into(),
                },
                tauri::ipc::Channel::new(|_| Ok(())),
            )
            .unwrap();
        assert!(result.contains("公园"), "{result}");
        println!("{}: {result}", spec.id);
        drop(worker);
        assert!(!service.is_busy());
    }
    assert!(service
        .snapshot()
        .unwrap()
        .models
        .iter()
        .all(|model| model.installed));
    service.clear().unwrap();
    fs::create_dir(&fixture.0).unwrap();
}

#[test]
fn publish_moves_a_new_artifact_into_place() {
    let fixture = Fixture::new();
    let partial = fixture.0.join("model.part");
    let destination = fixture.0.join("model.gguf");
    fs::write(&partial, b"weights").unwrap();

    assert!(files::publish(&partial, &destination).unwrap());
    assert_eq!(fs::read(&destination).unwrap(), b"weights");
    assert!(!partial.exists());
}

#[test]
fn publish_reports_an_existing_artifact_without_replacing_it() {
    let fixture = Fixture::new();
    let partial = fixture.0.join("model.part");
    let destination = fixture.0.join("model.gguf");
    fs::write(&partial, b"partial").unwrap();
    fs::write(&destination, b"installed").unwrap();

    // 目标已存在时不上报“已发布”，由调用方校验既有文件而不是覆盖它。
    assert!(!files::publish(&partial, &destination).unwrap());
    assert_eq!(fs::read(&destination).unwrap(), b"installed");
    assert!(!partial.exists());
}
