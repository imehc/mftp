use super::{
    document::{BlockContent, EditorDocument},
    editor::BlockEditorModel,
    id::BlockId,
    inline::InlineText,
    kind::{BlockKind, BlockKindData},
    marks::{MarkChange, MarkKind, MarkState},
    position::{BlockPosition, PositionError},
    selection::{BlockSelection, ResolvedSelection, SelectionError},
    step::{DetachedBlock, DetachedContent, StepError},
    transaction::{EditOrigin, TransactionBuilder},
};
use gpui::SharedString;

use gpui_kit::base::text::editor_host::TextMark;

#[non_exhaustive]
#[derive(Clone, PartialEq, Debug)]
pub enum EditorCommand {
    ToggleMark(MarkKind),
    ApplyMark(MarkChange),
    SetBlockKind(BlockKind),
    ToggleList {
        ordered: bool,
    },
    ToggleTask,
    /// Make the caret's list item a task item, checked or not (D14).
    SetTaskChecked(bool),
    Indent,
    Outdent,
    MoveBlocks {
        down: bool,
    },
    InsertBlock(BlockKind),
    /// Make the caret's paragraph a code block (its text becomes the code),
    /// or set the language of the code block holding the caret.
    SetCodeBlock {
        lang: Option<String>,
    },
    /// Insert an empty table (`rows` includes the header row) after the
    /// caret's block, replacing it when it is an empty paragraph.
    InsertTable {
        rows: usize,
        cols: usize,
    },
    /// Add or remove a row or column at the caret's cell.
    EditTable(super::table::TableEdit),
    SelectAll,
    DeleteSelection,
    /// Wrap the caret's paragraph, heading or code block in a blockquote,
    /// or, when the caret is already in one, unwrap the nearest quote
    /// (its blocks move out in place; nothing is lost).
    ToggleBlockquote,
}

#[non_exhaustive]
#[derive(Clone, PartialEq, Debug)]
pub enum CommandError {
    Position(PositionError),
    Selection(SelectionError),
    /// The caret is in a block the spike cannot edit in place (code block,
    /// atom); Phase 4.
    NotEditable(BlockId),
    Unsupported(&'static str),
    /// A step failed; the transaction was rolled back.
    Internal(String),
}

impl From<StepError> for CommandError {
    fn from(error: StepError) -> Self {
        Self::Internal(format!("{error:?}"))
    }
}

impl From<SelectionError> for CommandError {
    fn from(error: SelectionError) -> Self {
        Self::Selection(error)
    }
}

impl From<PositionError> for CommandError {
    fn from(error: PositionError) -> Self {
        Self::Position(error)
    }
}

/// A position plus its path from the root, which commands walk to find
/// their target ("the nearest `ListItem`") at any nesting depth (R7).
pub(crate) struct ResolvedPosition {
    pub(crate) pos: BlockPosition,
    pub(crate) path: Vec<BlockId>,
}

impl ResolvedPosition {
    pub(crate) fn resolve(doc: &EditorDocument, pos: BlockPosition) -> Result<Self, PositionError> {
        let pos = doc.validate(pos)?;
        Ok(Self {
            pos,
            path: doc.path(pos.block),
        })
    }

    /// Nearest ancestor-or-self matching `pred`, innermost first.
    pub(crate) fn nearest(
        &self,
        doc: &EditorDocument,
        pred: impl Fn(&BlockKindData) -> bool,
    ) -> Option<BlockId> {
        self.path
            .iter()
            .rev()
            .copied()
            .find(|id| doc.kind(*id).is_some_and(&pred))
    }
}

fn is_list_item(kind: &BlockKindData) -> bool {
    matches!(kind, BlockKindData::ListItem { .. })
}

fn caret(pos: BlockPosition) -> Option<BlockSelection> {
    Some(BlockSelection::caret(pos))
}

/// Delete a resolved range and return where the caret goes. Atoms and code
/// blocks between (or at fully covered ends of) the range are removed.
pub(crate) fn delete_range(
    tx: &mut TransactionBuilder<'_>,
    range: ResolvedSelection,
) -> Result<BlockPosition, CommandError> {
    let (start, end) = (range.start, range.end);
    let doc = &*tx.doc;
    if start.block == end.block {
        if doc.inline(start.block).is_some() {
            tx.replace_text(start.block, start.offset..end.offset, InlineText::new())?;
        } else if doc.plain(start.block).is_some() {
            tx.replace_plain(start.block, start.offset..end.offset, "")?;
        } else if start.offset == 0 && end.offset == 1 {
            tx.remove_block(start.block)?;
        }
        return Ok(start);
    }
    // Select-all followed by an edit starts a fresh document (R2 repro):
    // every leaf is fully covered, including the code block.
    if start == doc.first_caret()
        && end.block == doc.last_caret().block
        && end.offset == doc.last_caret().offset
    {
        let root = doc.root;
        let len = doc.children(root).len();
        tx.remove(root, 0..len)?;
        let paragraph = DetachedBlock::paragraph(InlineText::new());
        let id = paragraph.id;
        tx.insert(root, 0, vec![paragraph])?;
        return Ok(BlockPosition::new(id, 0));
    }
    let leaves = doc.walk_leaves();
    let (Some(si), Some(ei)) = (
        leaves.iter().position(|id| *id == start.block),
        leaves.iter().position(|id| *id == end.block),
    ) else {
        return Err(CommandError::Position(PositionError::UnknownBlock(
            start.block,
        )));
    };
    let is_cell =
        |doc: &EditorDocument, id: BlockId| doc.kind(id) == Some(&BlockKindData::TableCell);

    // Start leaf.
    let start_code = doc.plain(start.block).map(str::len);
    let start_kept = if let Some(inline) = doc.inline(start.block) {
        let len = inline.len();
        tx.replace_text(start.block, start.offset..len, InlineText::new())?;
        true
    } else if let Some(len) = start_code {
        // Code keeps its head; it never joins with text.
        tx.replace_plain(start.block, start.offset..len, "")?;
        true
    } else if start.offset == 0 {
        tx.remove_block(start.block)?;
        false
    } else {
        false
    };
    let start_inline = start_kept && start_code.is_none();
    // Leaves in between.
    for id in &leaves[si + 1..ei] {
        if is_cell(tx.doc, *id) {
            let len = tx.doc.leaf_len(*id).unwrap_or(0);
            tx.replace_text(*id, 0..len, InlineText::new())?;
        } else if tx.doc.get(*id).is_some() {
            tx.remove_block(*id)?;
        }
    }
    // End leaf.
    if let Some(inline) = tx.doc.inline(end.block) {
        let tail = inline.slice(end.offset..inline.len());
        let joinable = start_inline && !is_cell(tx.doc, end.block) && !is_cell(tx.doc, start.block);
        if joinable {
            tx.remove_block(end.block)?;
            tx.replace_text(start.block, start.offset..start.offset, tail)?;
        } else {
            tx.replace_text(end.block, 0..end.offset, InlineText::new())?;
            if !start_kept {
                return Ok(BlockPosition::new(end.block, 0));
            }
        }
    } else if tx.doc.plain(end.block).is_some() {
        tx.replace_plain(end.block, 0..end.offset, "")?;
    } else if end.offset == 1 {
        tx.remove_block(end.block)?;
    }
    if start_kept {
        Ok(start)
    } else {
        Ok(tx.doc.first_caret())
    }
}

include!("command/part_0.rs");
include!("command/part_1.rs");
include!("command/part_2.rs");
include!("command/part_3.rs");

/// Split the text block at `pos`; returns the caret at the start of the new
/// block. In a list item's first paragraph this creates a new list item.
fn split_at(
    tx: &mut TransactionBuilder<'_>,
    pos: BlockPosition,
) -> Result<BlockPosition, CommandError> {
    let doc = &*tx.doc;
    let Some(inline) = doc.inline(pos.block) else {
        return Err(CommandError::NotEditable(pos.block));
    };
    let kind = doc.kind(pos.block).cloned();
    if kind == Some(BlockKindData::TableCell) {
        return Err(CommandError::NotEditable(pos.block));
    }
    let tail = inline.slice(pos.offset..inline.len());
    let len = inline.len();
    let (parent, index) = doc
        .index_in_parent(pos.block)
        .ok_or(PositionError::UnknownBlock(pos.block))?;
    let new_kind = match kind {
        Some(BlockKindData::Heading { level }) if pos.offset < len => {
            BlockKindData::Heading { level }
        }
        _ => BlockKindData::Paragraph,
    };
    let parent_kind = doc.kind(parent).cloned();
    tx.replace_text(pos.block, pos.offset..len, InlineText::new())?;
    let block = DetachedBlock::leaf(new_kind, BlockContent::Inline(tail));
    let id = block.id;
    match parent_kind {
        Some(BlockKindData::ListItem { checked, spread }) if index == 0 => {
            let item = DetachedBlock::container(
                BlockKindData::ListItem {
                    checked: checked.map(|_| false),
                    spread,
                },
                vec![block],
            );
            let (list, item_index) = tx
                .doc
                .index_in_parent(parent)
                .ok_or(StepError::UnknownBlock(parent))?;
            tx.insert(list, item_index + 1, vec![item])?;
        }
        _ => tx.insert(parent, index + 1, vec![block])?,
    }
    Ok(BlockPosition::new(id, 0))
}

/// Insert an empty paragraph right after `block` and return its caret.
fn exit_below(
    tx: &mut TransactionBuilder<'_>,
    block: BlockId,
) -> Result<BlockPosition, CommandError> {
    let (parent, index) = tx
        .doc
        .index_in_parent(block)
        .ok_or(PositionError::UnknownBlock(block))?;
    let paragraph = DetachedBlock::paragraph(InlineText::new());
    let id = paragraph.id;
    tx.insert(parent, index + 1, vec![paragraph])?;
    Ok(BlockPosition::new(id, 0))
}

/// A heading that a delete has emptied becomes a paragraph, in the same
/// transaction (one undo step restores both text and level).
fn drop_empty_heading(tx: &mut TransactionBuilder<'_>, block: BlockId) -> Result<(), CommandError> {
    if matches!(tx.doc.kind(block), Some(BlockKindData::Heading { .. }))
        && tx.doc.leaf_len(block) == Some(0)
    {
        tx.set_kind(block, BlockKindData::Paragraph)?;
    }
    Ok(())
}
