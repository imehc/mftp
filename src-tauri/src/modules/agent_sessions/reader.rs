use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use super::discovery::Candidate;
use super::images::NativeImage;
use super::model::{AgentSessionMessage, SessionAgent};
use super::revision::{self, compatible_revision, revision_length};
use super::sqlite_snapshot::{self, Snapshot};
use super::transcript::Transcript;
use super::{codebuddy, database, input, parser, vscode};
use crate::error::{AppError, AppResult, CustomErrorCode};

#[derive(Default)]
pub(super) struct Reader {
    snapshots: HashMap<PathBuf, Snapshot>,
}

impl Reader {
    pub fn snapshot(&mut self, path: &Path, cancel: &AtomicBool) -> AppResult<&Snapshot> {
        if !self.snapshots.contains_key(path) {
            self.snapshots
                .insert(path.to_path_buf(), Snapshot::open(path, cancel)?);
        }
        self.snapshots
            .get(path)
            .ok_or_else(|| AppError::custom(CustomErrorCode::AgentSessionRead))
    }

    pub fn visit(
        &mut self,
        resource: &Candidate,
        revision: &str,
        cancel: &AtomicBool,
        callback: impl FnMut(AgentSessionMessage, &[NativeImage<'_>]) -> AppResult<()>,
    ) -> AppResult<Transcript> {
        check_revision(resource, revision, cancel)?;
        let result = match resource.agent {
            SessionAgent::Claude | SessionAgent::Codex | SessionAgent::Workbuddy => {
                parser::visit_prefix(
                    &resource.path,
                    resource.agent,
                    cancel,
                    Some(revision_length(revision)?),
                    callback,
                )
            }
            SessionAgent::Copilot => vscode::visit(
                &resource.path,
                cancel,
                Some(revision_length(revision)?),
                callback,
            ),
            SessionAgent::Opencode | SessionAgent::Qoder => {
                let snapshot = self.snapshot(&resource.path, cancel)?;
                if snapshot.revision() != revision {
                    return Err(AppError::custom(CustomErrorCode::AgentSessionChanged));
                }
                let id = resource
                    .id
                    .as_deref()
                    .ok_or_else(|| AppError::custom(CustomErrorCode::AgentSessionMissing))?;
                database::visit(snapshot.connection(), resource.agent, id, cancel, callback)
            }
            SessionAgent::Codebuddy => {
                let metadata = resource
                    .codebuddy
                    .as_ref()
                    .ok_or_else(|| AppError::custom(CustomErrorCode::AgentSessionMissing))?;
                codebuddy::visit(&resource.path, metadata, cancel, callback)
            }
        };
        match result {
            Ok(transcript) => {
                check_revision(resource, revision, cancel)?;
                Ok(transcript)
            }
            Err(error) => {
                // A replacement can truncate the captured compressed prefix.
                // Prefer a proven generation change over a codec failure;
                // unrelated metadata errors must not hide the original error.
                if error.code != CustomErrorCode::AgentSessionCancelled.as_str() {
                    if let Err(changed) = check_revision(resource, revision, cancel) {
                        if changed.code == CustomErrorCode::AgentSessionChanged.as_str() {
                            return Err(changed);
                        }
                    }
                }
                Err(error)
            }
        }
    }
}

pub(super) fn fingerprint(resource: &Candidate, cancel: &AtomicBool) -> AppResult<(String, f64)> {
    match resource.agent {
        SessionAgent::Opencode | SessionAgent::Qoder => {
            sqlite_snapshot::fingerprint(&resource.path)
        }
        SessionAgent::Codebuddy => {
            let metadata = resource
                .codebuddy
                .as_ref()
                .ok_or_else(|| AppError::custom(CustomErrorCode::AgentSessionMissing))?;
            let (history, updated) = codebuddy::fingerprint(&resource.path, cancel)?;
            let database = sqlite_snapshot::fingerprint(&metadata.database)?.0;
            if database != metadata.revision {
                return Err(AppError::custom(CustomErrorCode::AgentSessionChanged));
            }
            Ok((
                format!("{history}/{database}"),
                metadata.updated.unwrap_or(updated),
            ))
        }
        _ => revision::fingerprint(&resource.path),
    }
}

fn check_revision(resource: &Candidate, original: &str, cancel: &AtomicBool) -> AppResult<()> {
    let current = fingerprint(resource, cancel)?.0;
    let compatible = match resource.agent {
        SessionAgent::Codex if input::is_compressed(&resource.path) => current == original,
        SessionAgent::Claude | SessionAgent::Codex | SessionAgent::Workbuddy => {
            compatible_revision(&current, original)
        }
        _ => current == original,
    };
    if compatible {
        Ok(())
    } else {
        Err(AppError::custom(CustomErrorCode::AgentSessionChanged))
    }
}
