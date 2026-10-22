use rmcp::schemars::{self, JsonSchema};
use serde::{Deserialize, Deserializer, Serialize};

use super::super::{
    model::{TodoItem, TodoPriority},
    note_model::{TodoNoteDetails, TodoNoteDraft, TodoNoteImageInfo},
};

#[derive(Debug, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ListInput {
    #[serde(default)]
    pub offset: u32,
    pub limit: Option<u32>,
    pub status: Option<TodoStatus>,
    pub category: Option<String>,
    pub priority: Option<TodoPriority>,
    pub query: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TodoStatus {
    Active,
    Completed,
    Abandoned,
    All,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VersionedItem {
    pub item: TodoItem,
    pub revision: i64,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListOutput {
    pub items: Vec<VersionedItem>,
    pub next_offset: Option<u32>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DetailsOutput {
    #[serde(flatten)]
    pub details: TodoNoteDetails,
    pub images: Vec<TodoNoteImageInfo>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ItemInput {
    pub id: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RevisionInput {
    pub id: String,
    pub revision: i64,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StateInput {
    pub id: String,
    pub revision: i64,
    pub value: bool,
}

#[derive(Debug, Default, JsonSchema)]
pub(crate) enum Field<T> {
    #[default]
    Missing,
    Value(Option<T>),
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Field<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Option::<T>::deserialize(deserializer).map(Self::Value)
    }
}

impl<T> Field<T> {
    pub(crate) fn apply(self, current: Option<T>) -> Option<T> {
        match self {
            Self::Missing => current,
            Self::Value(value) => value,
        }
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateInput {
    pub id: String,
    pub revision: i64,
    #[serde(default)]
    #[schemars(with = "Option<String>")]
    pub title: Field<String>,
    #[serde(default)]
    #[schemars(with = "Option<String>")]
    pub category: Field<String>,
    #[serde(default)]
    #[schemars(with = "Option<String>")]
    pub due_date: Field<String>,
    #[serde(default)]
    #[schemars(with = "Option<i64>")]
    pub due_at: Field<i64>,
    #[serde(default)]
    #[schemars(with = "Option<TodoPriority>")]
    pub priority: Field<TodoPriority>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BeginInput {
    pub item_id: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DraftInput {
    pub draft_id: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImportInput {
    pub draft_id: String,
    pub data_base64: String,
    pub mime_type: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImageInput {
    pub asset_id: String,
    pub item_id: Option<String>,
    pub draft_id: Option<String>,
    #[serde(default)]
    pub thumbnail: bool,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CopyInput {
    pub draft_id: String,
    pub source_item_id: String,
    pub asset_id: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DiscardInput {
    pub draft_id: String,
    pub asset_id: String,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DraftOutput {
    pub draft: TodoNoteDraft,
    pub images: Vec<TodoNoteImageInfo>,
    pub limits: NoteLimits,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SaveState {
    Draft,
    Saved,
    Unknown,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveStatusOutput {
    pub state: SaveState,
    pub item_id: Option<String>,
    pub revision: Option<i64>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NoteLimits {
    pub document_bytes: usize,
    pub document_nodes: usize,
    pub images: usize,
    pub input_image_bytes: usize,
    pub image_pixels: u64,
    pub image_edge: u32,
}

impl Default for NoteLimits {
    fn default() -> Self {
        use super::super::{note_image, note_model};
        Self {
            document_bytes: note_model::MAX_NOTE_BYTES,
            document_nodes: note_model::MAX_NOTE_BLOCKS,
            images: note_model::MAX_NOTE_IMAGES,
            input_image_bytes: note_image::MAX_INPUT_BYTES,
            image_pixels: note_image::MAX_PIXELS,
            image_edge: note_image::MAX_EDGE,
        }
    }
}
