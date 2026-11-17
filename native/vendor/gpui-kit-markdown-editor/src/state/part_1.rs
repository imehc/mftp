// Upstream state.rs; split at impl method boundaries without changing behavior.
impl BlockEditorState {

    /// Per-leaf selected byte ranges, for painting.
    pub(crate) fn selection_ranges(&self) -> Vec<(BlockId, Range<usize>)> {
        if let Some(cells) = self.model.selected_cells() {
            return cells
                .into_iter()
                .flatten()
                .map(|c| (c, 0..self.model.doc.leaf_len(c).unwrap_or(0)))
                .collect();
        }
        let Ok(range) = self.model.doc.resolve_selection(self.model.selection()) else {
            return Vec::new();
        };
        if range.is_collapsed() {
            return Vec::new();
        }
        self.model
            .text_ranges(range)
            .into_iter()
            .map(|(id, lo, hi)| (id, lo..hi))
            .collect()
    }

    pub(crate) fn marked_range(&self) -> Option<(BlockId, Range<usize>)> {
        self.marked.as_ref().map(|m| (m.block, m.range.clone()))
    }

    pub(crate) fn show_caret(&self, window: &Window, cx: &App) -> bool {
        self.focus_handle.is_focused(window) && self.blink_cursor.read(cx).visible()
    }

    // ---- internal edit plumbing -------------------------------------------

    fn after_edit(&mut self, origin: EditOrigin, cx: &mut Context<Self>) {
        self.goal_x = None;
        self.reveal.set(true);
        self.pause_blink(cx);
        cx.emit(BlockEditorEvent::Changed {
            revision: self.model.revision(),
            origin,
        });
        cx.emit(BlockEditorEvent::SelectionChanged);
        cx.notify();
    }

    fn selection_changed(&mut self, cx: &mut Context<Self>) {
        self.reveal.set(true);
        self.pause_blink(cx);
        cx.emit(BlockEditorEvent::SelectionChanged);
        cx.notify();
    }

    fn pause_blink(&mut self, cx: &mut Context<Self>) {
        self.blink_cursor.update(cx, |b, cx| b.pause(cx));
    }

    fn edit(
        &mut self,
        origin: EditOrigin,
        f: impl FnOnce(&mut BlockEditorModel) -> Result<(), CommandError>,
        cx: &mut Context<Self>,
    ) {
        if self.readonly {
            return;
        }
        let revision = self.model.revision();
        // Errors (e.g. typing into a code block, Phase 4) leave the document
        // untouched; the spike ignores them.
        let _ = f(&mut self.model);
        if self.model.revision() != revision {
            self.after_edit(origin, cx);
        } else {
            cx.notify();
        }
    }

    fn end_composition(&mut self) {
        self.marked = None;
        if std::mem::take(&mut self.composition_open) {
            self.model.history.commit_transaction();
        }
    }

    /// A whole-block selection collapses to its start or end.
    fn collapse_blocks(&mut self, forward: bool, cx: &mut Context<Self>) -> bool {
        if !matches!(
            self.model.selection(),
            BlockSelection::Blocks { .. } | BlockSelection::Cells { .. }
        ) {
            return false;
        }
        if let Ok(range) = self.model.doc.resolve_selection(self.model.selection()) {
            let target = if forward { range.end } else { range.start };
            self.move_to(target, false, cx);
        }
        true
    }

    fn head_anchor(&self) -> Option<(BlockPosition, BlockPosition)> {
        match self.model.selection() {
            BlockSelection::Text { anchor, head } => Some((*anchor, *head)),
            BlockSelection::Blocks { .. } => None,
            BlockSelection::Cells { anchor, head } => {
                Some((BlockPosition::new(*anchor, 0), BlockPosition::new(*head, 0)))
            }
        }
    }

    fn move_to(&mut self, head: BlockPosition, extend: bool, cx: &mut Context<Self>) {
        let anchor = match (extend, self.head_anchor()) {
            (true, Some((anchor, _))) => anchor,
            _ => head,
        };
        self.end_composition();
        // A drag or Shift+arrow from one cell into another of the same table
        // selects cells, not text.
        let doc = &self.model.doc;
        let selection = match (
            super::table::table_of(doc, anchor.block),
            super::table::table_of(doc, head.block),
        ) {
            (Some(a), Some(b)) if a == b && anchor.block != head.block => BlockSelection::Cells {
                anchor: anchor.block,
                head: head.block,
            },
            _ => BlockSelection::Text { anchor, head },
        };
        let _ = self.model.set_selection(selection);
        self.selection_changed(cx);
    }

    /// One grapheme left/right, crossing leaf boundaries in document order.
    pub(crate) fn step_horizontal(&self, pos: BlockPosition, forward: bool) -> BlockPosition {
        let doc = &self.model.doc;
        let len = doc.leaf_len(pos.block).unwrap_or(0);
        if let Some(code) = doc.plain(pos.block) {
            let next = if forward {
                code[pos.offset..]
                    .chars()
                    .next()
                    .map(|c| pos.offset + c.len_utf8())
            } else {
                code[..pos.offset]
                    .chars()
                    .next_back()
                    .map(|c| pos.offset - c.len_utf8())
            };
            if let Some(offset) = next {
                return BlockPosition::new(pos.block, offset);
            }
        } else if let Some(inline) = doc.inline(pos.block) {
            let next = if forward {
                inline.next_grapheme(pos.offset)
            } else {
                inline.prev_grapheme(pos.offset)
            };
            if let Some(offset) = next.filter(|o| *o != pos.offset) {
                return BlockPosition::new(pos.block, offset);
            }
        } else if forward && pos.offset == 0 {
            return BlockPosition::new(pos.block, 1);
        } else if !forward && pos.offset == 1 {
            return BlockPosition::new(pos.block, 0);
        }
        let leaves = doc.leaves();
        let Some(ix) = leaves.iter().position(|id| *id == pos.block) else {
            return pos;
        };
        let neighbour = if forward {
            leaves.get(ix + 1)
        } else {
            ix.checked_sub(1).and_then(|i| leaves.get(i))
        };
        match neighbour {
            Some(id) if forward => BlockPosition::new(*id, 0),
            Some(id) => BlockPosition::new(*id, doc.leaf_len(*id).unwrap_or(0)),
            None => BlockPosition::new(pos.block, if forward { len } else { 0 }),
        }
    }

    /// The next word boundary from `pos` (skip spaces, then a word); at a
    /// leaf edge, one step into the neighbouring leaf.
    fn step_word(&self, pos: BlockPosition, forward: bool) -> BlockPosition {
        let Some(text) = self.model.doc.leaf_text(pos.block) else {
            return self.step_horizontal(pos, forward);
        };
        let is_word = |c: char| c.is_alphanumeric() || c == '_';
        let mut offset = pos.offset;
        if forward {
            let rest = &text[offset..];
            let mut it = rest.char_indices().peekable();
            while let Some((_, c)) = it.peek().copied()
                && !is_word(c)
            {
                it.next();
            }
            while let Some((_, c)) = it.peek().copied()
                && is_word(c)
            {
                it.next();
            }
            offset += it.peek().map(|(i, _)| *i).unwrap_or(rest.len());
        } else {
            let before = &text[..offset];
            let mut it = before.char_indices().rev().peekable();
            while let Some((_, c)) = it.peek().copied()
                && !is_word(c)
            {
                it.next();
            }
            let mut start = it.peek().map(|(i, c)| i + c.len_utf8()).unwrap_or(0);
            while let Some((i, c)) = it.peek().copied()
                && is_word(c)
            {
                start = i;
                it.next();
            }
            offset = if start < offset { start } else { 0 };
        }
        if offset == pos.offset {
            return self.step_horizontal(pos, forward);
        }
        self.model.doc.clamp(BlockPosition::new(pos.block, offset))
    }

    fn word(&mut self, forward: bool, extend: bool, cx: &mut Context<Self>) {
        if self.collapse_blocks(forward, cx) {
            return;
        }
        let Some((_, head)) = self.head_anchor() else {
            return;
        };
        self.goal_x = None;
        let next = self.step_word(head, forward);
        self.move_to(next, extend, cx);
    }

    pub(crate) fn on_move_word_left(
        &mut self,
        _: &MoveWordLeft,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.word(false, false, cx);
    }
    pub(crate) fn on_move_word_right(
        &mut self,
        _: &MoveWordRight,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.word(true, false, cx);
    }
    pub(crate) fn on_select_word_left(
        &mut self,
        _: &SelectWordLeft,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.word(false, true, cx);
    }
    pub(crate) fn on_select_word_right(
        &mut self,
        _: &SelectWordRight,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.word(true, true, cx);
    }

    fn horizontal(&mut self, forward: bool, extend: bool, cx: &mut Context<Self>) {
        if self.collapse_blocks(forward, cx) {
            return;
        }
        let Some((anchor, head)) = self.head_anchor() else {
            return;
        };
        self.goal_x = None;
        // Collapsing a range moves to its edge, like every text field.
        if !extend && anchor != head {
            let ord = self.model.doc.cmp_positions(anchor, head).ok();
            let pick_head = matches!(
                (forward, ord),
                (true, Some(std::cmp::Ordering::Less)) | (false, Some(std::cmp::Ordering::Greater))
            );
            let target = if pick_head { head } else { anchor };
            return self.move_to(target, false, cx);
        }
        let next = self.step_horizontal(head, forward);
        self.move_to(next, extend, cx);
    }

    fn vertical(&mut self, down: bool, extend: bool, cx: &mut Context<Self>) {
        if self.collapse_blocks(down, cx) {
            return;
        }
        let Some((_, head)) = self.head_anchor() else {
            return;
        };
        let leaves = self.snapshot().leaves.clone();
        let Some(ix) = leaves.iter().position(|l| l.block == head.block) else {
            return;
        };
        // The model-adjacent caret leaf, which may be culled (no geometry).
        let adjacent = if down {
            leaves.get(ix + 1)
        } else {
            ix.checked_sub(1).and_then(|i| leaves.get(i))
        };
        let frame = self.frame.clone();
        let frame = frame.borrow();
        let laid_out = frame.caret_bounds(head, self.style.caret_width());
        let x = laid_out.map(|caret| *self.goal_x.get_or_insert(caret.origin.x));
        let visual = x.and_then(|x| frame.vertical(head, x, down));
        let target = match (visual, adjacent) {
            // Within the block, or into the laid-out adjacent leaf.
            (Some(t), _) if t.block == head.block => t,
            // Down past a table's last row leaves the table (D13).
            _ if down && !extend && self.model.in_last_table_row() => {
                drop(frame);
                self.edit(
                    EditOrigin::Command("table_exit"),
                    |m| m.exit_table().map(|_| ()),
                    cx,
                );
                return;
            }
            (Some(t), Some(next)) if t.block == next.block => t,
            // Up/down inside a table goes to the cell above/below (cells of
            // one table are laid out together).
            (Some(t), _)
                if super::table::table_of(&self.model.doc, head.block).is_some_and(|table| {
                    super::table::table_of(&self.model.doc, t.block) == Some(table)
                }) =>
            {
                t
            }
            // Into a culled (or not yet laid-out) leaf: model fallback.
            (_, Some(next)) => {
                let offset = if down { 0 } else { next.len };
                BlockPosition::new(next.block, offset)
            }
            (_, None) if down && self.model.doc.plain(head.block).is_some() && !extend => {
                drop(frame);
                self.edit(
                    EditOrigin::Command("exit_code_block"),
                    |m| m.exit_code_block().map(|_| ()),
                    cx,
                );
                return;
            }
            (_, None) => {
                let doc = &self.model.doc;
                if down {
                    doc.last_caret()
                } else {
                    doc.first_caret()
                }
            }
        };
        drop(frame);
        let goal = self.goal_x;
        self.move_to(self.model.doc.clamp(target), extend, cx);
        self.goal_x = goal;
    }

    /// Home/End: the visual (soft-wrapped) line from the last frame, else
    /// the block edge.
    fn line_edge(&mut self, end: bool, extend: bool, cx: &mut Context<Self>) {
        if self.collapse_blocks(end, cx) {
            return;
        }
        let Some((_, head)) = self.head_anchor() else {
            return;
        };
        let target = self.visual_line_edge(head, end);
        self.goal_x = None;
        self.move_to(target, extend, cx);
    }

    /// Start or end of the visual (soft-wrapped) line holding `head`; the
    /// leaf's edge when it has no geometry.
    fn visual_line_edge(&self, head: BlockPosition, end: bool) -> BlockPosition {
        let visual = self.frame.borrow().line_edge(head, end);
        // End at a soft wrap: the line's end index is also the next line's
        // start, where the caret would draw. Stay before the wrap point.
        let visual = visual.map(|pos| {
            if !end || pos.block != head.block {
                return pos;
            }
            let frame = self.frame.borrow();
            let (Some(leaf), Some(inline)) =
                (frame.leaf(pos.block), self.model.doc.inline(pos.block))
            else {
                return pos;
            };
            let line_y = leaf.caret_point(head.offset).y;
            if pos.offset < inline.len() && leaf.caret_point(pos.offset).y > line_y {
                let prev = inline.prev_grapheme(pos.offset).unwrap_or(pos.offset);
                BlockPosition::new(pos.block, prev)
            } else {
                pos
            }
        });
        let target = visual.unwrap_or_else(|| {
            let offset = if end {
                self.model.doc.leaf_len(head.block).unwrap_or(0)
            } else {
                0
            };
            BlockPosition::new(head.block, offset)
        });
        self.model.doc.clamp(target)
    }

    /// Where a D21 line delete stops: the visual line edge in text, the code
    /// line (between newlines) in a code block; always inside `head`'s leaf.
    fn delete_line_target(&self, head: BlockPosition, end: bool) -> BlockPosition {
        if let Some(code) = self.model.doc.plain(head.block) {
            let offset = if end {
                code[head.offset..]
                    .find('\n')
                    .map_or(code.len(), |i| head.offset + i)
            } else {
                code[..head.offset].rfind('\n').map_or(0, |i| i + 1)
            };
            return BlockPosition::new(head.block, offset);
        }
        let target = self.visual_line_edge(head, end);
        if target.block == head.block {
            target
        } else {
            head
        }
    }
}
