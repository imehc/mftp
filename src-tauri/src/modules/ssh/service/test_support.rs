use super::{AuthMaterial, AuthMethod, Manager};
use std::{path::PathBuf, sync::Arc};

pub(super) struct Fixture {
    pub(super) root: PathBuf,
    pub(super) manager: Arc<Manager>,
}

impl Fixture {
    pub(super) fn new() -> Self {
        let root = std::env::temp_dir().join(format!("ssh-lifecycle-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        Self {
            manager: Arc::new(Manager::new(root.join("journal.json"))),
            root,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

pub(super) fn material() -> AuthMaterial {
    AuthMaterial {
        host: "unused.invalid".into(),
        port: 22,
        username: "test".into(),
        method: AuthMethod::Password(None),
        identity_files: Vec::new(),
    }
}
