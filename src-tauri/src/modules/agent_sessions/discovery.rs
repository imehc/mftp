use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use super::codebuddy::{self, Metadata};
use super::database;
use super::input;
use super::model::{SessionAgent, SessionIssue, SessionSource};
use super::reader::Reader;
use crate::error::{AppError, AppResult, CustomErrorCode};

pub(super) const MAX_ISSUES: usize = 50;
const MAX_CANDIDATES: usize = 10_000;

#[derive(Clone)]
pub(super) struct Candidate {
    pub agent: SessionAgent,
    pub path: PathBuf,
    pub id: Option<String>,
    pub archived: bool,
    pub codebuddy: Option<Metadata>,
}

impl Candidate {
    pub fn key(&self) -> String {
        let mut hash = Sha256::new();
        hash.update(self.path.as_os_str().as_encoded_bytes());
        if let Some(id) = &self.id {
            hash.update([0]);
            hash.update(id.as_bytes());
        }
        format!(
            "{}:{}",
            self.agent.slug(),
            super::revision::hex(&hash.finalize())
        )
    }
}

#[derive(Default)]
pub(super) struct Discovery {
    pub candidates: Vec<Candidate>,
    pub sources: Vec<SessionSource>,
    pub issues: Vec<SessionIssue>,
}

pub(super) fn issue(
    issues: &mut Vec<SessionIssue>,
    agent: SessionAgent,
    path: &Path,
    error: AppError,
) {
    if issues.len() < MAX_ISSUES {
        issues.push(SessionIssue {
            agent,
            path: path.to_string_lossy().into_owned(),
            error,
        });
    }
}

fn roots(home: &Path) -> Vec<(SessionAgent, PathBuf, bool)> {
    let support = home.join("Library/Application Support");
    vec![
        (SessionAgent::Claude, home.join(".claude/projects"), false),
        (SessionAgent::Codex, home.join(".codex/sessions"), false),
        (
            SessionAgent::Codex,
            home.join(".codex/archived_sessions"),
            true,
        ),
        (
            SessionAgent::Workbuddy,
            home.join(".workbuddy/projects"),
            false,
        ),
        (
            SessionAgent::Opencode,
            home.join(".local/share/opencode/opencode.db"),
            false,
        ),
        (
            SessionAgent::Copilot,
            support.join("Code/User/workspaceStorage"),
            false,
        ),
        (
            SessionAgent::Copilot,
            support.join("Code/User/globalStorage/emptyWindowChatSessions"),
            false,
        ),
        (
            SessionAgent::Qoder,
            support.join("Qoder/SharedClientCache/cache/db/local.db"),
            false,
        ),
        (
            SessionAgent::Qoder,
            support.join("com.qodercn.app.stable/main.sqlite"),
            false,
        ),
        (
            SessionAgent::Codebuddy,
            support.join("CodeBuddy CN/codebuddy-sessions.vscdb"),
            false,
        ),
    ]
}

pub(super) fn discover(
    home: &Path,
    reader: &mut Reader,
    cancel: &AtomicBool,
) -> AppResult<Discovery> {
    let mut result = Discovery::default();
    let started = Instant::now();
    let mut seen = HashSet::new();
    for (agent, root, archived) in roots(home) {
        let available = root.try_exists()?;
        if let Some(source) = result
            .sources
            .iter_mut()
            .find(|source| source.agent == agent)
        {
            source.available |= available;
            if available {
                source.root.push('\n');
                source.root.push_str(&root.to_string_lossy());
            }
        } else {
            result.sources.push(SessionSource {
                agent,
                root: root.to_string_lossy().into_owned(),
                available,
                count: 0,
            });
        }
        if !available {
            continue;
        }
        let read = discover_root(
            home,
            agent,
            &root,
            archived,
            reader,
            cancel,
            &mut result,
            &started,
            &mut seen,
        );
        if let Err(error) = read {
            if error.code == CustomErrorCode::AgentSessionCancelled.as_str() {
                return Err(error);
            }
            issue(&mut result.issues, agent, &root, error);
        }
    }
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
fn discover_root(
    home: &Path,
    agent: SessionAgent,
    root: &Path,
    archived: bool,
    reader: &mut Reader,
    cancel: &AtomicBool,
    result: &mut Discovery,
    started: &Instant,
    seen: &mut HashSet<String>,
) -> AppResult<()> {
    let canonical_root = root.canonicalize()?;
    if matches!(agent, SessionAgent::Opencode | SessionAgent::Qoder) {
        let snapshot = reader.snapshot(&canonical_root, cancel)?;
        for id in database::sessions(snapshot.connection(), agent, cancel)? {
            check_budget(cancel, started, result.candidates.len())?;
            result.candidates.push(Candidate {
                agent,
                path: canonical_root.clone(),
                id: Some(id),
                archived,
                codebuddy: None,
            });
        }
        return Ok(());
    }
    let (walk_root, metadata) = if agent == SessionAgent::Codebuddy {
        let snapshot = reader.snapshot(&canonical_root, cancel)?;
        (
            home.join("Library/Application Support/CodeBuddyExtension/Data"),
            Some(codebuddy::metadata(
                snapshot.connection(),
                &canonical_root,
                snapshot.revision(),
                cancel,
            )?),
        )
    } else {
        (root.to_path_buf(), None)
    };
    let boundary = walk_root.canonicalize()?;
    let depth = match agent {
        SessionAgent::Codex => 4,
        SessionAgent::Copilot => 3,
        SessionAgent::Codebuddy => 10,
        _ => 2,
    };
    let mut matched = HashSet::new();
    for file in WalkDir::new(&walk_root)
        .max_depth(depth)
        .follow_links(false)
    {
        check_budget(cancel, started, result.candidates.len())?;
        let file = match file {
            Ok(file) => file,
            Err(err) => {
                issue(
                    &mut result.issues,
                    agent,
                    err.path().unwrap_or(&walk_root),
                    AppError::custom(CustomErrorCode::AgentSessionRead),
                );
                continue;
            }
        };
        if !file.file_type().is_file() {
            continue;
        }
        let path = file.path();
        let meta = if let Some(metadata) = &metadata {
            if path.file_name().is_none_or(|name| name != "index.json") {
                continue;
            }
            if path
                .ancestors()
                .nth(3)
                .and_then(Path::file_name)
                .is_none_or(|name| name != "history")
                || !path
                    .components()
                    .any(|part| part.as_os_str() == "CodeBuddyIDE")
            {
                continue;
            }
            let Some(id) = path
                .parent()
                .and_then(Path::file_name)
                .and_then(|name| name.to_str())
            else {
                continue;
            };
            let Some(meta) = metadata.get(id) else {
                match codebuddy::has_records(path, cancel) {
                    Ok(true) => issue(
                        &mut result.issues,
                        agent,
                        path,
                        AppError::custom(CustomErrorCode::AgentSessionMissing),
                    ),
                    Ok(false) => {}
                    Err(error) if error.code == CustomErrorCode::AgentSessionCancelled.as_str() => {
                        return Err(error)
                    }
                    Err(error) => issue(&mut result.issues, agent, path, error),
                }
                continue;
            };
            if meta.deleted {
                continue;
            }
            matched.insert(id.to_owned());
            Some(meta.clone())
        } else {
            if path.extension().is_none_or(|ext| ext != "jsonl")
                && !(agent == SessionAgent::Codex && input::is_compressed(path))
            {
                continue;
            }
            if agent == SessionAgent::Copilot
                && root
                    .file_name()
                    .is_some_and(|name| name == "workspaceStorage")
                && path
                    .parent()
                    .and_then(Path::file_name)
                    .is_none_or(|name| name != "chatSessions")
            {
                continue;
            }
            None
        };
        let canonical = path.canonicalize()?;
        if !canonical.starts_with(&boundary) {
            continue;
        }
        let candidate = Candidate {
            agent,
            path: canonical,
            id: meta.as_ref().map(|meta| meta.id.clone()),
            archived,
            codebuddy: meta,
        };
        if seen.insert(candidate.key()) {
            result.candidates.push(candidate);
        }
    }
    if let Some(metadata) = metadata {
        for (id, _) in metadata
            .iter()
            .filter(|(id, meta)| !meta.deleted && !matched.contains(*id))
        {
            issue(
                &mut result.issues,
                agent,
                &canonical_root,
                AppError::custom(CustomErrorCode::AgentSessionMissing)
                    .with_arg("sessionId", id.clone()),
            );
        }
    }
    Ok(())
}

fn check_budget(cancel: &AtomicBool, started: &Instant, count: usize) -> AppResult<()> {
    if cancel.load(Ordering::Acquire) {
        Err(AppError::custom(CustomErrorCode::AgentSessionCancelled))
    } else if count >= MAX_CANDIDATES || started.elapsed() > Duration::from_secs(45) {
        Err(AppError::custom(CustomErrorCode::AgentSessionLimit))
    } else {
        Ok(())
    }
}
