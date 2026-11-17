// Upstream state.rs; split at impl method boundaries without changing behavior.
impl BlockEditorState {

    /// D22: the gap between top-level blocks nearest the pointer's `y`.
    fn drop_gap_at(&self, y: Pixels) -> Option<usize> {
        let blocks = self.top_level_bounds();
        let len = self.model.doc.children(self.model.doc.root).len();
        if blocks.is_empty() {
            return None;
        }
        Some(
            blocks
                .iter()
                .find(|(_, _, b)| y < b.center().y)
                .map_or_else(
                    || blocks.last().map_or(len, |(ix, _, _)| ix + 1),
                    |(ix, _, _)| *ix,
                ),
        )
    }

    /// D22: mouse-down on a handle arms a drag (the click itself is handled
    /// as before).
    pub(crate) fn arm_block_drag(&mut self, at: Point<Pixels>) {
        self.block_drag = self.drag_handle_at(at).map(|block| BlockDrag {
            block,
            start: at,
            active: false,
            drop: None,
        });
    }

    /// D22: pointer moved with the button down. Returns whether a block
    /// drag owns the move (no text selection then).
    pub(crate) fn block_drag_to(&mut self, at: Point<Pixels>, cx: &mut Context<Self>) -> bool {
        use gpui::px;
        let Some(mut drag) = self.block_drag else {
            return false;
        };
        if !drag.active {
            let d = at - drag.start;
            if d.x.abs().max(d.y.abs()) < px(4.) {
                return false;
            }
            drag.active = true;
            self.dragging = false;
            self.end_composition();
            let _ = self.model.set_selection(BlockSelection::Blocks {
                anchor: drag.block,
                head: drag.block,
            });
            self.selection_changed(cx);
        }
        drag.drop = self.drop_gap_at(at.y);
        self.block_drag = Some(drag);
        cx.notify();
        true
    }

    /// D22: button released. Drops an active drag (one undo step).
    pub(crate) fn finish_block_drag(&mut self, cx: &mut Context<Self>) {
        let Some(drag) = self.block_drag.take() else {
            return;
        };
        if drag.active {
            if let Some(to) = drag.drop {
                self.model.break_coalescing();
                self.edit(
                    EditOrigin::Command("move_block_to"),
                    |m| m.move_block_to(drag.block, to).map(|_| ()),
                    cx,
                );
                self.model.break_coalescing();
            }
            cx.notify();
        }
    }

    /// D22: where to paint the drop indicator of an active drag: a line in
    /// the gap, spanning the blocks' width.
    pub(crate) fn drop_indicator(&self) -> Option<Bounds<Pixels>> {
        use gpui::{point, px, size};
        let drag = self.block_drag.filter(|d| d.active)?;
        let to = drag.drop?;
        let blocks = self.top_level_bounds();
        let left = blocks
            .iter()
            .map(|(_, _, b)| b.left())
            .reduce(Pixels::min)?;
        let right = blocks
            .iter()
            .map(|(_, _, b)| b.right())
            .reduce(Pixels::max)?;
        let prev = blocks.iter().rev().find(|(ix, _, _)| *ix < to);
        let next = blocks.iter().find(|(ix, _, _)| *ix >= to);
        let y = match (prev, next) {
            (Some((_, _, a)), Some((_, _, b))) => (a.bottom() + b.top()) / 2.,
            (None, Some((_, _, b))) => b.top() - px(3.),
            (Some((_, _, a)), None) => a.bottom() + px(3.),
            (None, None) => return None,
        };
        Some(gpui::Bounds::new(
            point(left - px(8.), y - px(1.)),
            size(right - left + px(8.), px(2.)),
        ))
    }

    /// Whole-table handles: a square straddling each table frame's outer
    /// top-left corner, clear of the column grips (above the cells) and the
    /// row grips (left of the cells).
    pub(crate) fn table_handles(&self) -> Vec<(BlockId, Bounds<Pixels>)> {
        use gpui::{point, px, size};
        self.frame
            .borrow()
            .grids
            .iter()
            .map(|g| {
                let o = g.bounds.origin;
                let s = px(TABLE_HANDLE_SIZE);
                (
                    g.table,
                    Bounds::new(
                        point(o.x - px(TABLE_HANDLE_OUTSET), o.y - px(TABLE_HANDLE_OUTSET)),
                        size(s, s),
                    ),
                )
            })
            .collect()
    }

    /// The table whose corner handle (with a little slack) is under `at`.
    pub(crate) fn table_handle_at(&self, at: Point<Pixels>) -> Option<BlockId> {
        self.table_handles()
            .into_iter()
            .find(|(_, b)| b.dilate(gpui::px(2.)).contains(&at))
            .map(|(table, _)| table)
    }

    /// The table (by its corner handle) or code block (by the strip left of
    /// its text, inside the block's padding) whose handle is under `at`.
    pub(crate) fn block_handle_at(&self, at: Point<Pixels>) -> Option<BlockId> {
        use gpui::px;
        let in_edge = |b: &Bounds<Pixels>| {
            at.y >= b.top() && at.y < b.bottom() && at.x < b.left() && at.x >= b.left() - px(24.)
        };
        // Tables: only the corner handle, so the left edge stays free for
        // the row grips (no two "select" targets side by side).
        if let Some(table) = self.table_handle_at(at) {
            return Some(table);
        }
        let frame = self.frame.borrow();
        frame
            .leaves
            .iter()
            .find(|leaf| self.model.doc.plain(leaf.info.block).is_some() && in_edge(&leaf.bounds()))
            .map(|leaf| leaf.info.block)
    }

    /// The start of the inline atom drawn under the window point `at` in
    /// the leaf a hit test found.
    fn atom_under(&self, pos: BlockPosition, at: Point<Pixels>) -> Option<BlockPosition> {
        let frame = self.frame.borrow();
        let range = frame.leaf(pos.block)?.atom_at(at)?;
        Some(BlockPosition::new(pos.block, range.start))
    }

    fn toggle_mark(&mut self, kind: MarkKind, cx: &mut Context<Self>) {
        let _ = self.run(EditorCommand::ToggleMark(kind), cx);
    }

    /// The selection as clipboard text, and whether it is the editor's own
    /// inline Markdown (D17): then the copy is tagged with
    /// [`COPY_TAG`] so paste parses it back.
    fn selected_text(&self) -> (String, CopyKind) {
        if let Some(table) = self.model.cells_markdown() {
            return (table, CopyKind::Blocks);
        }
        if let Some((parent, range)) = self.model.selected_blocks() {
            let ids = &self.model.doc.children(parent)[range];
            return (
                super::serialize::join_blocks(&self.model.doc, ids),
                CopyKind::Blocks,
            );
        }
        let Ok(range) = self.model.doc.resolve_selection(self.model.selection()) else {
            return (String::new(), CopyKind::External);
        };
        // Several blocks: Markdown for the whole selection (D18).
        if range.start.block != range.end.block
            && let Some(markdown) = super::slice::selection_markdown(&self.model.doc, range)
        {
            return (markdown, CopyKind::Blocks);
        }
        let mut inline_only = true;
        let text = self
            .model
            .text_ranges(range)
            .into_iter()
            .filter_map(|(id, lo, hi)| {
                // Marks and inline atoms copy as Markdown (an image as
                // `![alt](url)`, never the U+FFFC placeholder, #3113). A
                // partial selection serializes as its own inline, so
                // delimiters are always balanced at the cut edges.
                if let Some(inline) = self.model.doc.inline(id) {
                    return Some(super::serialize::inline_markdown(&inline.slice(lo..hi)));
                }
                inline_only = false;
                let text = self.model.doc.leaf_text(id)?;
                text.get(lo..hi).map(str::to_string)
            })
            .collect::<Vec<_>>()
            .join("\n");
        (
            text,
            if inline_only {
                CopyKind::Inline
            } else {
                CopyKind::External
            },
        )
    }

    // ---- action handlers --------------------------------------------------

    pub(crate) fn on_backspace(&mut self, _: &Backspace, _: &mut Window, cx: &mut Context<Self>) {
        self.end_composition();
        self.edit(EditOrigin::Backspace, |m| m.delete(false), cx);
    }
    pub(crate) fn on_delete(&mut self, _: &Delete, _: &mut Window, cx: &mut Context<Self>) {
        self.end_composition();
        self.edit(EditOrigin::DeleteForward, |m| m.delete(true), cx);
    }
    pub(crate) fn on_enter(&mut self, _: &Enter, _: &mut Window, cx: &mut Context<Self>) {
        if self.readonly || self.is_composing() {
            return;
        }
        if self.submit_policy == SubmitPolicy::Enter {
            cx.emit(BlockEditorEvent::SubmitRequested);
            return;
        }
        self.newline(cx);
    }
    pub(crate) fn on_structural_enter(
        &mut self,
        _: &StructuralEnter,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.readonly || self.is_composing() {
            return;
        }
        self.newline(cx);
    }
    fn newline(&mut self, cx: &mut Context<Self>) {
        self.end_composition();
        // "```lang" then Enter: a code block.
        if !self.readonly
            && self.rule_on(RuleKind::CodeFence)
            && let Some(caret) = self.model.caret()
            && self.model.doc.kind(caret.block) == Some(&super::kind::BlockKindData::Paragraph)
            && caret.offset == self.model.doc.leaf_len(caret.block).unwrap_or(0)
            && let Some(lang) = self
                .model
                .doc
                .inline(caret.block)
                .and_then(|i| code_fence(i.text()))
        {
            self.fence_to_code_block(caret.block, lang, cx);
            return;
        }
        // Enter in a table cell (D13).
        if !self.readonly && self.model.current_cell().is_some() {
            self.model.break_coalescing();
            self.edit(
                EditOrigin::Command("table_enter"),
                |m| m.table_enter().map(|_| ()),
                cx,
            );
            self.model.break_coalescing();
            return;
        }
        // "| a | b |" then Enter at the end of a paragraph: a table.
        if !self.readonly
            && self.rule_on(RuleKind::Table)
            && let Some(caret) = self.model.caret()
            && caret.offset == self.model.doc.leaf_len(caret.block).unwrap_or(0)
            && self
                .model
                .doc
                .inline(caret.block)
                .is_some_and(|i| super::table::table_row_cells(i.text()).is_some())
        {
            let block = caret.block;
            self.model.break_coalescing();
            self.edit(
                EditOrigin::InputRule("table"),
                |m| m.paragraph_to_table(block).map(|_| ()),
                cx,
            );
            self.model.break_coalescing();
            return;
        }
        // "---" then Enter in an otherwise empty paragraph: a rule.
        if !self.readonly
            && self.rule_on(RuleKind::HorizontalRule)
            && let Some(caret) = self.model.caret()
            && self.model.doc.kind(caret.block) == Some(&super::kind::BlockKindData::Paragraph)
            && self.model.doc.inline(caret.block).map(|i| i.text()) == Some("---")
        {
            let block = caret.block;
            self.model.break_coalescing();
            self.model.history.begin_transaction();
            let _ = self.model.set_selection(BlockSelection::Text {
                anchor: BlockPosition::new(block, 0),
                head: BlockPosition::new(block, 3),
            });
            let _ = self.model.delete(false);
            let _ = self.model.paragraph_to_rule();
            self.model.history.commit_transaction();
            self.model.break_coalescing();
            self.after_edit(EditOrigin::InputRule("horizontal_rule"), cx);
            return;
        }
        self.edit(EditOrigin::Command("split_block"), |m| m.split_block(), cx);
    }
    /// Shift+Enter (Ctrl+Enter in composer mode): a cell soft break;
    /// structural Enter elsewhere, without submission.
    pub(crate) fn on_soft_break(&mut self, _: &SoftBreak, _: &mut Window, cx: &mut Context<Self>) {
        if self.readonly || self.is_composing() {
            return;
        }
        self.end_composition();
        if self.model.current_cell().is_some() {
            self.model.break_coalescing();
            self.edit(
                EditOrigin::Command("cell_soft_break"),
                |m| m.cell_soft_break().map(|_| ()),
                cx,
            );
            self.model.break_coalescing();
        } else {
            self.newline(cx);
        }
    }

    /// Cmd/Ctrl+Enter: leave a table to the block after it.
    pub(crate) fn on_exit_block(&mut self, _: &ExitBlock, _: &mut Window, cx: &mut Context<Self>) {
        if self.readonly || self.is_composing() {
            return;
        }
        if matches!(
            self.submit_policy,
            SubmitPolicy::Enter | SubmitPolicy::ModifiedEnter
        ) {
            cx.emit(BlockEditorEvent::SubmitRequested);
            return;
        }
        self.end_composition();
        if self.readonly || self.model.current_cell().is_none() {
            cx.propagate();
            return;
        }
        self.model.break_coalescing();
        self.edit(
            EditOrigin::Command("table_exit"),
            |m| m.exit_table().map(|_| ()),
            cx,
        );
        self.model.break_coalescing();
    }

    pub(crate) fn on_move_left(&mut self, _: &MoveLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.horizontal(false, false, cx);
    }
    pub(crate) fn on_move_right(&mut self, _: &MoveRight, _: &mut Window, cx: &mut Context<Self>) {
        self.horizontal(true, false, cx);
    }
    pub(crate) fn on_move_up(&mut self, _: &MoveUp, _: &mut Window, cx: &mut Context<Self>) {
        self.vertical(false, false, cx);
    }
    pub(crate) fn on_move_down(&mut self, _: &MoveDown, _: &mut Window, cx: &mut Context<Self>) {
        self.vertical(true, false, cx);
    }
    pub(crate) fn on_move_home(&mut self, _: &MoveHome, _: &mut Window, cx: &mut Context<Self>) {
        self.line_edge(false, false, cx);
    }
    pub(crate) fn on_move_end(&mut self, _: &MoveEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.line_edge(true, false, cx);
    }
    pub(crate) fn on_select_left(
        &mut self,
        _: &SelectLeft,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.horizontal(false, true, cx);
    }
    pub(crate) fn on_select_right(
        &mut self,
        _: &SelectRight,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.horizontal(true, true, cx);
    }
    pub(crate) fn on_select_up(&mut self, _: &SelectUp, _: &mut Window, cx: &mut Context<Self>) {
        self.vertical(false, true, cx);
    }
    pub(crate) fn on_select_down(
        &mut self,
        _: &SelectDown,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.vertical(true, true, cx);
    }
    pub(crate) fn on_select_home(
        &mut self,
        _: &SelectHome,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.line_edge(false, true, cx);
    }
    pub(crate) fn on_select_end(&mut self, _: &SelectEnd, _: &mut Window, cx: &mut Context<Self>) {
        self.line_edge(true, true, cx);
    }
    pub(crate) fn on_move_doc_start(
        &mut self,
        _: &MoveDocStart,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.goal_x = None;
        self.move_to(self.model.doc.first_caret(), false, cx);
    }
    pub(crate) fn on_move_doc_end(
        &mut self,
        _: &MoveDocEnd,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.goal_x = None;
        self.move_to(self.model.doc.last_caret(), false, cx);
    }
}
