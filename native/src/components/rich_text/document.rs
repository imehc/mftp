//! Versioned portable content; the editor kernel is never persisted.

use mftp_foundation::{AppError, AppResult};
use serde::{Deserialize, Serialize};

pub const MAX_DOCUMENT_BYTES: usize = 256_000;
pub const MAX_IMAGES: usize = 10;
const MAX_NODES: usize = 2_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RichTextDocument {
    version: u32,
    format: Format,
    source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Format {
    Markdown,
}

impl Default for RichTextDocument {
    fn default() -> Self {
        Self::from_plain_text("")
    }
}

impl RichTextDocument {
    /// Import literal text without interpreting Markdown punctuation.
    pub fn from_plain_text(text: &str) -> Self {
        let mut source = String::new();
        for ch in text.chars() {
            match ch {
                '\n' => source.push_str("<br>"),
                '\r' => source.push_str("&#13;"),
                ch if ch.is_ascii_punctuation() || ch == ' ' || ch == '\t' => {
                    source.push_str(&format!("&#{};", ch as u32));
                }
                _ => source.push(ch),
            }
        }
        Self {
            version: 1,
            format: Format::Markdown,
            source,
        }
    }

    pub fn from_markdown(source: impl Into<String>) -> Self {
        Self {
            version: 1,
            format: Format::Markdown,
            source: source.into(),
        }
    }

    pub fn source(&self) -> &str {
        &self.source
    }

    pub fn is_supported_version(&self) -> bool {
        self.version == 1
    }

    pub fn equivalent(&self, other: &Self) -> bool {
        if self == other {
            return true;
        }
        let canonical = |document: &Self| {
            markdown_editor::BlockEditorModel::from_markdown(
                document.source(),
                gpui_kit::base::text::MarkdownExtensions::default(),
            )
            .map(|model| model.source())
        };
        match (canonical(self), canonical(other)) {
            (Ok(left), Ok(right)) => left == right,
            _ => false,
        }
    }

    pub fn validate(&self) -> AppResult<()> {
        if self.version != 1 {
            return Err(invalid("Unsupported rich text document version"));
        }
        if self.source.len() > MAX_DOCUMENT_BYTES {
            return Err(invalid("Rich text document exceeds byte budget"));
        }
        let tree = markdown::to_mdast(&self.source, &markdown::ParseOptions::gfm())
            .map_err(|_| invalid("Invalid rich text document"))?;
        let mut pending = vec![&tree];
        let mut nodes = 0;
        let mut images = 0;
        while let Some(node) = pending.pop() {
            nodes += 1;
            if nodes > MAX_NODES {
                return Err(invalid("Rich text document exceeds node budget"));
            }
            match node {
                markdown::mdast::Node::Image(image) => {
                    images += 1;
                    if image_id(&image.url).is_none() || images > MAX_IMAGES {
                        return Err(invalid(
                            "Unsupported image reference or image count exceeds budget",
                        ));
                    }
                }
                markdown::mdast::Node::ImageReference(_) => {
                    return Err(invalid("Unsupported indirect image reference"));
                }
                _ => {}
            }
            if let markdown::mdast::Node::Html(html) = node
                && !matches!(html.value.trim(), "<br>" | "<br/>" | "<br />")
            {
                return Err(invalid("Unsupported rich text HTML node"));
            }
            if let Some(children) = node.children() {
                pending.extend(children.iter().rev());
            }
        }
        Ok(())
    }

    pub fn image_ids(&self) -> AppResult<Vec<String>> {
        self.validate()?;
        let tree = markdown::to_mdast(&self.source, &markdown::ParseOptions::gfm())
            .map_err(|_| invalid("Invalid rich text document"))?;
        let mut pending = vec![&tree];
        let mut ids = Vec::new();
        while let Some(node) = pending.pop() {
            if let markdown::mdast::Node::Image(image) = node {
                let id = image_id(&image.url).ok_or_else(|| invalid("Invalid image identity"))?;
                if !ids.iter().any(|existing| existing == id) {
                    ids.push(id.to_owned());
                }
            }
            if let Some(children) = node.children() {
                pending.extend(children.iter().rev());
            }
        }
        Ok(ids)
    }

    pub fn plain_text(&self) -> AppResult<String> {
        self.validate()?;
        let model = markdown_editor::BlockEditorModel::from_markdown(
            &self.source,
            gpui_kit::base::text::MarkdownExtensions::default(),
        )
        .map_err(|_| invalid("Rich text content cannot be presented"))?;
        Ok(model
            .document()
            .leaves()
            .filter_map(|block| block.text())
            .map(|text| text.replace('\u{fffc}', ""))
            .collect::<Vec<_>>()
            .join("\n"))
    }

    /// Rewrite only image destinations; literal URIs in code and prose stay literal.
    pub(crate) fn remap_images(
        &self,
        ids: &std::collections::HashMap<String, String>,
    ) -> AppResult<String> {
        self.validate()?;
        let tree = markdown::to_mdast(&self.source, &markdown::ParseOptions::gfm())
            .map_err(|_| invalid("Invalid rich text document"))?;
        let mut pending = vec![&tree];
        let mut edits = Vec::new();
        while let Some(node) = pending.pop() {
            if let markdown::mdast::Node::Image(image) = node {
                let id = image_id(&image.url).ok_or_else(|| invalid("Invalid image identity"))?;
                if let Some(replacement) = ids.get(id) {
                    let position = image
                        .position
                        .as_ref()
                        .ok_or_else(|| invalid("Missing image position"))?;
                    let span = &self.source[position.start.offset..position.end.offset];
                    let offset = span
                        .find(&format!("]({}", image.url))
                        .map(|offset| offset + 2)
                        .ok_or_else(|| invalid("Unsupported clipboard image destination"))?;
                    edits.push((
                        position.start.offset + offset,
                        image.url.len(),
                        format!("mftp-image:{replacement}"),
                    ));
                }
            }
            if let Some(children) = node.children() {
                pending.extend(children);
            }
        }
        edits.sort_by_key(|(start, _, _)| std::cmp::Reverse(*start));
        let mut source = self.source.clone();
        for (start, length, replacement) in edits {
            source.replace_range(start..start + length, &replacement);
        }
        Self::from_markdown(&source).validate()?;
        Ok(source)
    }
}

pub(super) fn image_id(uri: &str) -> Option<&str> {
    let id = uri.strip_prefix("mftp-image:")?;
    uuid::Uuid::parse_str(id).ok().map(|_| id)
}

pub(super) fn invalid(message: &str) -> AppError {
    AppError::external("native:rich_text_invalid", message)
}
