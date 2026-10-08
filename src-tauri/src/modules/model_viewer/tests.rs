use super::*;

struct Fixture(std::path::PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("mftp-model-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("model.gltf"), b"{}  ").unwrap();
        std::fs::write(root.join("texture.bin"), b"abcdef").unwrap();
        Self(root)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn only_explicitly_selected_resources_are_readable() {
    let fixture = Fixture::new();
    let service = ModelViewerService::default();
    let session = service.open(&fixture.0.join("model.gltf")).unwrap();
    // A sibling file is not authorized just because it exists.
    assert_eq!(
        service.size(&session.id, "texture.bin").unwrap_err().code,
        "model:resource_missing"
    );
    service
        .attach(
            &session.id,
            "textures/a.bin".into(),
            &fixture.0.join("texture.bin"),
        )
        .unwrap();
    assert_eq!(
        service.read(&session.id, "textures/a.bin", 2, 3).unwrap(),
        b"cde"
    );
    assert!(service.size(&session.id, "a.bin").is_err());
    assert!(service.size(&session.id, "textures/b.bin").is_err());
}

#[test]
fn traversal_and_non_relative_keys_are_rejected() {
    for path in [
        "../secret",
        "/etc/passwd",
        "a/../../b",
        "a\\b",
        "https://host/a",
        "C:/secret",
        "a\0b",
        "a//b",
        "a/./b",
    ] {
        assert_eq!(
            validate_key(path).unwrap_err().code,
            "model:unsafe_path",
            "{path}"
        );
    }
    validate_key("textures/中文 name.png").unwrap();
}

#[test]
fn closing_is_idempotent_and_does_not_delete_files() {
    let fixture = Fixture::new();
    let service = ModelViewerService::default();
    let session = service.open(&fixture.0.join("model.gltf")).unwrap();
    let in_flight = service.resource(&session.id, "").unwrap();
    service.close(&session.id).unwrap();
    service.close(&session.id).unwrap();
    assert_eq!(
        service.read(&session.id, "", 0, 4).unwrap_err().code,
        "model:session_closed"
    );
    assert_eq!(in_flight.size, 4);
    assert!(fixture.0.join("model.gltf").is_file());
}

#[test]
fn read_ranges_and_special_files_are_bounded() {
    let fixture = Fixture::new();
    let service = ModelViewerService::default();
    let session = service.open(&fixture.0.join("model.gltf")).unwrap();
    assert!(service
        .read(&session.id, "", 0, MAX_CHUNK_SIZE + 1)
        .is_err());
    assert!(service.read(&session.id, "", 5, 1).is_err());
    assert!(service.read(&session.id, "", 0, 0).is_err());
    assert_eq!(service.read(&session.id, "", 3, 10).unwrap(), b" ");
    assert!(open_resource(&fixture.0).is_err());
}

#[test]
fn fbx_import_preserves_explicit_resource_authorization() {
    let fixture = Fixture::new();
    let path = fixture.0.join("model.FBX");
    std::fs::write(&path, b"FBX fixture").unwrap();
    let service = ModelViewerService::default();
    let session = service.open(&path).unwrap();
    assert_eq!(session.name, "model.FBX");
    assert_eq!(service.read(&session.id, "", 0, 3).unwrap(), b"FBX");
    assert_eq!(
        service.size(&session.id, "texture.bin").unwrap_err().code,
        "model:resource_missing"
    );
    service
        .attach(
            &session.id,
            "textures/paint.png".into(),
            &fixture.0.join("texture.bin"),
        )
        .unwrap();
    assert_eq!(
        service
            .read(&session.id, "textures/paint.png", 0, 3)
            .unwrap(),
        b"abc"
    );
    service.close(&session.id).unwrap();
    assert!(path.is_file());
    assert!(service.open(&fixture.0.join("texture.bin")).is_err());
}
