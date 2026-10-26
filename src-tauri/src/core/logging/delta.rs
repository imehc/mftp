use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Change {
    path: Vec<String>,
    value: Value,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    append: bool,
}

pub(super) fn between(previous: &Value, next: &Value) -> Vec<Change> {
    let mut changes = Vec::new();
    compare(previous, next, &mut Vec::new(), &mut changes);
    changes
}

fn compare(previous: &Value, next: &Value, path: &mut Vec<String>, changes: &mut Vec<Change>) {
    if previous == next {
        return;
    }
    match (previous, next) {
        (Value::Object(before), Value::Object(after)) => {
            for (key, value) in after {
                path.push(key.clone());
                compare(
                    before.get(key).unwrap_or(&Value::Null),
                    value,
                    path,
                    changes,
                );
                path.pop();
            }
        }
        (Value::Array(before), Value::Array(after)) if before.len() <= after.len() => {
            for (index, value) in after.iter().enumerate() {
                path.push(index.to_string());
                compare(
                    before.get(index).unwrap_or(&Value::Null),
                    value,
                    path,
                    changes,
                );
                path.pop();
            }
        }
        (Value::String(before), Value::String(after)) if after.starts_with(before) => {
            changes.push(Change {
                path: path.clone(),
                value: Value::String(after[before.len()..].into()),
                append: true,
            });
        }
        _ => changes.push(Change {
            path: path.clone(),
            value: next.clone(),
            append: false,
        }),
    }
}

pub(super) fn apply(value: &mut Value, changes: &[Change]) -> bool {
    for change in changes {
        if change.path.len() > 16 {
            return false;
        }
        let mut target = &mut *value;
        for part in &change.path {
            if let Value::Array(items) = target {
                let Ok(index) = part.parse::<usize>() else {
                    return false;
                };
                if index > items.len() || index > 128 {
                    return false;
                }
                if index == items.len() {
                    items.push(Value::Null);
                }
                target = &mut items[index];
            } else {
                if target.is_null() {
                    *target = serde_json::json!({});
                }
                let Some(object) = target.as_object_mut() else {
                    return false;
                };
                target = object.entry(part).or_insert(Value::Null);
            }
        }
        if change.append {
            let Some(suffix) = change.value.as_str() else {
                return false;
            };
            if let Some(text) = target.as_str() {
                if text.len().saturating_add(suffix.len()) > super::EVENT_BYTES {
                    return false;
                }
                *target = Value::String(format!("{text}{suffix}"));
            } else if target.is_null() {
                *target = change.value.clone();
            } else {
                return false;
            }
        } else {
            *target = change.value.clone();
        }
    }
    true
}

pub(super) fn apply_projection(value: &mut Value, changes: &[Change], detail: bool) -> bool {
    if detail {
        return apply(value, changes);
    }
    let changes: Vec<_> = changes
        .iter()
        .filter_map(|change| {
            if matches!(
                change.path.first().map(String::as_str),
                Some("details" | "trace")
            ) {
                return None;
            }
            let mut change = change.clone();
            if change.path.is_empty() {
                if let Some(object) = change.value.as_object_mut() {
                    object.insert("details".into(), serde_json::json!([]));
                    object.insert("trace".into(), Value::Null);
                }
            }
            Some(change)
        })
        .collect();
    apply(value, &changes)
}
