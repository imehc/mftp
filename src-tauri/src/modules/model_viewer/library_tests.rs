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
        layout: ModelLayout::Row,
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
            "UPDATE app_meta SET value = '99' WHERE key = 'model_viewer_schema_version'",
            [],
        )
        .unwrap();
    assert!(Storage::new(f.root.clone()).is_err());
}

#[test]
fn reset_is_atomic_preserves_schema_and_cannot_resurrect_pending_import() {
    let f = Fixture::new();
    let id = f.saved();
    let attachment = f.repo.add_attachment(&id, "notes.txt", b"kept").unwrap();
    let draft = f.repo.begin(input()).unwrap();
    let conn = f.repo.storage.conn().unwrap();
    conn.execute_batch(
        "CREATE TRIGGER reject_library_delete BEFORE DELETE ON model_library
        BEGIN SELECT RAISE(ABORT, 'test reset failure'); END;",
    )
    .unwrap();
    assert!(f.repo.storage.reset_database().is_err());
    assert_eq!(f.repo.read(&id, "", 0).unwrap(), b"glTF");
    assert_eq!(f.repo.read_attachment(&id, &attachment).unwrap(), b"kept");
    conn.execute_batch("DROP TRIGGER reject_library_delete")
        .unwrap();
    f.repo.storage.reset_database().unwrap();
    assert!(f.repo.write(&draft, "", 0, b"glTF").is_err());
    assert!(f.repo.save_view(&id, view()).is_err());
    let reopened = ModelLibraryRepository::new(Storage::new(f.root.clone()).unwrap());
    assert!(reopened.read_attachment(&id, &attachment).is_err());
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM model_attachments", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
    assert!(reopened.catalog().unwrap().entries.is_empty());
    let version: String = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'model_viewer_schema_version'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(version, "3");
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

#[test]
fn attachments_preserve_bytes_and_are_not_thumbnail_cache() {
    let fixture = Fixture::new();
    let model = fixture.saved();
    let data = b"# Notes\n<script>alert(1)</script>";
    let id = fixture
        .repo
        .add_attachment(&model, "notes.md", data)
        .unwrap();
    assert_eq!(
        fixture.repo.attachments(&model).unwrap()[0].size,
        data.len() as u32
    );
    assert_eq!(
        fixture.repo.catalog().unwrap().library_bytes,
        (7 + data.len()) as f64
    );
    fixture.repo.configure_cache(0, true).unwrap();
    assert_eq!(fixture.repo.read_attachment(&model, &id).unwrap(), data);
    let other = fixture.saved();
    assert!(fixture.repo.read_attachment(&other, &id).is_err());
    assert!(fixture.repo.delete_attachment(&other, &id).is_err());
    assert!(fixture
        .repo
        .add_attachment(&model, "notes.md", b"overwrite")
        .is_err());
    fixture.repo.delete(&model, false).unwrap();
    assert!(fixture.repo.read_attachment(&model, &id).is_err());
    let count: i64 = fixture
        .repo
        .storage
        .conn()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM model_attachments", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn attachments_reject_invalid_content_and_enforce_limits_atomically() {
    let fixture = Fixture::new();
    let model = fixture.saved();
    for (name, bytes) in [
        ("x.html", b"html".as_slice()),
        ("../x.txt", b"text"),
        ("x.txt", b"\xff"),
        ("x.md", b"\0"),
        ("x.pdf", b"not pdf"),
        ("x.txt", b""),
    ] {
        assert!(fixture.repo.add_attachment(&model, name, bytes).is_err());
    }
    assert!(fixture
        .repo
        .add_attachment(&model, "large.txt", &vec![b'a'; 1024 * 1024 + 1])
        .is_err());
    assert!(fixture
        .repo
        .add_attachment("missing", "notes.txt", b"notes")
        .is_err());
    assert!(fixture.repo.attachments(&model).unwrap().is_empty());
    for i in 0..16 {
        fixture
            .repo
            .add_attachment(&model, &format!("{i}.txt"), b"ok")
            .unwrap();
    }
    assert_eq!(
        fixture
            .repo
            .add_attachment(&model, "17.txt", b"ok")
            .unwrap_err()
            .code,
        "model:attachment_capacity"
    );
    let second = fixture.saved();
    let mut pdf = vec![b' '; 8 * 1024 * 1024];
    pdf[..5].copy_from_slice(b"%PDF-");
    for i in 0..4 {
        fixture
            .repo
            .add_attachment(&second, &format!("{i}.pdf"), &pdf)
            .unwrap();
    }
    assert_eq!(
        fixture
            .repo
            .add_attachment(&second, "extra.txt", b"ok")
            .unwrap_err()
            .code,
        "model:attachment_capacity"
    );
    assert_eq!(fixture.repo.attachments(&second).unwrap().len(), 4);
}

#[test]
fn attachment_migration_preserves_v1_models_and_is_idempotent() {
    let fixture = Fixture::new();
    let id = fixture.saved();
    let mut conn = fixture.repo.storage.conn().unwrap();
    conn.execute_batch("DROP TABLE model_environment_chunks; DROP TABLE model_environment; DROP TABLE model_attachments; UPDATE app_meta SET value = '1' WHERE key = 'model_viewer_schema_version';").unwrap();
    super::super::schema::init(&mut conn).unwrap();
    super::super::schema::init(&mut conn).unwrap();
    drop(conn);
    assert_eq!(fixture.repo.read(&id, "", 0).unwrap(), b"glTF");
    let attachment = fixture
        .repo
        .add_attachment(&id, "kept.txt", b"kept")
        .unwrap();
    super::super::schema::init(&mut fixture.repo.storage.conn().unwrap()).unwrap();
    assert_eq!(
        fixture.repo.read_attachment(&id, &attachment).unwrap(),
        b"kept"
    );
}

#[test]
fn saved_layouts_roundtrip_without_losing_manual_positions() {
    for layout in [ModelLayout::Row, ModelLayout::Grid, ModelLayout::Ring] {
        let f = Fixture::new();
        let id = f.saved();
        let mut state = view();
        state.layout = layout;
        state.position = [4., 1., 2.];
        f.repo.save_view(&id, state).unwrap();
        let reopened = ModelLibraryRepository::new(Storage::new(f.root.clone()).unwrap());
        let actual = reopened.document(&id).unwrap().view;
        assert_eq!(actual.layout, layout);
        assert_eq!(actual.position, [4., 1., 2.]);
    }
}

#[test]
fn legacy_layout_defaults_to_row_and_unknown_layout_does_not_destroy_data() {
    let f = Fixture::new();
    let id = f.saved();
    let mut legacy = serde_json::to_value(view()).unwrap();
    legacy.as_object_mut().unwrap().remove("layout");
    for (value, valid) in [
        (legacy.clone(), true),
        (
            {
                legacy["layout"] = serde_json::json!("spiral");
                legacy
            },
            false,
        ),
    ] {
        let raw = serde_json::to_string(&value).unwrap();
        f.repo
            .storage
            .conn()
            .unwrap()
            .execute(
                "UPDATE model_library SET view_json = ?1 WHERE id = ?2",
                [&raw, &id],
            )
            .unwrap();
        let result = f.repo.document(&id);
        if valid {
            assert_eq!(result.unwrap().view.layout, ModelLayout::Row);
        } else {
            assert!(result.is_err());
        }
        let stored: String = f
            .repo
            .storage
            .conn()
            .unwrap()
            .query_row(
                "SELECT view_json FROM model_library WHERE id = ?1",
                [&id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, raw);
        assert_eq!(f.repo.read(&id, "", 0).unwrap(), b"glTF");
    }
}
