use super::types::{AuthMaterial, AuthMethod, Manager};
use crate::core::activity::OperationContext;
use crate::core::diagnostics::{context, DiagnosticRecorder, Redactor};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};

/// Transfer-to-session correlation for the shared activity panel. The panel
/// itself is process-wide, so a connection only needs to remember which
/// session owns a transfer id to resolve that transfer's credentials.
#[derive(Default)]
pub(super) struct ConnectionLogs {
    pub(super) transfers: Mutex<HashMap<String, String>>,
}

pub(crate) struct TransferLogLease {
    id: String,
    logs: Arc<ConnectionLogs>,
}

impl Drop for TransferLogLease {
    fn drop(&mut self) {
        self.logs.transfers.lock().remove(&self.id);
    }
}

impl Manager {
    pub(crate) fn error_redactor(&self, address: &str) -> Redactor {
        let session_id = self.logs.transfers.lock().get(address).cloned();
        let mut redactor = Redactor::default();
        if let Ok(material) = self.material(session_id.as_deref().unwrap_or(address)) {
            register_secrets(|secret| redactor.add_secret(secret), &material);
        }
        redactor
    }

    pub(crate) fn diagnostic(
        &self,
        activity: &OperationContext,
        transfer_id: Option<&str>,
    ) -> (Option<DiagnosticRecorder>, Option<TransferLogLease>) {
        let Some(mut log) =
            self.diagnostics
                .begin(activity.source, activity.action, &activity.address)
        else {
            return (None, None);
        };
        if let Ok(material) = self.material(&activity.address) {
            register_secrets(|secret| log.add_secret(secret), &material);
            log.target(&format!(
                "{}@{}:{}",
                material.username, material.host, material.port
            ));
        }
        let known_transfer = self.logs.transfers.lock().contains_key(&activity.address);
        let correlation_id =
            transfer_id.or_else(|| known_transfer.then_some(activity.address.as_str()));
        let lease = transfer_id.map(|id| {
            log.correlation(id);
            self.logs
                .transfers
                .lock()
                .insert(id.into(), activity.address.clone());
            TransferLogLease {
                id: id.into(),
                logs: self.logs.clone(),
            }
        });
        if let Some(id) = correlation_id {
            log.correlation(id);
        }
        (Some(log), lease)
    }
}

fn register_secrets(mut add: impl FnMut(&str), material: &AuthMaterial) {
    match &material.method {
        AuthMethod::Password(Some(password)) => add(password),
        AuthMethod::Key {
            private_key,
            passphrase,
        } => {
            add(private_key);
            for line in private_key
                .lines()
                .filter(|line| !line.starts_with("-----"))
            {
                add(line);
            }
            if let Some(passphrase) = passphrase {
                add(passphrase);
            }
        }
        AuthMethod::Password(None) => {}
    }
}

pub(super) fn path(path: &Path) -> Value {
    match path.to_str() {
        Some(path) => json!(path),
        None => context::record(|log| json!(log.safe_bytes(path.as_os_str().as_encoded_bytes())))
            .unwrap_or(Value::Null),
    }
}

pub(super) fn stat(stat: &ssh2::FileStat) -> Value {
    json!({"size":stat.size,"uid":stat.uid,"gid":stat.gid,"permissions":stat.perm,"atime":stat.atime,"mtime":stat.mtime})
}

pub(super) trait ProtocolError: std::fmt::Display {
    fn diagnostic(&self) -> Value;
}

impl ProtocolError for ssh2::Error {
    fn diagnostic(&self) -> Value {
        let (domain, code) = match self.code() {
            ssh2::ErrorCode::Session(code) => ("session", code),
            ssh2::ErrorCode::SFTP(code) => ("sftp", code),
        };
        json!({"domain":domain,"code":code,"message":self.message()})
    }
}

impl ProtocolError for std::io::Error {
    fn diagnostic(&self) -> Value {
        json!({"domain":"io","kind":format!("{:?}",self.kind()),"code":self.raw_os_error(),"message":self.to_string()})
    }
}

pub(super) fn call<T, E: ProtocolError>(
    method: &str,
    params: Value,
    operation: impl FnOnce() -> Result<T, E>,
    describe: impl FnOnce(&T) -> Value,
) -> Result<T, E> {
    static SEQUENCE: AtomicU32 = AtomicU32::new(0);
    let id = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    context::event(&json!({"event":"call","id":id,"method":method,"parameters":params}));
    let result = operation();
    if context::record(|_| ()).is_some() {
        let event = match &result {
            Ok(value) => json!({"event":"return","id":id,"value":describe(value)}),
            Err(error) => json!({"event":"error","id":id,"error":error.diagnostic()}),
        };
        context::event(&event);
    }
    result
}

pub(super) fn unit<T>(_: &T) -> Value {
    json!({"accepted":true})
}

#[cfg(test)]
#[path = "diagnostics_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "diagnostics_network_tests.rs"]
mod network_tests;
