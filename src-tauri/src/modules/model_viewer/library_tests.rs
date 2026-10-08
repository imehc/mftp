use super::*;
use std::path::PathBuf;

struct Fixture {
    root: PathBuf,
    repo: ModelLibraryRepository,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("model-library-{}", uuid::Uuid::new_v4()));
        let repo = ModelLibraryRepository::new(Storage::new(root.clone()).unwrap());
        Self { root, repo }
    }
    fn saved(&self) -> String {
        let id = self.repo.begin(input()).unwrap();
        self.repo.write(&id, "", 0, b"glTF").unwrap();
        self.repo.write(&id, "textures/a b.png", 0, b"png").unwrap();
        self.repo.commit(&id).unwrap();
        id
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}
fn view() -> ModelViewState {
    ModelViewState {
        version: 1,
        camera: ModelCameraState {
            position: [2., 3., 4.],
            target: [0.; 3],
            near: 0.01,
            far: 1000.,
        },
        views: vec![],
        animation: ModelPlaybackState {
            selected: 0,
            time: 0.5,
            phase: 1.5,
            playing: true,
            speed: 1.,
            loop_mode: "pingpong".into(),
        },
        position: [0.; 3],
        visible: true,
        unit: "m".into(),
        wireframe: false,
        normals: false,
        shadows: true,
        auto_rotate: false,
    }
}
fn input() -> ModelLibraryInput {
    ModelLibraryInput {
        name: "model.gltf".into(),
        view: view(),
        resources: vec![
            ModelLibraryResource {
                key: "".into(),
                size: 4,
            },
            ModelLibraryResource {
                key: "textures/a b.png".into(),
                size: 3,
            },
        ],
    }
}
fn png() -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR".to_vec();
    bytes.extend(1_u32.to_be_bytes());
    bytes.extend(1_u32.to_be_bytes());
    bytes
}

#[test]
fn publication_requires_complete_contiguous_resources_and_rejects_replay() {
    let f = Fixture::new();
    let id = f.repo.begin(input()).unwrap();
    assert!(f.repo.catalog().unwrap().entries.is_empty());
    assert!(f.repo.commit(&id).is_err());
    assert!(f.repo.write(&id, "", 1, b"glTF").is_err());
    assert!(f.repo.write(&id, "", 0, b"gl").is_err());
    f.repo.write(&id, "", 0, b"glTF").unwrap();
    assert!(f.repo.write(&id, "", 0, b"glTF").is_err());
    assert!(f.repo.commit(&id).is_err());
    f.repo.write(&id, "textures/a b.png", 0, b"png").unwrap();
    f.repo.commit(&id).unwrap();
    assert!(f.repo.write(&id, "", 0, b"glTF").is_err());
    f.repo.delete(&id, true).unwrap();
    assert_eq!(f.repo.read(&id, "textures/a b.png", 0).unwrap(), b"png");
}

#[test]
fn reopening_preserves_library_views_and_removes_only_unpublished_drafts() {
    let f = Fixture::new();
    let id = f.saved();
    let draft = f.repo.begin(input()).unwrap();
    f.repo.save_view(&id, view()).unwrap();
    f.repo
        .edit(
            &id,
            ModelLibraryEdit {
                name: "New name".into(),
                favorite: true,
                group: "Buildings".into(),
            },
        )
        .unwrap();
    let reopened = ModelLibraryRepository::new(Storage::new(f.root.clone()).unwrap());
    let catalog = reopened.catalog().unwrap();
    assert_eq!(catalog.entries.len(), 1);
    assert_eq!(catalog.entries[0].name, "New name");
    assert_eq!(catalog.entries[0].group, "Buildings");
    assert!(catalog.entries[0].favorite);
    assert_eq!(catalog.last_id.as_deref(), Some(id.as_str()));
    let document = reopened.document(&id).unwrap();
    assert_eq!(document.source_name, "model.gltf");
    assert_eq!(document.resources.len(), 2);
    assert_eq!(document.view.animation.phase, 1.5);
    assert!(reopened.write(&draft, "", 0, b"glTF").is_err());
}

#[test]
fn cache_limits_and_clear_never_remove_originals_or_last_view() {
    let f = Fixture::new();
    let id = f.saved();
    f.repo.save_view(&id, view()).unwrap();
    f.repo.thumbnail(&id, &png()).unwrap();
    assert_eq!(f.repo.catalog().unwrap().cache_bytes, 24.);
    assert!(f.repo.catalog().unwrap().entries[0].has_thumbnail);
    f.repo.configure_cache(0, false).unwrap();
    assert_eq!(f.repo.catalog().unwrap().cache_bytes, 0.);
    assert_eq!(f.repo.catalog().unwrap().library_bytes, 7.);
    assert_eq!(f.repo.read(&id, "", 0).unwrap(), b"glTF");
    assert_eq!(f.repo.catalog().unwrap().last_id, Some(id));
}

#[test]
fn delete_cascades_internal_data_and_preserves_external_source() {
    let f = Fixture::new();
    let source = f.root.join("external.gltf");
    std::fs::write(&source, "user data").unwrap();
    let id = f.saved();
    f.repo.save_view(&id, view()).unwrap();
    f.repo.thumbnail(&id, &png()).unwrap();
    f.repo.delete(&id, false).unwrap();
    let catalog = f.repo.catalog().unwrap();
    assert!(catalog.entries.is_empty());
    assert!(catalog.last_id.is_none());
    assert_eq!(catalog.cache_bytes, 0.);
    assert_eq!(std::fs::read_to_string(&source).unwrap(), "user data");
    let chunks: i64 = f
        .repo
        .storage
        .conn()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM model_chunks", [], |r| r.get(0))
        .unwrap();
    assert_eq!(chunks, 0);
}

#[test]
fn malformed_manifest_camera_and_future_version_are_rejected() {
    let f = Fixture::new();
    let mut bad = input();
    bad.resources[1].key = "../secret".into();
    assert!(f.repo.begin(bad).is_err());
    let mut bad = input();
    bad.resources[1].key = "".into();
    assert!(f.repo.begin(bad).is_err());
    let mut bad = input();
    bad.view.camera.near = f64::NAN;
    assert!(f.repo.begin(bad).is_err());
    let mut bad = input();
    bad.view.version = 2;
    assert_eq!(f.repo.begin(bad).unwrap_err().code, "model:library_version");
    f.repo
        .storage
        .conn()
        .unwrap()
        .execute(
            "UPDATE app_meta SET value = '2' WHERE key = 'model_viewer_schema_version'",
            [],
        )
        .unwrap();
    assert!(Storage::new(f.root.clone()).is_err());
}

#[test]
fn reset_is_atomic_preserves_schema_and_cannot_resurrect_pending_import() {
    let f = Fixture::new();
    let id = f.saved();
    let draft = f.repo.begin(input()).unwrap();
    let conn = f.repo.storage.conn().unwrap();
    conn.execute_batch(
        "CREATE TRIGGER reject_library_delete BEFORE DELETE ON model_library
        BEGIN SELECT RAISE(ABORT, 'test reset failure'); END;",
    )
    .unwrap();
    assert!(f.repo.storage.reset_database().is_err());
    assert_eq!(f.repo.read(&id, "", 0).unwrap(), b"glTF");
    conn.execute_batch("DROP TRIGGER reject_library_delete")
        .unwrap();
    f.repo.storage.reset_database().unwrap();
    assert!(f.repo.write(&draft, "", 0, b"glTF").is_err());
    assert!(f.repo.save_view(&id, view()).is_err());
    let reopened = ModelLibraryRepository::new(Storage::new(f.root.clone()).unwrap());
    assert!(reopened.catalog().unwrap().entries.is_empty());
    let version: String = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'model_viewer_schema_version'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(version, "1");
}

#[test]
fn multiple_chunks_roundtrip_without_overreading() {
    let f = Fixture::new();
    let mut input = input();
    input.resources[0].size = CHUNK as u32 + 1;
    let id = f.repo.begin(input).unwrap();
    let bytes = vec![42; CHUNK];
    f.repo.write(&id, "", 0, &bytes).unwrap();
    f.repo.write(&id, "", CHUNK as u32, &[43]).unwrap();
    f.repo.write(&id, "textures/a b.png", 0, b"png").unwrap();
    f.repo.commit(&id).unwrap();
    assert_eq!(f.repo.read(&id, "", 0).unwrap(), bytes);
    assert_eq!(f.repo.read(&id, "", CHUNK as u32).unwrap(), [43]);
    assert!(f.repo.read(&id, "", 1).is_err());
}
