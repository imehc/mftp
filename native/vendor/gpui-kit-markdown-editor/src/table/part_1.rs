// Upstream table.rs; split at impl method boundaries without changing behavior.
impl BlockEditorModel {

    /// Whether the caret is in the last row of a table.
    pub(crate) fn in_last_table_row(&self) -> bool {
        self.current_cell().is_some_and(|(table, cell)| {
            cell_coords(&self.doc, table, cell)
                .is_some_and(|(r, _)| r + 1 == self.doc.children(table).len())
        })
    }

    /// The table input rule (D13): a paragraph `| a | b |` becomes a table
    /// with those cells as the header row and one empty body row, caret in
    /// its first cell; no alignment. One undo step. Returns `false` when
    /// `block` is not such a paragraph.
    pub(crate) fn paragraph_to_table(&mut self, block: BlockId) -> Result<bool, CommandError> {
        if self.doc.kind(block) != Some(&BlockKindData::Paragraph)
            || table_of(&self.doc, block).is_some()
        {
            return Ok(false);
        }
        let Some(inline) = self.doc.inline(block).cloned() else {
            return Ok(false);
        };
        let Some(ranges) = table_row_cells(inline.text()) else {
            return Ok(false);
        };
        let cols = ranges.len();
        let header = DetachedBlock::container(
            BlockKindData::TableRow,
            ranges
                .into_iter()
                .map(|r| {
                    DetachedBlock::leaf(
                        BlockKindData::TableCell,
                        BlockContent::Inline(inline.slice(r)),
                    )
                })
                .collect(),
        );
        let body = empty_row(cols);
        let mut ids = Vec::new();
        body.ids(&mut ids);
        let first = ids[1];
        let table = DetachedBlock::container(
            BlockKindData::Table {
                aligns: vec![ColumnAlign::None; cols],
            },
            vec![header, body],
        );
        self.transact(EditOrigin::InputRule("table"), |tx| {
            let (parent, index) = tx
                .doc
                .index_in_parent(block)
                .ok_or(PositionError::UnknownBlock(block))?;
            tx.remove_block(block)?;
            tx.insert(parent, index, vec![table])?;
            Ok(Some(BlockSelection::caret(BlockPosition::new(first, 0))))
        })?;
        Ok(true)
    }

}
