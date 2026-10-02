use super::*;
use crate::models::{ExportSection, ImportMode};
use serde_json::{json, Value};
use std::path::PathBuf;

struct Fixture {
    storage: Storage,
    repository: LanRepository,
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("mftp-lan-repository-{}", uuid::Uuid::new_v4()));
        let storage = Storage::new(root.clone()).unwrap();
        Self {
            repository: LanRepository::new(storage.clone()),
            storage,
            root,
        }
    }

    fn seed(&self) -> LanExportData {
        let mut settings = default_lan_transfer_settings();
        settings.device_name = "Custom O'Brien device".into();
        settings.port = 3107;
        settings.bind_host = "192.168.1.8".into();
        settings.download_dir = self.root.join("user-files").to_string_lossy().into();
        settings.auto_start = true;
        settings.security_mode = "confirm".into();
        settings.default_permission = "uploadOnly".into();
        settings.max_concurrent_transfers = 5;
        self.repository.save_settings(settings).unwrap();
        self.repository
            .add_shared_dir(LanSharedDirInput {
                name: "O'Brien photos".into(),
                path: self.root.join("shared").to_string_lossy().into(),
            })
            .unwrap();
        self.repository
            .add_trusted_device(LanTrustedDeviceInput {
                label: "Friend's phone".into(),
                ip: "192.168.1.9".into(),
            })
            .unwrap();
        self.repository.export().unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn repository_reopens_existing_data_and_deletes_only_requested_records() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    let reopened = LanRepository::new(Storage::new(fixture.root.clone()).unwrap());
    assert_eq!(json!(reopened.export().unwrap()), json!(original));
    let share = &original.shared_dirs[0];
    std::fs::create_dir_all(&share.path).unwrap();
    let user_file = PathBuf::from(&share.path).join("keep.txt");
    std::fs::write(&user_file, b"keep").unwrap();
    reopened.delete_shared_dir(&share.id).unwrap();
    reopened.delete_shared_dir(&share.id).unwrap();
    assert!(reopened.shared_dirs().unwrap().is_empty());
    assert_eq!(reopened.trusted_devices().unwrap().len(), 1);
    reopened
        .delete_trusted_device(&original.trusted_devices[0].id)
        .unwrap();
    reopened
        .delete_trusted_device(&original.trusted_devices[0].id)
        .unwrap();
    assert!(reopened.trusted_devices().unwrap().is_empty());
    assert_eq!(
        json!(reopened.settings().unwrap()),
        json!(original.settings)
    );
    assert_eq!(std::fs::read(user_file).unwrap(), b"keep");
}

#[test]
fn resolved_device_name_reads_are_idempotent_without_rewriting_other_settings() {
    let fixture = Fixture::new();
    let mut settings = fixture.seed().settings;
    settings.device_name = "MFTP".into();
    let saved = fixture.repository.save_settings(settings).unwrap();
    assert!(!saved.device_name.is_empty());
    fixture
        .storage
        .conn()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER reject_redundant_settings_update BEFORE UPDATE ON lan_transfer_settings
         BEGIN SELECT RAISE(ABORT, 'unexpected settings rewrite'); END;",
        )
        .unwrap();
    for _ in 0..3 {
        assert_eq!(json!(fixture.repository.settings().unwrap()), json!(saved));
    }
}

#[test]
fn all_import_modes_preserve_the_existing_lan_export_contract() {
    let source = Fixture::new();
    let original = source.seed();
    let raw = source
        .storage
        .export_document(&[ExportSection::Lan], None)
        .unwrap();
    let doc: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(doc["format"], 1);
    assert_eq!(doc["sections"]["lan"], json!(original));
    let target = Fixture::new();
    for mode in [ImportMode::Overwrite, ImportMode::Merge] {
        let report = target.storage.import_document(&raw, None, mode).unwrap();
        assert_eq!(report.sections[0].section, ExportSection::Lan);
        assert_eq!(json!(target.repository.export().unwrap()), json!(original));
    }
    let report = target
        .storage
        .import_document(&raw, None, ImportMode::Append)
        .unwrap();
    assert_eq!(report.sections[0].inserted, 2);
    let appended = target.repository.export().unwrap();
    assert_eq!(json!(appended.settings), json!(original.settings));
    assert_eq!(appended.shared_dirs.len(), 2);
    assert_ne!(appended.shared_dirs[0].id, appended.shared_dirs[1].id);
    assert_eq!(appended.trusted_devices.len(), 2);
    assert_ne!(
        appended.trusted_devices[0].id,
        appended.trusted_devices[1].id
    );
}

#[test]
fn failed_overwrite_import_rolls_back_all_lan_tables() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    let mut replacement = serde_json::to_value(&original).unwrap();
    replacement["settings"]["port"] = json!(4200);
    replacement["sharedDirs"][0]["name"] = json!("replacement");
    let raw = json!({"app":"mftp", "format":1, "sections":{"lan":replacement}}).to_string();
    fixture
        .storage
        .conn()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER reject_trusted_insert BEFORE INSERT ON lan_trusted_devices
         BEGIN SELECT RAISE(ABORT, 'reject imported device'); END;",
        )
        .unwrap();
    assert!(fixture
        .storage
        .import_document(&raw, None, ImportMode::Overwrite)
        .is_err());
    assert_eq!(json!(fixture.repository.export().unwrap()), json!(original));
}

#[test]
fn reset_preserves_user_files_and_repository_can_initialize_again() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    std::fs::create_dir_all(&original.settings.download_dir).unwrap();
    let user_file = PathBuf::from(&original.settings.download_dir).join("keep.bin");
    std::fs::write(&user_file, b"keep").unwrap();
    fixture.storage.reset_database().unwrap();
    assert!(fixture.repository.shared_dirs().unwrap().is_empty());
    assert!(fixture.repository.trusted_devices().unwrap().is_empty());
    let defaults = fixture.repository.settings().unwrap();
    assert!(!defaults.auto_start);
    assert_eq!(
        json!(fixture.repository.settings().unwrap()),
        json!(defaults)
    );
    assert_eq!(std::fs::read(user_file).unwrap(), b"keep");
}

#[test]
fn settings_initialization_waits_for_concurrent_save_without_overwriting_it() {
    let fixture = Fixture::new();
    let mut conn = fixture.storage.conn().unwrap();
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    let mut custom = default_lan_transfer_settings();
    custom.device_name = "Concurrently saved device".into();
    custom.port = 4102;
    let saved = persist_settings(&tx, custom).unwrap();
    let repository = fixture.repository.clone();
    let (send, receive) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || send.send(repository.settings()).unwrap());
    assert!(receive
        .recv_timeout(std::time::Duration::from_millis(50))
        .is_err());
    tx.commit().unwrap();
    let observed = receive
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap()
        .unwrap();
    reader.join().unwrap();
    assert_eq!(json!(observed), json!(saved));
    assert_eq!(json!(fixture.repository.settings().unwrap()), json!(saved));
}
