use std::sync::atomic::{AtomicBool, Ordering};

use super::images::NativeImage;
use super::model::{
    AgentSessionImageRef, AgentSessionMessage, SessionContentAvailability, SessionRole,
};
use super::text;
use crate::error::{AppError, AppResult, CustomErrorCode};

const CHUNK_CHARS: usize = 32_000;

pub(super) struct Transcript {
    pub id: Option<String>,
    pub title: String,
    pub cwd: String,
    pub model: Option<String>,
    pub preview: String,
    pub created: Option<f64>,
    pub updated: Option<f64>,
    pub count: u32,
    pub total: u32,
    pub complete: bool,
    pub archived: bool,
    pub content_availability: SessionContentAvailability,
}

impl Default for Transcript {
    fn default() -> Self {
        Self {
            id: None,
            title: String::new(),
            cwd: String::new(),
            model: None,
            preview: String::new(),
            created: None,
            updated: None,
            count: 0,
            total: 0,
            complete: true,
            archived: false,
            content_availability: SessionContentAvailability::Full,
        }
    }
}

pub(super) fn message(
    role: SessionRole,
    raw: String,
    timestamp: Option<f64>,
) -> AgentSessionMessage {
    let (role, text) = if role == SessionRole::User {
        if text::is_notice(&raw) {
            (SessionRole::System, raw)
        } else {
            (role, text::clean_user(&raw))
        }
    } else {
        (role, raw)
    };
    AgentSessionMessage {
        index: 0,
        role,
        text,
        timestamp,
        truncated: false,
        model: None,
        images: Vec::new(),
        continuation: false,
    }
}

pub(super) fn emit(
    transcript: &mut Transcript,
    message: AgentSessionMessage,
    images: &[NativeImage<'_>],
    cancel: &AtomicBool,
    callback: &mut impl FnMut(AgentSessionMessage, &[NativeImage<'_>]) -> AppResult<()>,
) -> AppResult<()> {
    if cancel.load(Ordering::Acquire) {
        return Err(AppError::custom(CustomErrorCode::AgentSessionCancelled));
    }
    if message.text.trim().is_empty() && images.is_empty() {
        return Ok(());
    }
    if matches!(message.role, SessionRole::User | SessionRole::Assistant) {
        transcript.count = transcript.count.saturating_add(1);
    }
    if transcript.preview.is_empty() && message.role == SessionRole::User {
        transcript.preview = text::safe_preview(&message.text);
    }
    if let Some(timestamp) = message.timestamp {
        transcript.created = Some(
            transcript
                .created
                .map_or(timestamp, |old| old.min(timestamp)),
        );
        transcript.updated = Some(
            transcript
                .updated
                .map_or(timestamp, |old| old.max(timestamp)),
        );
    }
    let model = message.model;
    let mut chars = message.text.chars().peekable();
    let mut first = true;
    loop {
        let chunk: String = chars.by_ref().take(CHUNK_CHARS).collect();
        if chunk.is_empty() && !first {
            break;
        }
        callback(
            AgentSessionMessage {
                index: transcript.total,
                role: message.role,
                text: chunk,
                timestamp: message.timestamp,
                truncated: message.truncated,
                model: model.clone(),
                images: if first {
                    images
                        .iter()
                        .take(20)
                        .enumerate()
                        .map(|(index, image)| AgentSessionImageRef {
                            index: index as u32,
                            name: image.name().to_owned(),
                        })
                        .collect()
                } else {
                    Vec::new()
                },
                continuation: !first,
            },
            if first {
                &images[..images.len().min(20)]
            } else {
                &[]
            },
        )?;
        transcript.total = transcript.total.saturating_add(1);
        first = false;
        if chars.peek().is_none() {
            break;
        }
        if cancel.load(Ordering::Acquire) {
            return Err(AppError::custom(CustomErrorCode::AgentSessionCancelled));
        }
    }
    Ok(())
}
