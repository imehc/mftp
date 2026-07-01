use crate::error::{AppError, AppResult};
use crate::models::{Host, HostInput, SshKey};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// On-disk layout under the app data dir:
///   hosts.json           Vec<Host>
///   keys.json            Vec<SshKey>
///   keys/<filename>      raw private key files
pub struct Storage {
    root: PathBuf,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl Storage {
    pub fn new(root: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&root)?;
        fs::create_dir_all(root.join("keys"))?;
        Ok(Storage { root })
    }

    fn hosts_file(&self) -> PathBuf {
        self.root.join("hosts.json")
    }
    fn keys_file(&self) -> PathBuf {
        self.root.join("keys.json")
    }
    pub fn keys_dir(&self) -> PathBuf {
        self.root.join("keys")
    }

    fn read_json<T: serde::de::DeserializeOwned + Default>(path: &Path) -> AppResult<T> {
        if !path.exists() {
            return Ok(T::default());
        }
        let raw = fs::read_to_string(path)?;
        if raw.trim().is_empty() {
            return Ok(T::default());
        }
        Ok(serde_json::from_str(&raw)?)
    }

    fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> AppResult<()> {
        let raw = serde_json::to_string_pretty(value)?;
        // Write to a temp file then rename for atomicity.
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, raw)?;
        fs::rename(&tmp, path)?;
        Ok(())
    }

    // ---- Hosts ----

    pub fn list_hosts(&self) -> AppResult<Vec<Host>> {
        Self::read_json(&self.hosts_file())
    }

    pub fn get_host(&self, id: &str) -> AppResult<Host> {
        self.list_hosts()?
            .into_iter()
            .find(|h| h.id == id)
            .ok_or_else(|| AppError(format!("host not found: {id}")))
    }

    pub fn create_host(&self, input: HostInput) -> AppResult<Host> {
        let mut hosts = self.list_hosts()?;
        let ts = now_ms();
        let host = Host {
            id: uuid::Uuid::new_v4().to_string(),
            label: input.label,
            host: input.host,
            port: input.port,
            username: input.username,
            auth_type: input.auth_type,
            password: input.password,
            key_id: input.key_id,
            created_at: ts,
            updated_at: ts,
        };
        hosts.push(host.clone());
        Self::write_json(&self.hosts_file(), &hosts)?;
        Ok(host)
    }

    pub fn update_host(&self, id: &str, input: HostInput) -> AppResult<Host> {
        let mut hosts = self.list_hosts()?;
        let h = hosts
            .iter_mut()
            .find(|h| h.id == id)
            .ok_or_else(|| AppError(format!("host not found: {id}")))?;
        h.label = input.label;
        h.host = input.host;
        h.port = input.port;
        h.username = input.username;
        h.auth_type = input.auth_type;
        h.password = input.password;
        h.key_id = input.key_id;
        h.updated_at = now_ms();
        let updated = h.clone();
        Self::write_json(&self.hosts_file(), &hosts)?;
        Ok(updated)
    }

    pub fn delete_host(&self, id: &str) -> AppResult<()> {
        let mut hosts = self.list_hosts()?;
        hosts.retain(|h| h.id != id);
        Self::write_json(&self.hosts_file(), &hosts)
    }

    // ---- Keys ----

    pub fn list_keys(&self) -> AppResult<Vec<SshKey>> {
        Self::read_json(&self.keys_file())
    }

    pub fn get_key(&self, id: &str) -> AppResult<SshKey> {
        self.list_keys()?
            .into_iter()
            .find(|k| k.id == id)
            .ok_or_else(|| AppError(format!("key not found: {id}")))
    }

    /// Path to the private key file for a given key id.
    pub fn key_path(&self, id: &str) -> AppResult<PathBuf> {
        let key = self.get_key(id)?;
        Ok(self.keys_dir().join(key.filename))
    }

    /// Import a private key: copy contents into keys/ and record metadata.
    pub fn import_key(
        &self,
        label: String,
        source_path: &str,
        has_passphrase: bool,
    ) -> AppResult<SshKey> {
        let contents = fs::read(source_path)?;
        let id = uuid::Uuid::new_v4().to_string();
        let orig_name = Path::new(source_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("id_key");
        // Prefix with id to avoid collisions.
        let filename = format!("{id}_{orig_name}");
        let dest = self.keys_dir().join(&filename);
        fs::write(&dest, &contents)?;
        restrict_permissions(&dest);

        let mut keys = self.list_keys()?;
        let key = SshKey {
            id,
            label,
            filename,
            has_passphrase,
            created_at: now_ms(),
        };
        keys.push(key.clone());
        Self::write_json(&self.keys_file(), &keys)?;
        Ok(key)
    }

    pub fn delete_key(&self, id: &str) -> AppResult<()> {
        let mut keys = self.list_keys()?;
        if let Some(k) = keys.iter().find(|k| k.id == id) {
            let _ = fs::remove_file(self.keys_dir().join(&k.filename));
        }
        keys.retain(|k| k.id != id);
        Self::write_json(&self.keys_file(), &keys)
    }
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}
