//! Reconstructs VS Code's append-only chat log before exposing its transcript.
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::images::{self, NativeImage};
use super::model::{AgentSessionMessage, SessionRole};
use super::text;
use super::transcript::{self, Transcript};
use crate::error::{AppError, AppResult, CustomErrorCode};

const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_LINE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_STATE_WEIGHT: usize = 64 * 1024 * 1024;
const MAX_RECORDS: usize = 50_000;
const MAX_DEPTH: usize = 64;
const MAX_READ_TIME: Duration = Duration::from_secs(45);

fn check(cancel: &AtomicBool, started: Instant) -> AppResult<()> {
    if cancel.load(Ordering::Acquire) {
        return Err(AppError::custom(CustomErrorCode::AgentSessionCancelled));
    }
    if started.elapsed() > MAX_READ_TIME {
        return Err(AppError::custom(CustomErrorCode::AgentSessionLimit));
    }
    Ok(())
}

fn bounded_json(data: &[u8], cancel: &AtomicBool, started: Instant) -> AppResult<Option<Value>> {
    check(cancel, started)?;
    let result = match super::json::parse(data, cancel) {
        Ok(value) => Some(value),
        Err(error) if error.code == CustomErrorCode::AgentSessionFormat.as_str() => None,
        Err(error) => return Err(error),
    };
    check(cancel, started)?;
    Ok(result)
}

fn state_weight(value: &Value, depth: usize) -> Option<usize> {
    if depth > MAX_DEPTH {
        return None;
    }
    let mut weight: usize = 128;
    match value {
        Value::String(value) => weight = weight.checked_add(value.len())?,
        Value::Array(values) => {
            for value in values {
                weight = weight.checked_add(state_weight(value, depth + 1)?)?;
                if weight > MAX_STATE_WEIGHT {
                    return None;
                }
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                weight = weight.checked_add(key.len().checked_add(128)?)?;
                weight = weight.checked_add(state_weight(value, depth + 1)?)?;
                if weight > MAX_STATE_WEIGHT {
                    return None;
                }
            }
        }
        _ => {}
    }
    (weight <= MAX_STATE_WEIGHT).then_some(weight)
}

fn descend<'a>(value: &'a mut Value, key: &Value) -> Option<&'a mut Value> {
    if let Some(key) = key.as_str() {
        value.as_object_mut()?.get_mut(key)
    } else {
        value
            .as_array_mut()?
            .get_mut(usize::try_from(key.as_u64()?).ok()?)
    }
}

fn apply(payload: &mut Option<Value>, mut record: Value) -> bool {
    let Some(object) = record.as_object_mut() else {
        return false;
    };
    let Some(kind) = object.get("kind").and_then(Value::as_u64) else {
        return false;
    };
    if kind == 0 {
        let Some(value) = object.remove("v").filter(Value::is_object) else {
            return false;
        };
        *payload = Some(value);
        return true;
    }
    let Some(keys) = object.remove("k").and_then(|keys| keys.as_array().cloned()) else {
        return false;
    };
    if keys.is_empty()
        || keys.len() > MAX_DEPTH
        || keys.iter().any(|key| {
            key.as_str().is_some_and(|key| {
                key.len() > 512 || matches!(key, "__proto__" | "prototype" | "constructor")
            }) || (!key.is_string() && key.as_u64().is_none())
        })
    {
        return false;
    }
    let Some(mut parent) = payload.as_mut() else {
        return false;
    };
    for key in &keys[..keys.len() - 1] {
        let Some(child) = descend(parent, key) else {
            return false;
        };
        parent = child;
    }
    let key = &keys[keys.len() - 1];
    if kind == 3 {
        return if let (Some(map), Some(key)) = (parent.as_object_mut(), key.as_str()) {
            map.remove(key);
            true
        } else if let Some(target) = descend(parent, key) {
            *target = Value::Null;
            true
        } else {
            false
        };
    }
    if kind == 1 {
        let Some(value) = object.remove("v") else {
            return false;
        };
        return if let (Some(map), Some(key)) = (parent.as_object_mut(), key.as_str()) {
            map.insert(key.into(), value);
            true
        } else if let Some(target) = descend(parent, key) {
            *target = value;
            true
        } else {
            false
        };
    }
    if kind != 2 {
        return false;
    }
    let index = match object.get("i") {
        Some(value) => match value.as_u64().and_then(|value| usize::try_from(value).ok()) {
            Some(index) => Some(index),
            None => return false,
        },
        None => None,
    };
    let additions = match object.remove("v") {
        Some(Value::Array(values)) => values,
        None => Vec::new(),
        _ => return false,
    };
    if let (Some(map), Some(key)) = (parent.as_object_mut(), key.as_str()) {
        if !map.contains_key(key) || map[key].is_null() {
            map.insert(key.into(), Value::Array(Vec::new()));
        }
    }
    let Some(array) = descend(parent, key).and_then(Value::as_array_mut) else {
        return false;
    };
    // VS Code's kind=2 is truncate-then-append, not a general array splice.
    if let Some(index) = index {
        if index > array.len() {
            return false;
        }
        array.truncate(index);
    }
    array.extend(additions);
    true
}

fn workspace(path: &Path) -> Option<String> {
    let path = path.parent()?.parent()?.join("workspace.json");
    let file = File::open(path).ok()?;
    if file.metadata().ok()?.len() > 256 * 1024 {
        return None;
    }
    let value: Value = serde_json::from_reader(file).ok()?;
    let location = value.get("folder").or_else(|| value.get("workspace"))?;
    if let Some(path) = location.get("fsPath").and_then(Value::as_str) {
        return Some(path.into());
    }
    url::Url::parse(location.as_str()?)
        .ok()?
        .to_file_path()
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}

fn markdown(value: &Value) -> String {
    value
        .as_str()
        .or_else(|| value.get("value").and_then(Value::as_str))
        .or_else(|| value.get("text").and_then(Value::as_str))
        .or_else(|| value.get("content").and_then(Value::as_str))
        .map(str::to_owned)
        .unwrap_or_default()
}

fn image_uri(value: &Value) -> Option<PathBuf> {
    if let Some(value) = value.as_str() {
        return url::Url::parse(value).ok()?.to_file_path().ok();
    }
    (value.get("scheme").and_then(Value::as_str) == Some("file")
        && value.get("authority").is_none_or(|authority| {
            authority
                .as_str()
                .is_some_and(|authority| authority.is_empty() || authority == "localhost")
        }))
    .then(|| value.get("path").and_then(Value::as_str).map(PathBuf::from))
    .flatten()
}

fn extra_images<'a>(value: &'a Value, out: &mut Vec<NativeImage<'a>>) {
    if out.len() >= 20 {
        return;
    }
    if value["kind"] == "image" {
        let name = value["name"].as_str().unwrap_or("image").to_owned();
        if let Some(path) = image_uri(&value["value"]) {
            out.push(NativeImage::File { path, name });
        } else if let Some(data) = value["value"].as_str() {
            if let Some((prefix, data)) = data.split_once(',') {
                if prefix.starts_with("data:image/") && prefix.ends_with(";base64") {
                    out.push(NativeImage::Inline { data, name });
                }
            } else if value["isURL"] != true
                && url::Url::parse(data).is_err()
                && value["mimeType"]
                    .as_str()
                    .is_some_and(|mime| mime.starts_with("image/"))
            {
                out.push(NativeImage::Inline { data, name });
            }
        }
    }
    let output = &value["resultDetails"]["output"];
    if output["mimeType"]
        .as_str()
        .is_some_and(|mime| mime.starts_with("image/"))
    {
        if let Some(data) = output["base64Data"].as_str() {
            out.push(NativeImage::Inline {
                data,
                name: "image".into(),
            });
        }
    }
}

fn tool_text(part: &Value) -> String {
    let mut sections = Vec::new();
    if let Some(name) = part["toolId"].as_str().or(part["toolName"].as_str()) {
        sections.push(name.to_owned());
    }
    for key in ["invocationMessage", "pastTenseMessage", "generatedTitle"] {
        let value = markdown(&part[key]);
        if !value.is_empty() {
            sections.push(value);
        }
    }
    for key in ["resultDetails", "toolSpecificData"] {
        let value = &part[key];
        // Binary tool output belongs to the on-demand image path, not text.
        if !value.is_null()
            && value["output"]["type"] != "data"
            && value["kind"] != "generatedImage"
        {
            sections.push(serde_json::to_string_pretty(value).unwrap_or_default());
        }
    }
    sections.join("\n\n")
}

pub(super) fn visit(
    path: &Path,
    cancel: &AtomicBool,
    length: Option<u64>,
    mut callback: impl FnMut(AgentSessionMessage, &[NativeImage<'_>]) -> AppResult<()>,
) -> AppResult<Transcript> {
    let started = Instant::now();
    check(cancel, started)?;
    let file = File::open(path)?;
    let available = file.metadata()?.len();
    let length = length.unwrap_or(available);
    if length > available {
        return Err(AppError::custom(CustomErrorCode::AgentSessionChanged));
    }
    if length > MAX_FILE_BYTES {
        return Err(AppError::custom(CustomErrorCode::AgentSessionLimit));
    }
    let mut reader = BufReader::new(file.take(length));
    let mut line = Vec::new();
    let mut payload = None;
    let mut complete = true;
    let mut records = 0;
    loop {
        check(cancel, started)?;
        line.clear();
        let read = reader
            .by_ref()
            .take(MAX_LINE_BYTES + 1)
            .read_until(b'\n', &mut line)?;
        if read == 0 {
            break;
        }
        records += 1;
        if records > MAX_RECORDS || read as u64 > MAX_LINE_BYTES {
            return Err(AppError::custom(CustomErrorCode::AgentSessionLimit));
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let Some(record) = bounded_json(&line, cancel, started)? else {
            complete = false;
            continue;
        };
        if !apply(&mut payload, record) {
            complete = false;
        }
        if payload
            .as_ref()
            .is_some_and(|value| state_weight(value, 0).is_none())
        {
            return Err(AppError::custom(CustomErrorCode::AgentSessionLimit));
        }
    }
    let Some(payload) = payload else {
        return Err(AppError::custom(CustomErrorCode::AgentSessionFormat));
    };
    let created = text::timestamp(&payload["creationDate"]);
    let mut transcript = Transcript {
        id: payload["sessionId"]
            .as_str()
            .filter(|id| !id.trim().is_empty() && id.len() <= 512)
            .map(str::to_owned)
            .or_else(|| {
                path.file_stem()
                    .and_then(|stem| stem.to_str())
                    .filter(|stem| uuid::Uuid::parse_str(stem).is_ok())
                    .map(str::to_owned)
            }),
        title: payload["customTitle"]
            .as_str()
            .map(text::safe_preview)
            .unwrap_or_default(),
        cwd: workspace(path).unwrap_or_default(),
        created,
        complete,
        ..Transcript::default()
    };
    let Some(requests) = payload["requests"].as_array() else {
        transcript.complete &= payload["requests"].is_null();
        return Ok(transcript);
    };
    for request in requests {
        check(cancel, started)?;
        if !request.is_object() {
            transcript.complete = false;
            continue;
        }
        if request["hiddenFromTranscript"] == true {
            continue;
        }
        let timestamp = text::timestamp(&request["timestamp"]);
        let model = request["modelId"]
            .as_str()
            .filter(|model| !model.trim().is_empty())
            .map(|model| text::clip(model, 200));
        transcript.model = model;
        let mut native_images = Vec::new();
        images::collect(&request["message"], &mut native_images);
        if let Some(variables) = request["variableData"]["variables"].as_array() {
            for variable in variables {
                extra_images(variable, &mut native_images);
            }
        }
        let role = if request["isSystemInitiated"] == true {
            SessionRole::System
        } else {
            SessionRole::User
        };
        let previous_count = transcript.count;
        transcript::emit(
            &mut transcript,
            transcript::message(role, markdown(&request["message"]), timestamp),
            &native_images,
            cancel,
            &mut callback,
        )?;
        let user_count = transcript.count.saturating_sub(previous_count);
        let Some(response) = request["response"].as_array() else {
            if !request["response"].is_null() {
                transcript.complete = false;
            }
            continue;
        };
        let response_start = transcript.total;
        for part in response {
            check(cancel, started)?;
            let (role, body) = match part["kind"].as_str() {
                Some("thinking") => (SessionRole::Thinking, markdown(&part["value"])),
                Some("toolInvocationSerialized" | "toolInvocation" | "toolCall") => {
                    (SessionRole::Tool, tool_text(part))
                }
                None | Some("text" | "markdown" | "markdownContent") => (
                    SessionRole::Assistant,
                    if part["kind"] == "markdownContent" {
                        markdown(&part["content"])
                    } else {
                        markdown(part)
                    },
                ),
                Some("progressTaskSerialized") => (SessionRole::System, markdown(&part["content"])),
                _ => continue,
            };
            let mut native_images = Vec::new();
            images::collect(part, &mut native_images);
            extra_images(part, &mut native_images);
            let mut message = transcript::message(
                role,
                body,
                text::timestamp(&request["responseTimestamp"]).or(timestamp),
            );
            if role == SessionRole::Assistant {
                message.model = transcript.model.clone();
            }
            transcript::emit(
                &mut transcript,
                message,
                &native_images,
                cancel,
                &mut callback,
            )?;
        }
        // Response parts and long-message chunks are rendering units. They
        // still belong to one logical assistant response for session counts.
        transcript.count = previous_count
            .saturating_add(user_count)
            .saturating_add(u32::from(transcript.total > response_start));
    }
    transcript.created = created.or(transcript.created);
    if transcript.title.is_empty() {
        transcript.title = transcript.preview.clone();
    }
    Ok(transcript)
}
