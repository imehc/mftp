// Upstream command.rs; split at impl method boundaries without changing behavior.
impl BlockEditorModel {

    fn paste_block_markdown(&mut self, text: &str, own: bool) -> Result<bool, CommandError> {
        // Single-line text is plain unless it holds an inline atom's
        // Markdown (a copied image), which pastes back as the atom, or an
        // inline code span (`x`), which pastes back as code.
        if !own
            && !text.trim_end_matches('\n').contains('\n')
            && !text.contains("![")
            && !text.contains('`')
        {
            return Ok(false);
        }
        let Ok(parsed) =
            gpui_kit::base::text::editor_host::parse_markdown(text, self.doc.extensions.clone())
        else {
            return Ok(false);
        };
        let mut defs = super::import::Defs::new();
        super::import::collect_definitions(&parsed, &mut defs);
        let mut blocks = Vec::new();
        for node in parsed.iter() {
            super::import::import_block(node, &defs, &mut blocks);
        }
        // Nothing structural (one paragraph, soft line breaks only): plain
        // text, where each line becomes a block as typed.
        let has_atoms = |block: &DetachedBlock| {
            matches!(
                &block.content,
                DetachedContent::Leaf(BlockContent::Inline(inline))
                    if inline.text().contains(super::inline::ATOM_CHAR)
                        || inline.pieces().any(|(_, mark, _)| mark.code)
            )
        };
        if blocks.is_empty()
            || (blocks.len() == 1
                && blocks[0].kind == BlockKindData::Paragraph
                && !has_atoms(&blocks[0]))
        {
            return Ok(false);
        }
        if self.selected_blocks().is_some() {
            self.delete_blocks()?;
        }
        let range = self.resolved()?;
        let editable = |doc: &EditorDocument, pos: BlockPosition| {
            doc.inline(pos.block).is_some()
                && doc.kind(pos.block) != Some(&BlockKindData::TableCell)
        };
        if !editable(&self.doc, range.start) || !editable(&self.doc, range.end) {
            return Ok(false);
        }
        let paragraph_inline = |block: &DetachedBlock| match (&block.kind, &block.content) {
            (BlockKindData::Paragraph, DetachedContent::Leaf(BlockContent::Inline(inline))) => {
                Some(inline.clone())
            }
            _ => None,
        };
        self.transact(EditOrigin::Paste, |tx| {
            let pos = if range.is_collapsed() {
                range.start
            } else {
                delete_range(tx, range)?
            };
            let mut blocks = blocks;
            let head = blocks.first().and_then(paragraph_inline);
            if head.is_some() {
                blocks.remove(0);
            }
            let tail = if blocks.is_empty() {
                None
            } else {
                blocks.last().and_then(paragraph_inline)
            };
            if tail.is_some() {
                blocks.pop();
            }
            // Only one paragraph: plain inline insertion with its marks.
            if blocks.is_empty() && tail.is_none() {
                let inline = head.unwrap_or_default();
                let len = inline.len();
                tx.replace_text(pos.block, pos.offset..pos.offset, inline)?;
                return Ok(caret(BlockPosition::new(pos.block, pos.offset + len)));
            }
            let left = pos.block;
            let right = split_at(tx, pos)?.block;
            let merged_head = head.is_some();
            if let Some(head) = head {
                let at = tx.doc.leaf_len(left).unwrap_or(0);
                tx.replace_text(left, at..at, head)?;
            }
            let mut caret_at = BlockPosition::new(right, 0);
            if let Some(tail) = tail.clone() {
                caret_at.offset = tail.len();
                tx.replace_text(right, 0..0, tail)?;
            }
            let (parent, index) = tx
                .doc
                .index_in_parent(left)
                .ok_or(PositionError::UnknownBlock(left))?;
            let last = blocks.last().map(|b| b.id);
            tx.insert(parent, index + 1, blocks)?;
            // Halves that stayed empty go away.
            if !merged_head && tx.doc.leaf_len(left) == Some(0) {
                tx.remove_block(left)?;
            }
            if tail.is_none()
                && tx.doc.leaf_len(right) == Some(0)
                && let Some(last) = last
            {
                tx.remove_block(right)?;
                caret_at = tx.doc.last_leaf_in(last);
            }
            Ok(caret(caret_at))
        })?;
        Ok(true)
    }

    /// A `BlockSelection::Blocks` as its parent and child index range.
    pub(crate) fn selected_blocks(&self) -> Option<(BlockId, std::ops::Range<usize>)> {
        let BlockSelection::Blocks { anchor, head } = &self.selection else {
            return None;
        };
        let (parent, a) = self.doc.index_in_parent(*anchor)?;
        let (_, b) = self.doc.index_in_parent(*head)?;
        Some((parent, a.min(b)..a.max(b) + 1))
    }

    /// Remove the selected blocks; the caret goes to the block that took
    /// their place (an empty paragraph when nothing is left).
    fn delete_blocks(&mut self) -> Result<bool, CommandError> {
        let Some((parent, range)) = self.selected_blocks() else {
            return Ok(false);
        };
        self.transact(EditOrigin::Command("delete_blocks"), |tx| {
            let start = range.start;
            tx.remove(parent, range)?;
            let children = tx.doc.children(parent).to_vec();
            let pos = if let Some(next) = children.get(start) {
                tx.doc.first_leaf_in(*next)
            } else if let Some(prev) = start.checked_sub(1).and_then(|i| children.get(i)) {
                tx.doc.last_leaf_in(*prev)
            } else {
                let paragraph = DetachedBlock::paragraph(InlineText::new());
                let id = paragraph.id;
                tx.insert(parent, start, vec![paragraph])?;
                BlockPosition::new(id, 0)
            };
            Ok(caret(pos))
        })
    }

    /// Backspace at the start of a block after a table (or Delete at the end
    /// of one before it) selects the table as a node instead of editing its
    /// cells (no in-place cell editing yet).
    fn select_adjacent_table(
        &mut self,
        pos: BlockPosition,
        forward: bool,
    ) -> Result<bool, CommandError> {
        let Some(len) = self.doc.leaf_len(pos.block) else {
            return Ok(false);
        };
        if self.doc.kind(pos.block) == Some(&BlockKindData::TableCell)
            || (forward && pos.offset < len)
            || (!forward && pos.offset > 0)
        {
            return Ok(false);
        }
        let leaves = self.doc.walk_leaves();
        let Some(ix) = leaves.iter().position(|id| *id == pos.block) else {
            return Ok(false);
        };
        let neighbour = if forward {
            leaves.get(ix + 1)
        } else {
            ix.checked_sub(1).and_then(|i| leaves.get(i))
        };
        let Some(&cell) = neighbour else {
            return Ok(false);
        };
        let Some(table) = self.table_of(cell) else {
            return Ok(false);
        };
        self.set_selection(BlockSelection::Blocks {
            anchor: table,
            head: table,
        })?;
        Ok(true)
    }

    /// The table containing a cell.
    pub(crate) fn table_of(&self, cell: BlockId) -> Option<BlockId> {
        if self.doc.kind(cell) != Some(&BlockKindData::TableCell) {
            return None;
        }
        self.doc
            .path(cell)
            .into_iter()
            .rev()
            .find(|id| matches!(self.doc.kind(*id), Some(BlockKindData::Table { .. })))
    }

    /// Run an [`EditorCommand`]; returns whether the document or selection changed.
    pub fn run(&mut self, command: EditorCommand) -> Result<bool, CommandError> {
        match command {
            EditorCommand::SelectAll => {
                let selection = BlockSelection::Text {
                    anchor: self.doc.first_caret(),
                    head: self.doc.last_caret(),
                };
                self.set_selection(selection)?;
                Ok(true)
            }
            EditorCommand::DeleteSelection => {
                if self.selected_cells().is_some() {
                    return self.clear_cells(EditOrigin::Command("clear_cells"));
                }
                if self.selected_blocks().is_some() {
                    return self.delete_blocks();
                }
                let range = self.resolved()?;
                if range.is_collapsed() {
                    return Ok(false);
                }
                self.transact(EditOrigin::Command("delete_selection"), |tx| {
                    Ok(caret(delete_range(tx, range)?))
                })
            }
            EditorCommand::ToggleMark(kind) => {
                if kind == MarkKind::Link {
                    return Err(CommandError::Unsupported("toggle link: use ApplyMark"));
                }
                let change = if self.mark_state(kind) == MarkState::On {
                    MarkChange::new().clear(kind)
                } else {
                    MarkChange::new().set(kind)
                };
                self.apply_mark(change)
            }
            EditorCommand::ApplyMark(change) => self.apply_mark(change),
            EditorCommand::SetBlockKind(kind) => self.set_block_kind(kind),
            EditorCommand::ToggleList { ordered } => self.toggle_list(ordered),
            EditorCommand::ToggleTask => {
                // On a paragraph the Task button makes it a task item (a
                // bullet list item with an empty checkbox), like Bullets.
                let in_item = {
                    let resolved = self.caret_resolved()?;
                    resolved.nearest(&self.doc, is_list_item).is_some()
                };
                if !in_item && !self.toggle_list(false)? {
                    return Ok(false);
                }
                self.toggle_task_item()
            }
            EditorCommand::SetTaskChecked(on) => self.with_item("set_task_checked", |tx, item| {
                if let Some(BlockKindData::ListItem { spread, .. }) = tx.doc.kind(item).cloned() {
                    tx.set_kind(
                        item,
                        BlockKindData::ListItem {
                            checked: Some(on),
                            spread,
                        },
                    )?;
                }
                Ok(())
            }),
            EditorCommand::Indent | EditorCommand::Outdent
                if self
                    .caret()
                    .is_some_and(|c| self.doc.plain(c.block).is_some()) =>
            {
                let pos = self.caret().unwrap_or_else(|| self.doc.first_caret());
                self.code_indent(pos, command == EditorCommand::Outdent)
            }
            EditorCommand::Indent | EditorCommand::Outdent if self.current_cell().is_some() => {
                self.tab_cell(command == EditorCommand::Outdent)
            }
            EditorCommand::InsertTable { rows, cols } => self.insert_table(rows, cols),
            EditorCommand::EditTable(edit) => self.edit_table(edit),
            EditorCommand::Indent => self.indent(),
            EditorCommand::Outdent => self.outdent(),
            EditorCommand::SetCodeBlock { lang } => self.set_code_block(lang),
            EditorCommand::ToggleBlockquote => self.toggle_blockquote(),
            EditorCommand::MoveBlocks { down } => self.move_blocks(down),
            EditorCommand::InsertBlock(BlockKind::HorizontalRule) => {
                let pos = self
                    .caret()
                    .ok_or(CommandError::Unsupported("block selection"))?;
                self.transact(EditOrigin::Command("insert_block"), |tx| {
                    let (parent, index) = tx
                        .doc
                        .index_in_parent(pos.block)
                        .ok_or(PositionError::UnknownBlock(pos.block))?;
                    let rule = DetachedBlock::leaf(
                        BlockKindData::HorizontalRule,
                        BlockContent::Atom(super::document::AtomData::None),
                    );
                    tx.insert(parent, index + 1, vec![rule])?;
                    Ok(None)
                })
            }
            EditorCommand::InsertBlock(_) => Err(CommandError::Unsupported("insert_block kind")),
        }
    }

    fn apply_mark(&mut self, change: MarkChange) -> Result<bool, CommandError> {
        let range = self.resolved()?;
        if range.is_collapsed() {
            let current = self.active_marks().0;
            self.stored_marks = Some(change.apply(&current));
            return Ok(false);
        }
        let ranges = match self.selected_cells() {
            Some(cells) => cells
                .into_iter()
                .flatten()
                .map(|c| (c, 0, self.doc.leaf_len(c).unwrap_or(0)))
                .collect(),
            None => self.text_ranges(range),
        };
        let selection = self.selection.clone();
        self.transact(EditOrigin::Command("toggle_mark"), |tx| {
            for (block, lo, hi) in ranges {
                let Some(inline) = tx.doc.inline(block) else {
                    continue;
                };
                if lo >= hi {
                    continue;
                }
                let mut marked = inline.slice(lo..hi);
                let len = marked.len();
                marked.map_marks(0..len, |mark| change.apply(mark));
                if marked != inline.slice(lo..hi) {
                    tx.replace_text(block, lo..hi, marked)?;
                }
            }
            Ok(Some(selection))
        })
    }

    fn set_block_kind(&mut self, kind: BlockKind) -> Result<bool, CommandError> {
        let data = match kind {
            BlockKind::Paragraph => BlockKindData::Paragraph,
            BlockKind::Heading { level } if (1..=6).contains(&level) => {
                BlockKindData::Heading { level }
            }
            _ => return Err(CommandError::Unsupported("set_block_kind target")),
        };
        if let Some(pos) = self.caret()
            && matches!(
                self.doc.kind(pos.block),
                Some(BlockKindData::CodeBlock { .. })
            )
        {
            return self.code_block_to_text(pos, data);
        }
        let range = self.resolved()?;
        let blocks: Vec<BlockId> = self
            .text_ranges(range)
            .into_iter()
            .map(|(id, _, _)| id)
            .filter(|id| {
                matches!(
                    self.doc.kind(*id),
                    Some(BlockKindData::Paragraph | BlockKindData::Heading { .. })
                )
            })
            .collect();
        self.transact(EditOrigin::Command("set_block_kind"), |tx| {
            for id in blocks {
                tx.set_kind(id, data.clone())?;
            }
            Ok(None)
        })
    }

    /// Turn the caret's code block back into text blocks of `data`'s kind,
    /// one per code line, so no content is lost; the caret keeps its line
    /// and column. The text stays literal (no Markdown re-parse).
    fn code_block_to_text(
        &mut self,
        pos: BlockPosition,
        data: BlockKindData,
    ) -> Result<bool, CommandError> {
        let code = self.doc.plain(pos.block).unwrap_or_default().to_string();
        self.transact(EditOrigin::Command("set_block_kind"), |tx| {
            let (parent, index) = tx
                .doc
                .index_in_parent(pos.block)
                .ok_or(PositionError::UnknownBlock(pos.block))?;
            tx.remove_block(pos.block)?;
            let mut start = 0;
            let mut after = None;
            let blocks: Vec<DetachedBlock> = code
                .split('\n')
                .map(|line| {
                    let block = DetachedBlock::leaf(
                        data.clone(),
                        BlockContent::Inline(InlineText::plain(line, TextMark::default())),
                    );
                    let end = start + line.len();
                    if after.is_none() && pos.offset <= end {
                        after = Some(BlockPosition::new(block.id, pos.offset - start));
                    }
                    start = end + 1;
                    block
                })
                .collect();
            tx.insert(parent, index, blocks)?;
            Ok(after.map(BlockSelection::caret))
        })
    }

    fn caret_resolved(&self) -> Result<ResolvedPosition, CommandError> {
        let pos = self
            .caret()
            .ok_or(CommandError::Unsupported("block selection"))?;
        Ok(ResolvedPosition::resolve(&self.doc, pos)?)
    }

    fn with_item(
        &mut self,
        name: &'static str,
        f: impl FnOnce(&mut TransactionBuilder<'_>, BlockId) -> Result<(), CommandError>,
    ) -> Result<bool, CommandError> {
        let resolved = self.caret_resolved()?;
        let Some(item) = resolved.nearest(&self.doc, is_list_item) else {
            return Ok(false);
        };
        self.transact(EditOrigin::Command(name), |tx| {
            f(tx, item)?;
            Ok(None)
        })
    }

    fn toggle_task_item(&mut self) -> Result<bool, CommandError> {
        self.with_item("toggle_task", |tx, item| {
            if let Some(BlockKindData::ListItem { checked, spread }) = tx.doc.kind(item).cloned() {
                let checked = if checked.is_some() { None } else { Some(false) };
                tx.set_kind(item, BlockKindData::ListItem { checked, spread })?;
            }
            Ok(())
        })
    }
}
