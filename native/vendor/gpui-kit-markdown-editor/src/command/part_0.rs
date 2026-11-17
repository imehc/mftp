// Upstream command.rs; split at impl method boundaries without changing behavior.
impl BlockEditorModel {
    /// Marks for text typed at `pos` (D6): bold/italic/strike/underline/
    /// highlight extend at their trailing edge; link and code only apply
    /// strictly inside.
    pub(crate) fn inherited_marks(&self, pos: BlockPosition) -> TextMark {
        let Some(inline) = self.doc.inline(pos.block) else {
            return TextMark::default();
        };
        let before = inline.mark_before(pos.offset);
        let after = inline.mark_after(pos.offset);
        match (before, after) {
            (Some(b), Some(a)) if b == a => b.clone(),
            (Some(b), _) => {
                let mut mark = b.clone();
                for kind in [MarkKind::Link, MarkKind::Code] {
                    if !kind.extends_at_boundary() {
                        mark = MarkChange::new().clear(kind).apply(&mark);
                    }
                }
                mark
            }
            _ => TextMark::default(),
        }
    }

    /// Per-leaf `(block, start, end)` covered by a text range.
    pub(crate) fn text_ranges(&self, range: ResolvedSelection) -> Vec<(BlockId, usize, usize)> {
        // O(1) leaf lookups through the order index (Phase 5: painting a
        // selection costs O(selected leaves), not O(document)).
        let leaves = self.doc.leaves();
        let (Some(si), Some(ei)) = (
            self.doc.order.rank(range.start.block).map(|r| r as usize),
            self.doc.order.rank(range.end.block).map(|r| r as usize),
        ) else {
            return Vec::new();
        };
        leaves[si..=ei]
            .iter()
            .map(|id| {
                let len = self.doc.leaf_len(*id).unwrap_or(0);
                let lo = if *id == range.start.block {
                    range.start.offset
                } else {
                    0
                };
                let hi = if *id == range.end.block {
                    range.end.offset
                } else {
                    len
                };
                (*id, lo, hi)
            })
            .collect()
    }

    fn resolved(&self) -> Result<ResolvedSelection, CommandError> {
        Ok(self.doc.resolve_selection(&self.selection)?)
    }

    /// Insert plain text at the selection (replacing it); `\n` splits blocks.
    pub fn insert_text(&mut self, text: &str, origin: EditOrigin) -> Result<(), CommandError> {
        // Typing over a node or cell selection first replaces it; the
        // replacement and the typing are one undo step.
        if self.selected_cells().is_some() || self.selected_blocks().is_some() {
            self.history.begin_transaction();
            let result = (|| {
                if self.selected_cells().is_some() {
                    self.clear_cells(origin)?;
                } else {
                    self.replace_blocks_with_paragraph(origin)?;
                }
                self.insert_text_at_selection(text, origin)
            })();
            self.history.commit_transaction();
            return result;
        }
        self.insert_text_at_selection(text, origin)
    }

    /// Replace a `BlockSelection::Blocks` by one empty paragraph holding
    /// the caret (like Select All + typing).
    fn replace_blocks_with_paragraph(&mut self, origin: EditOrigin) -> Result<bool, CommandError> {
        let Some((parent, range)) = self.selected_blocks() else {
            return Ok(false);
        };
        self.transact(origin, |tx| {
            let start = range.start;
            tx.remove(parent, range)?;
            let paragraph = DetachedBlock::paragraph(InlineText::new());
            let id = paragraph.id;
            tx.insert(parent, start, vec![paragraph])?;
            Ok(caret(BlockPosition::new(id, 0)))
        })
    }

    fn insert_text_at_selection(
        &mut self,
        text: &str,
        origin: EditOrigin,
    ) -> Result<(), CommandError> {
        let range = self.resolved()?;
        let stored = self.stored_marks.clone();
        let marks = match &stored {
            Some(marks) => marks.clone(),
            None => self.inherited_marks(range.start),
        };
        self.transact(origin, |tx| {
            let mut pos = if range.is_collapsed() {
                range.start
            } else {
                delete_range(tx, range)?
            };
            if tx.doc.plain(pos.block).is_some() {
                // Code: raw text, newlines included; marks do not apply.
                let text = text.replace('\r', "");
                tx.replace_plain(pos.block, pos.offset..pos.offset, &text)?;
                pos.offset += text.len();
                return Ok(caret(pos));
            }
            for (ix, line) in text.split('\n').enumerate() {
                if ix > 0 {
                    pos = split_at(tx, pos)?;
                }
                let Some(inline) = tx.doc.inline(pos.block) else {
                    return Err(CommandError::NotEditable(pos.block));
                };
                let _ = inline;
                let insert = InlineText::plain(line, marks.clone());
                let len = insert.len();
                tx.replace_text(pos.block, pos.offset..pos.offset, insert)?;
                pos.offset += len;
            }
            Ok(caret(pos))
        })?;
        Ok(())
    }

    /// Paste the editor's own inline Markdown copy (D17): each line is
    /// parsed as inline Markdown (marks survive), lines become blocks as
    /// typed. Edge whitespace stays literal. One undo step. In a code block
    /// the marks are dropped (the text is inserted raw); `Ok(false)` when
    /// the target cannot take it (a table cell with several lines).
    pub fn paste_inline_markdown(&mut self, text: &str) -> Result<bool, CommandError> {
        let lines: Vec<InlineText> = text
            .split('\n')
            .map(|l| self.inline_from_markdown(l))
            .collect();
        let cell = |m: &Self| m.current_cell().is_some();
        if lines.len() > 1 && cell(self) {
            return Ok(false);
        }
        self.history.begin_transaction();
        let result = (|| {
            if self.selected_cells().is_some() {
                self.clear_cells(EditOrigin::Paste)?;
            } else if self.selected_blocks().is_some() {
                self.replace_blocks_with_paragraph(EditOrigin::Paste)?;
            }
            let range = self.resolved()?;
            self.transact(EditOrigin::Paste, |tx| {
                let mut pos = if range.is_collapsed() {
                    range.start
                } else {
                    delete_range(tx, range)?
                };
                if tx.doc.plain(pos.block).is_some() {
                    let raw = lines
                        .iter()
                        .map(InlineText::text)
                        .collect::<Vec<_>>()
                        .join("\n");
                    tx.replace_plain(pos.block, pos.offset..pos.offset, &raw)?;
                    pos.offset += raw.len();
                    return Ok(caret(pos));
                }
                for (ix, line) in lines.iter().enumerate() {
                    if ix > 0 {
                        pos = split_at(tx, pos)?;
                    }
                    if tx.doc.inline(pos.block).is_none() {
                        return Err(CommandError::NotEditable(pos.block));
                    }
                    let len = line.len();
                    tx.replace_text(pos.block, pos.offset..pos.offset, line.clone())?;
                    pos.offset += len;
                }
                Ok(caret(pos))
            })
        })();
        self.history.commit_transaction();
        result.map(|_| true)
    }

    /// One line of inline Markdown as marked text. Leading and trailing
    /// whitespace stays literal (a Markdown paragraph would drop it); a line
    /// that does not parse to exactly one paragraph is kept as plain text.
    fn inline_from_markdown(&self, line: &str) -> InlineText {
        let core = line.trim();
        if core.is_empty() {
            return InlineText::plain(line, TextMark::default());
        }
        let start = line.len() - line.trim_start().len();
        let parsed =
            gpui_kit::base::text::editor_host::parse_markdown(core, self.doc.extensions.clone())
                .ok()
                .and_then(|parsed| {
                    let mut defs = super::import::Defs::new();
                    super::import::collect_definitions(&parsed, &mut defs);
                    let mut blocks = Vec::new();
                    for node in parsed.iter() {
                        super::import::import_block(node, &defs, &mut blocks);
                    }
                    match (blocks.len(), blocks.pop()) {
                        (1, Some(block)) if block.kind == BlockKindData::Paragraph => {
                            match block.content {
                                DetachedContent::Leaf(BlockContent::Inline(inline)) => Some(inline),
                                _ => None,
                            }
                        }
                        _ => None,
                    }
                });
        let Some(inline) = parsed else {
            return InlineText::plain(line, TextMark::default());
        };
        let mut out = InlineText::plain(&line[..start], TextMark::default());
        out.push(inline);
        out.push(InlineText::plain(
            &line[start + core.len()..],
            TextMark::default(),
        ));
        out
    }

    /// Backspace (`forward == false`) or Delete: a grapheme, the selection, a join with the neighbouring block, or (next to a table) select the table.
    pub fn delete(&mut self, forward: bool) -> Result<(), CommandError> {
        self.delete_as(forward, false)
    }

    /// [`Self::delete`]; `word` records it as a word delete (D21), which
    /// coalesces only with other word deletes.
    pub(crate) fn delete_as(&mut self, forward: bool, word: bool) -> Result<(), CommandError> {
        if self.selected_cells().is_some() {
            return self
                .clear_cells(EditOrigin::Command("clear_cells"))
                .map(|_| ());
        }
        if self.selected_blocks().is_some() {
            return self.delete_blocks().map(|_| ());
        }
        let range = self.resolved()?;
        // Backspace at the start of a heading: back to a paragraph, keeping
        // the text and marks, wherever the heading sits.
        if !forward
            && range.is_collapsed()
            && range.start.offset == 0
            && matches!(
                self.doc.kind(range.start.block),
                Some(BlockKindData::Heading { .. })
            )
        {
            return self.heading_to_paragraph(range.start.block, "heading_backspace");
        }
        if range.is_collapsed() && self.select_adjacent_table(range.start, forward)? {
            return Ok(());
        }
        // Backspace at the start of a quote's first paragraph, or of a list
        // item's trailing empty paragraph: lift it (one undo step).
        if !forward
            && range.is_collapsed()
            && range.start.offset == 0
            && (self.lift_first_in_quote(range.start)?
                || self.lift_item_trailing(range.start, false)?)
        {
            return Ok(());
        }
        // Backspace at the start (Delete at the end) of a non-empty code
        // block: never merge text into or out of code; step the caret to the
        // neighbouring leaf instead.
        if range.is_collapsed()
            && let Some(code) = self.doc.plain(range.start.block)
            && !code.is_empty()
            && ((!forward && range.start.offset == 0)
                || (forward && range.start.offset == code.len()))
        {
            let leaves = self.doc.walk_leaves();
            let ix = leaves.iter().position(|id| *id == range.start.block);
            let target = ix.and_then(|ix| {
                if forward {
                    leaves.get(ix + 1).map(|id| (*id, 0))
                } else {
                    ix.checked_sub(1)
                        .and_then(|i| leaves.get(i))
                        .map(|id| (*id, self.doc.leaf_len(*id).unwrap_or(0)))
                }
            });
            if let Some((block, offset)) = target {
                self.set_selection(BlockSelection::caret(BlockPosition::new(block, offset)))?;
            }
            return Ok(());
        }
        let origin = match (forward, word) {
            (true, true) => EditOrigin::WordDelete,
            (false, true) => EditOrigin::WordBackspace,
            (true, false) => EditOrigin::DeleteForward,
            (false, false) => EditOrigin::Backspace,
        };
        self.transact(origin, |tx| {
            if !range.is_collapsed() {
                let pos = delete_range(tx, range)?;
                drop_empty_heading(tx, pos.block)?;
                return Ok(caret(pos));
            }
            let pos = range.start;
            let doc = &*tx.doc;
            if let Some(code) = doc.plain(pos.block) {
                let prev = code[..pos.offset].chars().next_back().map(char::len_utf8);
                let next = code[pos.offset..].chars().next().map(char::len_utf8);
                match (forward, prev, next) {
                    (false, Some(n), _) => {
                        tx.replace_plain(pos.block, pos.offset - n..pos.offset, "")?;
                        return Ok(caret(BlockPosition::new(pos.block, pos.offset - n)));
                    }
                    (true, _, Some(n)) => {
                        tx.replace_plain(pos.block, pos.offset..pos.offset + n, "")?;
                        return Ok(caret(pos));
                    }
                    // Backspace at the start of an empty code block: back to
                    // a paragraph.
                    (false, None, None) => {
                        let (parent, index) = doc
                            .index_in_parent(pos.block)
                            .ok_or(PositionError::UnknownBlock(pos.block))?;
                        tx.remove_block(pos.block)?;
                        let paragraph = DetachedBlock::paragraph(InlineText::new());
                        let id = paragraph.id;
                        tx.insert(parent, index, vec![paragraph])?;
                        return Ok(caret(BlockPosition::new(id, 0)));
                    }
                    _ => return Ok(None),
                }
            }
            let Some(inline) = doc.inline(pos.block) else {
                // Caret on an atom or code block: delete the block.
                tx.remove_block(pos.block)?;
                return Ok(None);
            };
            if !forward && pos.offset > 0 {
                let prev = inline.prev_grapheme(pos.offset).unwrap_or(0);
                tx.replace_text(pos.block, prev..pos.offset, InlineText::new())?;
                drop_empty_heading(tx, pos.block)?;
                return Ok(caret(BlockPosition::new(pos.block, prev)));
            }
            if forward && pos.offset < inline.len() {
                let next = inline.next_grapheme(pos.offset).unwrap_or(inline.len());
                tx.replace_text(pos.block, pos.offset..next, InlineText::new())?;
                drop_empty_heading(tx, pos.block)?;
                return Ok(caret(pos));
            }
            if doc.kind(pos.block) == Some(&BlockKindData::TableCell) {
                return Ok(None);
            }
            // At a block edge: join with the neighbouring leaf.
            let leaves = doc.walk_leaves();
            let Some(ix) = leaves.iter().position(|id| *id == pos.block) else {
                return Ok(None);
            };
            let (first, second) = if forward {
                match leaves.get(ix + 1) {
                    Some(next) => (pos.block, *next),
                    None => return Ok(None),
                }
            } else {
                match ix.checked_sub(1).and_then(|i| leaves.get(i)) {
                    Some(prev) => (*prev, pos.block),
                    None => return Ok(None),
                }
            };
            if doc.kind(first) == Some(&BlockKindData::TableCell)
                || doc.kind(second) == Some(&BlockKindData::TableCell)
            {
                return Ok(None);
            }
            match (doc.inline(first), doc.inline(second)) {
                (Some(a), Some(b)) => {
                    let at = a.len();
                    let moved = b.clone();
                    tx.remove_block(second)?;
                    tx.replace_text(first, at..at, moved)?;
                    Ok(caret(BlockPosition::new(first, at)))
                }
                // A code block next door: step into it, never delete it.
                (None, Some(_)) if doc.plain(first).is_some() => {
                    let len = doc.leaf_len(first).unwrap_or(0);
                    Ok(caret(BlockPosition::new(first, len)))
                }
                (Some(_), None) if doc.plain(second).is_some() => {
                    Ok(caret(BlockPosition::new(second, 0)))
                }
                // The neighbour is an atom: remove it.
                _ => {
                    let other = if forward { second } else { first };
                    tx.remove_block(other)?;
                    Ok(caret(pos))
                }
            }
        })?;
        Ok(())
    }

    /// Enter: split the text block (in a list, a new item; in an empty item, exit or outdent).
    pub fn split_block(&mut self) -> Result<(), CommandError> {
        let range = self.resolved()?;
        // Enter in an empty heading: a paragraph, not another heading.
        if range.is_collapsed()
            && matches!(
                self.doc.kind(range.start.block),
                Some(BlockKindData::Heading { .. })
            )
            && self.doc.leaf_len(range.start.block) == Some(0)
        {
            return self.heading_to_paragraph(range.start.block, "heading_enter");
        }
        if range.is_collapsed() && self.exit_empty_item(range.start)? {
            return Ok(());
        }
        if range.is_collapsed() && self.lift_empty_trailing(range.start)? {
            return Ok(());
        }
        if self.doc.plain(range.start.block).is_some() {
            return self.code_enter(range).map(|_| ());
        }
        self.transact(EditOrigin::Command("split_block"), |tx| {
            let pos = if range.is_collapsed() {
                range.start
            } else {
                delete_range(tx, range)?
            };
            Ok(caret(split_at(tx, pos)?))
        })?;
        Ok(())
    }
}
