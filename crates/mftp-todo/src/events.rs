use serde::Serialize;
#[cfg(feature = "specta")]
use specta::Type;

pub const CHANGED_EVENT: &str = "todo://changed";

#[derive(Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase")]
pub struct TodoChanged {
    pub item_id: String,
}
