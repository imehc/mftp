use super::DirectoryTransferMode;

#[test]
fn directory_transfer_mode_only_accepts_supported_values() {
    assert_eq!(
        serde_json::from_str::<DirectoryTransferMode>("\"archive\"").unwrap(),
        DirectoryTransferMode::Archive
    );
    assert_eq!(
        serde_json::from_str::<DirectoryTransferMode>("\"direct\"").unwrap(),
        DirectoryTransferMode::Direct
    );
    assert!(serde_json::from_str::<DirectoryTransferMode>("\"rsync\"").is_err());
    assert!(serde_json::from_str::<DirectoryTransferMode>("\"unknown\"").is_err());
    assert_eq!(
        DirectoryTransferMode::from_option(None),
        DirectoryTransferMode::Archive
    );
}
