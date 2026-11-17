//! Table cell editing (Phase 4c): cell navigation, `BlockSelection::Cells`,
//! and row/column commands. Cells are ordinary inline leaves; a table is
//! `Table > TableRow > TableCell`, the first row being the header.

use super::{
    command::CommandError,
    document::{BlockContent, EditorDocument},
    editor::BlockEditorModel,
    id::BlockId,
    inline::InlineText,
    kind::BlockKindData,
    position::{BlockPosition, PositionError},
    selection::BlockSelection,
    step::DetachedBlock,
    transaction::EditOrigin,
};
use gpui_kit::base::text::editor_host::ColumnAlign;

/// A table's cells as rows.
pub(crate) fn grid(doc: &EditorDocument, table: BlockId) -> Vec<Vec<BlockId>> {
    doc.children(table)
        .iter()
        .map(|row| doc.children(*row).to_vec())
        .collect()
}

pub(crate) fn table_of(doc: &EditorDocument, cell: BlockId) -> Option<BlockId> {
    if doc.kind(cell) != Some(&BlockKindData::TableCell) {
        return None;
    }
    doc.path(cell)
        .into_iter()
        .rev()
        .find(|id| matches!(doc.kind(*id), Some(BlockKindData::Table { .. })))
}

/// `(row, column)` of a cell in its table's grid.
pub(crate) fn cell_coords(
    doc: &EditorDocument,
    table: BlockId,
    cell: BlockId,
) -> Option<(usize, usize)> {
    grid(doc, table)
        .iter()
        .enumerate()
        .find_map(|(r, row)| row.iter().position(|c| *c == cell).map(|c| (r, c)))
}

fn empty_cell() -> DetachedBlock {
    DetachedBlock::leaf(
        BlockKindData::TableCell,
        BlockContent::Inline(InlineText::new()),
    )
}

fn empty_row(cols: usize) -> DetachedBlock {
    DetachedBlock::container(
        BlockKindData::TableRow,
        (0..cols).map(|_| empty_cell()).collect(),
    )
}

fn aligns(doc: &EditorDocument, table: BlockId) -> Vec<ColumnAlign> {
    match doc.kind(table) {
        Some(BlockKindData::Table { aligns }) => aligns.clone(),
        _ => Vec::new(),
    }
}

/// Which table edit to make at the caret's cell, or across the rows and
/// columns of a cell selection (D20).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum TableEdit {
    /// Insert an empty row above the topmost selected row.
    AddRowAbove,
    /// Insert an empty row below the bottommost selected row.
    AddRowBelow,
    /// Remove the selected row(s); removing every row removes the table.
    RemoveRow,
    /// Insert an empty column left of the leftmost selected column.
    AddColumnLeft,
    /// Insert an empty column right of the rightmost selected column.
    AddColumnRight,
    /// Remove the selected column(s); removing every column removes the table.
    RemoveColumn,
    /// Set the alignment of the selected column(s).
    SetColumnAlign(ColumnAlign),
}

/// A table row or column, as a grip names it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TableLine {
    Row(usize),
    Column(usize),
}

include!("table/part_0.rs");
include!("table/part_1.rs");

fn empty_paragraph() -> DetachedBlock {
    DetachedBlock::leaf(
        BlockKindData::Paragraph,
        BlockContent::Inline(InlineText::new()),
    )
}

/// The trimmed byte ranges of the cells of a `| a | b |` line, if it is one
/// (starts and ends with `|`, at least one cell; `\|` does not split).
pub(crate) fn table_row_cells(text: &str) -> Option<Vec<std::ops::Range<usize>>> {
    let start = text.len() - text.trim_start().len();
    let end = text.trim_end().len();
    let line = &text[start..end];
    if line.len() < 2 || !line.starts_with('|') || !line.ends_with('|') || line.contains('\n') {
        return None;
    }
    let mut bars = Vec::new();
    let bytes = text.as_bytes();
    for i in start..end {
        if bytes[i] == b'|' && (i == 0 || bytes[i - 1] != b'\\') {
            bars.push(i);
        }
    }
    if bars.len() < 2 {
        return None;
    }
    Some(
        bars.windows(2)
            .map(|w| {
                let (a, b) = (w[0] + 1, w[1]);
                let cell = &text[a..b];
                let lead = cell.len() - cell.trim_start().len();
                a + lead..a + cell.trim_end().len()
            })
            .map(|r| if r.start > r.end { r.start..r.start } else { r })
            .collect(),
    )
}
