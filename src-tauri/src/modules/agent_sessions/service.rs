use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;

use super::discovery::{self, issue, Candidate};
use super::model::*;
use super::reader::{self, Reader};
use super::text;
use crate::error::{AppError, AppResult, CustomErrorCode};

const MAX_JOB_TIME: Duration = Duration::from_secs(45);

#[derive(Clone)]
struct Entry {
    summary: AgentSessionSummary,
    complete: bool,
    has_records: bool,
    resource: Candidate,
}

#[derive(Default)]
struct Index {
    entries: Vec<Entry>,
    snapshot: Option<AgentSessionsSnapshot>,
}

pub(crate) struct AgentSessionService {
    home: PathBuf,
    index: Mutex<Index>,
    scan_gate: Mutex<()>,
    requests: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

pub(super) struct RequestGuard {
    service: Arc<AgentSessionService>,
    id: String,
    pub cancel: Arc<AtomicBool>,
}

impl Drop for RequestGuard {
    fn drop(&mut self) {
        self.service.requests.lock().remove(&self.id);
    }
}

fn error(code: CustomErrorCode) -> AppError {
    AppError::custom(code)
}

impl AgentSessionService {
    pub(crate) fn new(home: PathBuf) -> Self {
        Self {
            home,
            index: Mutex::new(Index::default()),
            scan_gate: Mutex::new(()),
            requests: Mutex::new(HashMap::new()),
        }
    }

    pub(super) fn begin(self: &Arc<Self>, id: String) -> AppResult<RequestGuard> {
        if id.is_empty() || id.len() > 100 {
            return Err(error(CustomErrorCode::AgentSessionInput));
        }
        let mut requests = self.requests.lock();
        if requests.len() >= 8 || requests.contains_key(&id) {
            return Err(error(CustomErrorCode::AgentSessionBusy));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        requests.insert(id.clone(), cancel.clone());
        Ok(RequestGuard {
            service: self.clone(),
            id,
            cancel,
        })
    }

    pub(crate) fn cancel(&self, id: &str) {
        if let Some(cancel) = self.requests.lock().get(id) {
            cancel.store(true, Ordering::Release);
        }
    }

    pub(crate) fn shutdown(&self) {
        for cancel in self.requests.lock().values() {
            cancel.store(true, Ordering::Release);
        }
    }

    pub(crate) fn is_busy(&self) -> AppResult<bool> {
        Ok(!self.requests.lock().is_empty())
    }

    pub(super) fn snapshot(
        &self,
        refresh: bool,
        cancel: &AtomicBool,
    ) -> AppResult<AgentSessionsSnapshot> {
        let _scan = self
            .scan_gate
            .try_lock()
            .ok_or_else(|| error(CustomErrorCode::AgentSessionBusy))?;
        let old = self.index.lock();
        if !refresh {
            if let Some(snapshot) = &old.snapshot {
                return Ok(snapshot.clone());
            }
        }
        let old_entries: HashMap<_, _> = old
            .entries
            .iter()
            .map(|entry| (entry.summary.key.clone(), entry.clone()))
            .collect();
        drop(old);
        let started = Instant::now();
        let mut reader = Reader::default();
        let found = discovery::discover(&self.home, &mut reader, cancel)?;
        let mut entries = Vec::new();
        let mut sources = found.sources;
        let mut issues = found.issues;
        let mut complete = issues.is_empty();
        for resource in found.candidates {
            if cancel.load(Ordering::Acquire) {
                return Err(error(CustomErrorCode::AgentSessionCancelled));
            }
            if started.elapsed() > MAX_JOB_TIME {
                complete = false;
                issue(
                    &mut issues,
                    resource.agent,
                    &resource.path,
                    error(CustomErrorCode::AgentSessionLimit),
                );
                break;
            }
            let key = resource.key();
            let result = reader::fingerprint(&resource, cancel).and_then(|(revision, updated)| {
                if let Some(old) = old_entries
                    .get(&key)
                    .filter(|old| old.summary.revision == revision && old.complete)
                {
                    return Ok(old.clone());
                }
                let transcript = reader.visit(&resource, &revision, cancel, |_, _| Ok(()))?;
                Ok(Entry {
                    complete: transcript.complete,
                    has_records: transcript.count > 0 || transcript.total > 0,
                    resource: resource.clone(),
                    summary: AgentSessionSummary {
                        key,
                        agent: resource.agent,
                        session_id: transcript.id,
                        title: transcript.title,
                        preview: transcript.preview,
                        cwd: text::safe_preview(&transcript.cwd),
                        path: resource.path.to_string_lossy().into_owned(),
                        updated_at: if matches!(
                            resource.agent,
                            SessionAgent::Opencode
                                | SessionAgent::Qoder
                                | SessionAgent::Codebuddy
                                | SessionAgent::Copilot
                        ) {
                            transcript.updated.unwrap_or(updated)
                        } else {
                            updated
                        },
                        created_at: transcript.created,
                        message_count: transcript.count,
                        revision,
                        match_index: None,
                        model: transcript.model,
                        archived: resource.archived || transcript.archived,
                        content_availability: transcript.content_availability,
                    },
                })
            });
            match result {
                Ok(entry) => {
                    if !entry.complete {
                        complete = false;
                        issue(
                            &mut issues,
                            resource.agent,
                            &resource.path,
                            error(CustomErrorCode::AgentSessionPartial),
                        );
                    }
                    if entry.has_records {
                        if let Some(source) = sources
                            .iter_mut()
                            .find(|source| source.agent == resource.agent)
                        {
                            source.count += 1;
                        }
                        entries.push(entry);
                    }
                }
                Err(err) if err.code == CustomErrorCode::AgentSessionCancelled.as_str() => {
                    return Err(err)
                }
                Err(err) => {
                    complete = false;
                    issue(&mut issues, resource.agent, &resource.path, err);
                }
            }
        }
        if cancel.load(Ordering::Acquire) {
            return Err(error(CustomErrorCode::AgentSessionCancelled));
        }
        entries.sort_by(|a, b| {
            b.summary
                .updated_at
                .total_cmp(&a.summary.updated_at)
                .then(a.summary.key.cmp(&b.summary.key))
        });
        let snapshot = AgentSessionsSnapshot {
            generation: uuid::Uuid::new_v4().to_string(),
            scanned_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64()
                * 1000.0,
            sources,
            total: entries.len() as u32,
            issues,
            complete,
        };
        *self.index.lock() = Index {
            entries,
            snapshot: Some(snapshot.clone()),
        };
        Ok(snapshot)
    }

    pub(super) fn query(
        &self,
        input: AgentSessionQuery,
        cancel: &AtomicBool,
    ) -> AppResult<AgentSessionPage> {
        if input.search.chars().count() > 256
            || input.from.is_some_and(|n| !n.is_finite())
            || input.to.is_some_and(|n| !n.is_finite())
            || input.from.zip(input.to).is_some_and(|(a, b)| a > b)
        {
            return Err(error(CustomErrorCode::AgentSessionInput));
        }
        let index = self.index.lock();
        let snapshot = index
            .snapshot
            .as_ref()
            .filter(|snapshot| snapshot.generation == input.generation)
            .ok_or_else(|| error(CustomErrorCode::AgentSessionChanged))?
            .clone();
        let entries = index.entries.clone();
        drop(index);
        let needle = input.search.trim().to_lowercase();
        let started = Instant::now();
        let mut matches = Vec::new();
        let mut reader = Reader::default();
        let mut complete = snapshot.complete;
        let mut issues = Vec::new();
        for entry in entries {
            if cancel.load(Ordering::Acquire) {
                return Err(error(CustomErrorCode::AgentSessionCancelled));
            }
            if started.elapsed() > MAX_JOB_TIME {
                complete = false;
                issue(
                    &mut issues,
                    entry.summary.agent,
                    &entry.resource.path,
                    error(CustomErrorCode::AgentSessionLimit),
                );
                break;
            }
            let mut summary = entry.summary;
            if input.agent.is_some_and(|agent| agent != summary.agent)
                || input
                    .archived
                    .is_some_and(|archived| archived != summary.archived)
                || input.from.is_some_and(|from| summary.updated_at < from)
                || input.to.is_some_and(|to| summary.updated_at > to)
            {
                continue;
            }
            if !needle.is_empty() {
                let metadata = format!(
                    "{} {} {}",
                    summary.title,
                    summary.cwd,
                    summary.session_id.as_deref().unwrap_or_default()
                )
                .to_lowercase();
                let path = Path::new(&summary.path);
                let mut found = None;
                let mut tail = String::new();
                let read =
                    reader.visit(&entry.resource, &summary.revision, cancel, |message, _| {
                        if found.is_none() {
                            let combined = if message.continuation {
                                format!("{}{}", tail, message.text)
                            } else {
                                message.text.clone()
                            };
                            if combined.to_lowercase().contains(&needle) {
                                found = Some((message.index, text::excerpt(&combined, &needle)));
                            }
                            tail = message
                                .text
                                .chars()
                                .rev()
                                .take(256)
                                .collect::<Vec<_>>()
                                .into_iter()
                                .rev()
                                .collect();
                        }
                        Ok(())
                    });
                match read {
                    Ok(transcript) => {
                        if !transcript.complete {
                            complete = false;
                            issue(
                                &mut issues,
                                summary.agent,
                                path,
                                error(CustomErrorCode::AgentSessionPartial),
                            );
                        }
                        if let Some((index, preview)) = found {
                            summary.match_index = Some(index);
                            summary.preview = preview;
                        } else if !metadata.contains(&needle) {
                            continue;
                        }
                    }
                    Err(err) if err.code == CustomErrorCode::AgentSessionCancelled.as_str() => {
                        return Err(err)
                    }
                    Err(err) => {
                        complete = false;
                        issue(&mut issues, summary.agent, path, err);
                        if !metadata.contains(&needle) {
                            continue;
                        }
                    }
                }
            }
            matches.push(summary);
        }
        self.check_generation(&input.generation)?;
        let total = matches.len() as u32;
        let limit = input.limit.clamp(1, 200);
        let items: Vec<_> = matches
            .into_iter()
            .skip(input.offset as usize)
            .take(limit as usize)
            .collect();
        let end = input.offset.saturating_add(items.len() as u32);
        Ok(AgentSessionPage {
            generation: input.generation,
            items,
            total,
            next_offset: (end < total).then_some(end),
            complete,
            issues,
        })
    }

    fn check_generation(&self, generation: &str) -> AppResult<()> {
        if self
            .index
            .lock()
            .snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.generation == generation)
        {
            Ok(())
        } else {
            Err(error(CustomErrorCode::AgentSessionChanged))
        }
    }

    pub(super) fn detail(
        &self,
        generation: &str,
        key: &str,
        offset: u32,
        limit: u32,
        cancel: &AtomicBool,
    ) -> AppResult<AgentSessionDetail> {
        self.check_generation(generation)?;
        let summary = self
            .index
            .lock()
            .entries
            .iter()
            .find(|entry| entry.summary.key == key)
            .cloned()
            .ok_or_else(|| error(CustomErrorCode::AgentSessionMissing))?;
        let resource = summary.resource;
        let summary = summary.summary;
        let mut reader = Reader::default();
        let mut messages = Vec::new();
        let transcript = reader.visit(&resource, &summary.revision, cancel, |message, _| {
            if message.index >= offset && messages.len() < limit.clamp(1, 100) as usize {
                messages.push(message);
            }
            Ok(())
        })?;
        self.check_generation(generation)?;
        let total = transcript.total;
        let end = offset.saturating_add(messages.len() as u32);
        Ok(AgentSessionDetail {
            session: summary,
            messages,
            total,
            next_offset: (end < total).then_some(end),
            complete: transcript.complete,
        })
    }
    pub(super) fn image(
        &self,
        generation: &str,
        key: &str,
        message_index: u32,
        image_index: u32,
        cancel: &AtomicBool,
    ) -> AppResult<AgentSessionImagePayload> {
        self.check_generation(generation)?;
        let summary = self
            .index
            .lock()
            .entries
            .iter()
            .find(|entry| entry.summary.key == key)
            .cloned()
            .ok_or_else(|| error(CustomErrorCode::AgentSessionMissing))?;
        let resource = summary.resource;
        let summary = summary.summary;
        let mut reader = Reader::default();
        let mut result = None;
        reader.visit(&resource, &summary.revision, cancel, |message, images| {
            if message.index == message_index {
                result = images
                    .get(image_index as usize)
                    .map(|image| image.read(&self.home));
            }
            Ok(())
        })?;
        self.check_generation(generation)?;
        result.ok_or_else(|| error(CustomErrorCode::AgentSessionImage))?
    }
}
