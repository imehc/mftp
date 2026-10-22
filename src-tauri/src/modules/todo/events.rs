use serde::Serialize;
use specta::Type;

pub(crate) const CHANGED_EVENT: &str = "todo://changed";

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TodoChanged {
    pub item_id: String,
}
