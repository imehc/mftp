use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::model::{TodoItem, TodoItemInput};
use crate::error::{AppError, AppResult, CustomErrorCode};

pub(super) const MAX_NOTE_BYTES: usize = 256_000;
pub(super) const MAX_NOTE_BLOCKS: usize = 2_000;
pub(super) const MAX_NOTE_IMAGES: usize = 10;
pub(super) const MAX_DRAFTS: i64 = 8;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum TodoNoteInline {
    Text {
        text: String,
    },
    HardBreak,
    Image {
        #[serde(rename = "assetId")]
        asset_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum TodoNoteBlock {
    Paragraph { content: Vec<TodoNoteInline> },
    CodeBlock { text: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TodoNoteDocument {
    pub version: u32,
    pub blocks: Vec<TodoNoteBlock>,
}

impl TodoNoteDocument {
    pub(super) fn from_plain_text(text: Option<&str>) -> Self {
        Self {
            version: 2,
            blocks: text
                .filter(|text| !text.is_empty())
                .map(|text| {
                    let mut content = Vec::new();
                    for (index, line) in text.split('\n').enumerate() {
                        if index > 0 {
                            content.push(TodoNoteInline::HardBreak);
                        }
                        if !line.is_empty() {
                            content.push(TodoNoteInline::Text { text: line.into() });
                        }
                    }
                    vec![TodoNoteBlock::Paragraph { content }]
                })
                .unwrap_or_default(),
        }
    }

    pub(super) fn validate(&self) -> AppResult<()> {
        if self.version != 2 {
            return Err(AppError::custom(CustomErrorCode::TodoNoteVersion));
        }
        let nodes = self.blocks.len()
            + self
                .blocks
                .iter()
                .map(|block| match block {
                    TodoNoteBlock::Paragraph { content } => content.len(),
                    TodoNoteBlock::CodeBlock { .. } => 0,
                })
                .sum::<usize>();
        let images = self.image_ids();
        if nodes > MAX_NOTE_BLOCKS
            || images.len() > MAX_NOTE_IMAGES
            || images.iter().any(|id| uuid::Uuid::parse_str(id).is_err())
            || serde_json::to_vec(self)?.len() > MAX_NOTE_BYTES
        {
            return Err(AppError::custom(CustomErrorCode::TodoNoteInvalid));
        }
        Ok(())
    }

    pub(super) fn image_ids(&self) -> Vec<&str> {
        let mut ids = Vec::new();
        for block in &self.blocks {
            if let TodoNoteBlock::Paragraph { content } = block {
                ids.extend(content.iter().filter_map(|node| match node {
                    TodoNoteInline::Image { asset_id } => Some(asset_id.as_str()),
                    _ => None,
                }));
            }
        }
        ids
    }

    pub(super) fn remap_images(
        &mut self,
        mut remap: impl FnMut(&str) -> AppResult<String>,
    ) -> AppResult<()> {
        for block in &mut self.blocks {
            if let TodoNoteBlock::Paragraph { content } = block {
                for node in content {
                    if let TodoNoteInline::Image { asset_id } = node {
                        *asset_id = remap(asset_id)?;
                    }
                }
            }
        }
        Ok(())
    }

    pub(super) fn unique_image_ids(&self) -> HashSet<&str> {
        self.image_ids().into_iter().collect()
    }

    pub(super) fn plain_text(&self) -> Option<String> {
        let text = self
            .blocks
            .iter()
            .map(|block| match block {
                TodoNoteBlock::CodeBlock { text } => text.clone(),
                TodoNoteBlock::Paragraph { content } => content
                    .iter()
                    .map(|node| match node {
                        TodoNoteInline::Text { text } => text.as_str(),
                        TodoNoteInline::HardBreak => "\n",
                        TodoNoteInline::Image { .. } => "",
                    })
                    .collect::<String>(),
            })
            .collect::<Vec<_>>()
            .join("\n");
        (!text.is_empty()).then_some(text)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodoNoteImageInfo {
    pub id: String,
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
    pub byte_length: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodoNoteImageData {
    pub image: TodoNoteImageInfo,
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodoNoteImageImport {
    pub image: TodoNoteImageInfo,
    pub compressed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodoNoteSummary {
    pub item_id: String,
    pub revision: i64,
    pub image_count: u32,
    pub first_image: Option<TodoNoteImageInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodoNoteDetails {
    pub item: TodoItem,
    pub document: TodoNoteDocument,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodoNoteDraft {
    pub id: String,
    pub item: Option<TodoItem>,
    pub document: TodoNoteDocument,
    pub base_revision: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TodoNoteSaveInput {
    pub draft_id: String,
    pub metadata: TodoItemInput,
    pub document: TodoNoteDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TodoNoteClipboard {
    Text { text: String },
    Image { image: TodoNoteImageInfo },
    Empty,
}
