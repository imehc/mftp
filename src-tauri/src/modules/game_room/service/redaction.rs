use crate::core::diagnostics::{sensitive, Redactor};
use serde_json::Value;
use std::ops::Range;

struct Edit {
    range: Range<usize>,
    replacement: Vec<u8>,
}

/// Map redactions through JSON string envelopes without normalizing untouched
/// bytes. This also handles duplicate keys and noncanonical Unicode escapes.
pub(super) fn sanitize(raw: &[u8], redactor: &mut Redactor) -> Option<(Vec<u8>, bool)> {
    let mut budget = 64;
    let edits = edits(raw, redactor, 0, &mut budget)?;
    let changed = !edits.is_empty();
    let mut safe = Vec::with_capacity(raw.len());
    let mut cursor = 0;
    for edit in edits {
        safe.extend_from_slice(&raw[cursor..edit.range.start]);
        safe.extend_from_slice(&edit.replacement);
        cursor = edit.range.end;
    }
    safe.extend_from_slice(&raw[cursor..]);
    let (safe, echoed) = redactor.bytes(&safe, false);
    Some((safe, changed || echoed))
}

fn edits(
    raw: &[u8],
    redactor: &mut Redactor,
    depth: usize,
    budget: &mut usize,
) -> Option<Vec<Edit>> {
    if depth > 8 {
        return None;
    }
    let value = serde_json::from_slice::<Value>(raw).ok()?;
    let hello = depth == 0 && value.get("type").and_then(Value::as_str) == Some("hello");
    let mut result = Vec::new();
    let mut cursor = 0;
    while cursor < raw.len() {
        if raw[cursor] != b'"' {
            cursor += 1;
            continue;
        }
        let end = string_end(raw, cursor);
        let key: String = serde_json::from_slice(&raw[cursor..end]).ok()?;
        cursor = whitespace(raw, end);
        if raw.get(cursor) != Some(&b':') {
            continue;
        }
        let start = whitespace(raw, cursor + 1);
        if sensitive(&key) || (hello && key == "code") {
            if *budget == 0 {
                return None;
            }
            *budget -= 1;
            let mut values =
                serde_json::Deserializer::from_slice(&raw[start..]).into_iter::<Value>();
            let value = values.next()?.ok()?;
            let end = start + values.byte_offset();
            if let Some(secret) = value.as_str() {
                redactor.add_secret(secret);
            }
            result.push(Edit {
                range: start..end,
                replacement: b"\"[REDACTED]\"".to_vec(),
            });
            cursor = end;
        } else if key == "payload" && raw.get(start) == Some(&b'"') {
            let end = string_end(raw, start);
            let payload: String = serde_json::from_slice(&raw[start..end]).ok()?;
            let nested = edits(payload.as_bytes(), redactor, depth + 1, budget)?;
            if !nested.is_empty() {
                let map = string_offsets(&raw[start..end])?;
                for edit in nested {
                    let replacement = String::from_utf8(edit.replacement).ok()?;
                    let encoded = serde_json::to_vec(&replacement).ok()?;
                    result.push(Edit {
                        range: start + map[edit.range.start]..start + map[edit.range.end],
                        replacement: encoded[1..encoded.len() - 1].to_vec(),
                    });
                }
            }
            cursor = end;
        } else {
            cursor = start;
        }
    }
    Some(result)
}

fn whitespace(raw: &[u8], mut cursor: usize) -> usize {
    while raw.get(cursor).is_some_and(u8::is_ascii_whitespace) {
        cursor += 1;
    }
    cursor
}

fn string_end(raw: &[u8], start: usize) -> usize {
    let mut cursor = start + 1;
    while cursor < raw.len() {
        match raw[cursor] {
            b'\\' => cursor += 2,
            b'"' => return cursor + 1,
            _ => cursor += 1,
        }
    }
    raw.len()
}

/// Decoded byte boundaries point back into the exact original string token.
fn string_offsets(raw: &[u8]) -> Option<Vec<usize>> {
    let mut map = Vec::new();
    let mut cursor = 1;
    while cursor + 1 < raw.len() {
        let start = cursor;
        if raw[cursor] == b'\\' {
            cursor += if raw.get(cursor + 1) == Some(&b'u') {
                6
            } else {
                2
            };
            if raw.get(start + 1) == Some(&b'u') {
                let hex = std::str::from_utf8(raw.get(start + 2..cursor)?).ok()?;
                if (0xd800..=0xdbff).contains(&u16::from_str_radix(hex, 16).ok()?) {
                    cursor += 6;
                }
            }
            let mut token = vec![b'"'];
            token.extend_from_slice(raw.get(start..cursor)?);
            token.push(b'"');
            let decoded: String = serde_json::from_slice(&token).ok()?;
            map.extend(std::iter::repeat_n(start, decoded.len()));
        } else {
            map.push(cursor);
            cursor += 1;
        }
    }
    map.push(cursor);
    Some(map)
}
