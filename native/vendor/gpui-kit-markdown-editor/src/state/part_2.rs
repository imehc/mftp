// Upstream state.rs; split at impl method boundaries without changing behavior.
impl BlockEditorState {

    /// Where a D21 word delete stops: the word motion's boundary, but never
    /// past an inline atom (an adjacent atom is deleted on its own), and
    /// never outside `head`'s leaf.
    fn delete_word_target(&self, head: BlockPosition, forward: bool) -> BlockPosition {
        use super::inline::ATOM_CHAR;
        let Some(text) = self.model.doc.leaf_text(head.block) else {
            return head;
        };
        let adjacent = if forward {
            text[head.offset..].chars().next()
        } else {
            text[..head.offset].chars().next_back()
        };
        let atom = ATOM_CHAR.len_utf8();
        match adjacent {
            None => return head,
            Some(ATOM_CHAR) if forward => {
                return BlockPosition::new(head.block, head.offset + atom);
            }
            Some(ATOM_CHAR) => return BlockPosition::new(head.block, head.offset - atom),
            Some(_) => {}
        }
        let step = self.step_word(head, forward);
        if step.block != head.block {
            return head;
        }
        let offset = if forward {
            text[head.offset..step.offset]
                .find(ATOM_CHAR)
                .map_or(step.offset, |i| head.offset + i)
        } else {
            text[step.offset..head.offset]
                .rfind(ATOM_CHAR)
                .map_or(step.offset, |i| step.offset + i + atom)
        };
        self.model.doc.clamp(BlockPosition::new(head.block, offset))
    }

    /// D21: delete a word or to the line edge. A range (or block / cell
    /// selection) deletes just the selection; at the leaf's edge it is a
    /// plain Backspace / Delete, except in a table cell, where it does
    /// nothing.
    fn delete_by(&mut self, line: bool, forward: bool, cx: &mut Context<Self>) {
        self.end_composition();
        if self.readonly {
            return;
        }
        let origin = if forward {
            EditOrigin::DeleteForward
        } else {
            EditOrigin::Backspace
        };
        let head = match self.model.selection() {
            BlockSelection::Text { anchor, head } if anchor == head => *head,
            _ => return self.edit(origin, |m| m.delete(forward), cx),
        };
        let target = if line {
            self.delete_line_target(head, forward)
        } else {
            self.delete_word_target(head, forward)
        };
        if line {
            self.model.break_coalescing();
        }
        if target == head {
            if super::table::table_of(&self.model.doc, head.block).is_none() {
                self.edit(origin, |m| m.delete(forward), cx);
            }
        } else {
            let origin = if forward {
                EditOrigin::WordDelete
            } else {
                EditOrigin::WordBackspace
            };
            self.edit(origin, |m| m.delete_span(target, head, forward), cx);
        }
        if line {
            self.model.break_coalescing();
        }
    }

    /// D21 Option+Up/Down: the start / end of the block, or of the previous
    /// / next one when already there.
    fn paragraph_edge(&mut self, forward: bool, extend: bool, cx: &mut Context<Self>) {
        if self.collapse_blocks(forward, cx) {
            return;
        }
        let Some((_, head)) = self.head_anchor() else {
            return;
        };
        let doc = &self.model.doc;
        let len = doc.leaf_len(head.block).unwrap_or(0);
        let mut pos = head;
        if (forward && pos.offset >= len) || (!forward && pos.offset == 0) {
            pos = self.step_horizontal(pos, forward);
        }
        let offset = if forward {
            doc.leaf_len(pos.block).unwrap_or(0)
        } else {
            0
        };
        let target = doc.clamp(BlockPosition::new(pos.block, offset));
        self.goal_x = None;
        self.move_to(target, extend, cx);
    }

    pub(crate) fn on_delete_word_left(
        &mut self,
        _: &DeleteWordLeft,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.delete_by(false, false, cx);
    }
    pub(crate) fn on_delete_word_right(
        &mut self,
        _: &DeleteWordRight,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.delete_by(false, true, cx);
    }
    pub(crate) fn on_delete_to_line_start(
        &mut self,
        _: &DeleteToLineStart,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.delete_by(true, false, cx);
    }
    pub(crate) fn on_delete_to_line_end(
        &mut self,
        _: &DeleteToLineEnd,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.delete_by(true, true, cx);
    }
    pub(crate) fn on_move_paragraph_start(
        &mut self,
        _: &MoveParagraphStart,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.paragraph_edge(false, false, cx);
    }
    pub(crate) fn on_move_paragraph_end(
        &mut self,
        _: &MoveParagraphEnd,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.paragraph_edge(true, false, cx);
    }
    pub(crate) fn on_select_paragraph_start(
        &mut self,
        _: &SelectParagraphStart,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.paragraph_edge(false, true, cx);
    }
    pub(crate) fn on_select_paragraph_end(
        &mut self,
        _: &SelectParagraphEnd,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.paragraph_edge(true, true, cx);
    }

    /// The link drawn under the window point `at`: its leaf, byte range
    /// and url.
    pub fn link_at(&self, at: Point<Pixels>) -> Option<(BlockId, Range<usize>, SharedString)> {
        let pos = {
            let frame = self.frame.borrow();
            let pos = frame.hit_test(at)?;
            if !frame.leaf(pos.block)?.bounds().contains(&at) {
                return None;
            }
            pos
        };
        let inline = self.model.doc.inline(pos.block)?;
        let url = inline.mark_after(pos.offset)?.link.as_ref()?.url.clone();
        let range = link_extent(inline, pos.offset, &url)?;
        Some((pos.block, range, url))
    }

    /// The url of the link under the mouse, if any (D14 hover).
    pub fn hovered_link(&self) -> Option<&SharedString> {
        self.hovered_link.as_ref()
    }

    pub(crate) fn hover_at(&mut self, at: Point<Pixels>, secondary: bool, cx: &mut Context<Self>) {
        self.hover_table(at, cx);
        let url = self.link_at(at).map(|(_, _, url)| url);
        let hand = self.task_checkbox_at(at).is_some() || (secondary && url.is_some());
        if hand != self.pointer_hand {
            self.pointer_hand = hand;
            cx.notify();
        }
        if url != self.hovered_link {
            self.hovered_link = url.clone();
            cx.emit(BlockEditorEvent::LinkHovered { url });
            cx.notify();
        }
    }

    /// Cmd/Ctrl+click: emit [`BlockEditorEvent::LinkClicked`] for the link
    /// under `at`. Returns whether there was one.
    pub(crate) fn follow_link_at(&mut self, at: Point<Pixels>, cx: &mut Context<Self>) -> bool {
        match self.link_at(at) {
            Some((_, _, url)) => {
                cx.emit(BlockEditorEvent::LinkClicked { url });
                true
            }
            None => false,
        }
    }

    /// The url of the link at the caret (or the selection start).
    pub fn link_at_caret(&self) -> Option<SharedString> {
        self.link_range_at_caret().map(|(_, _, url)| url)
    }

    fn link_range_at_caret(&self) -> Option<(BlockId, Range<usize>, SharedString)> {
        let head = match &self.model.selection {
            BlockSelection::Text { anchor, head } => {
                if anchor.block == head.block && anchor.offset < head.offset {
                    *anchor
                } else {
                    *head
                }
            }
            _ => return None,
        };
        let inline = self.model.doc.inline(head.block)?;
        let mark = inline
            .mark_after(head.offset)
            .filter(|m| m.link.is_some())
            .or_else(|| inline.mark_before(head.offset))?;
        let url = mark.link.as_ref()?.url.clone();
        let probe = if inline
            .mark_after(head.offset)
            .is_some_and(|m| m.link.is_some())
        {
            head.offset
        } else {
            head.offset.checked_sub(1)?
        };
        let range = link_extent(inline, probe, &url)?;
        Some((head.block, range, url))
    }

    /// Cmd/Ctrl+K: ask the host for its link popover.
    pub fn request_link_edit(&mut self, cx: &mut Context<Self>) {
        if self.readonly {
            return;
        }
        let url = self.link_at_caret();
        cx.emit(BlockEditorEvent::EditLinkRequested { url });
    }

    pub(crate) fn on_edit_link(&mut self, _: &EditLink, _: &mut Window, cx: &mut Context<Self>) {
        self.request_link_edit(cx);
    }

    /// Add, change (`Some(url)`) or remove (`None`) the link on the
    /// selection, or on the whole link at a collapsed caret. One undo step.
    pub fn set_link(&mut self, url: Option<&str>, cx: &mut Context<Self>) {
        if self.readonly {
            return;
        }
        let collapsed = matches!(
            &self.model.selection,
            BlockSelection::Text { anchor, head } if anchor == head
        );
        if collapsed && let Some((block, range, _)) = self.link_range_at_caret() {
            let _ = self.model.set_selection(BlockSelection::Text {
                anchor: BlockPosition::new(block, range.start),
                head: BlockPosition::new(block, range.end),
            });
        } else if collapsed {
            let Some(url) = url.map(str::trim).filter(|url| !url.is_empty()) else {
                return;
            };
            // A new link at a caret needs visible text, in the same undo step.
            self.model.break_coalescing();
            self.edit(EditOrigin::Api, |model| {
                let range = model.doc.resolve_selection(&model.selection)?;
                let mark = super::marks::MarkChange::new()
                    .with_link(url.to_owned(), None)
                    .apply(&model.inherited_marks(range.start));
                model.transact(EditOrigin::Api, |tx| {
                    let pos = range.start;
                    if tx.doc.inline(pos.block).is_none() {
                        return Err(CommandError::NotEditable(pos.block));
                    }
                    tx.replace_text(pos.block, pos.offset..pos.offset,
                        super::inline::InlineText::plain(url, mark))?;
                    Ok(Some(BlockSelection::caret(BlockPosition::new(pos.block, pos.offset + url.len()))))
                })?;
                Ok(())
            }, cx);
            self.model.break_coalescing();
            return;
        }
        let change = match url.map(str::trim).filter(|u| !u.is_empty()) {
            Some(url) => super::marks::MarkChange::new().with_link(url.to_string(), None),
            None => super::marks::MarkChange::new().clear(MarkKind::Link),
        };
        self.model.break_coalescing();
        let _ = self.run(EditorCommand::ApplyMark(change), cx);
        self.model.break_coalescing();
    }

    /// The task checkbox drawn left of a task item's first line under
    /// `at`: the item's text leaf and whether it is checked.
    /// Mouse-down on a task checkbox: toggle it, leaving the caret and
    /// selection alone. Returns whether it was one.
    pub(crate) fn click_checkbox(&mut self, at: Point<Pixels>, cx: &mut Context<Self>) -> bool {
        match self.task_checkbox_at(at) {
            Some((leaf, checked)) if !self.readonly => {
                self.end_composition();
                self.dragging = false;
                self.set_task_checked(leaf, !checked, cx);
                true
            }
            _ => false,
        }
    }

    pub(crate) fn task_checkbox_at(&self, at: Point<Pixels>) -> Option<(BlockId, bool)> {
        use super::kind::BlockKindData;
        use gpui::px;
        let frame = self.frame.borrow();
        frame.leaves.iter().find_map(|leaf| {
            let b = leaf.bounds();
            let line = px(28.).min(b.size.height);
            if !(at.y >= b.top()
                && at.y < b.top() + line
                && at.x < b.left()
                && at.x >= b.left() - px(28.))
            {
                return None;
            }
            let block = leaf.info.block;
            let (item, index) = self.model.doc.index_in_parent(block)?;
            match self.model.doc.kind(item) {
                Some(BlockKindData::ListItem {
                    checked: Some(c), ..
                }) if index == 0 => Some((block, *c)),
                _ => None,
            }
        })
    }

    /// Mouse: place or extend the caret at a window point.
    pub(crate) fn mouse_at(&mut self, at: Point<Pixels>, extend: bool, cx: &mut Context<Self>) {
        // Block handle: a click in the left edge beside a table or code
        // block (left of its text) selects the block as a node.
        if !extend && let Some(block) = self.block_handle_at(at) {
            self.goal_x = None;
            self.end_composition();
            let _ = self.model.set_selection(BlockSelection::Blocks {
                anchor: block,
                head: block,
            });
            self.dragging = false;
            self.selection_changed(cx);
            return;
        }
        let hit = self.frame.borrow().hit_test(at);
        // A click on an inline atom selects the whole atom (#3113).
        if !extend && let Some(pos) = hit.and_then(|pos| self.atom_under(pos, at)) {
            self.goal_x = None;
            self.end_composition();
            let _ = self.model.set_selection(BlockSelection::Text {
                anchor: pos,
                head: BlockPosition::new(
                    pos.block,
                    pos.offset + super::inline::ATOM_CHAR.len_utf8(),
                ),
            });
            self.selection_changed(cx);
            return;
        }
        if let Some(pos) = hit {
            self.goal_x = None;
            let pos = self.model.doc.clamp(pos);
            self.move_to(pos, extend, cx);
        }
    }

    /// Double-click: the word at the caret; triple-click: the whole block.
    pub(crate) fn select_unit(&mut self, block: bool, cx: &mut Context<Self>) {
        let Some(caret) = self.model.caret() else {
            return;
        };
        let Some(text) = self.model.doc.leaf_text(caret.block) else {
            return;
        };
        let range = if block {
            0..text.len()
        } else {
            match crate::support::word_range_at(text, caret.offset) {
                Some(r) => r,
                None => return,
            }
        };
        let _ = self.model.set_selection(BlockSelection::Text {
            anchor: BlockPosition::new(caret.block, range.start),
            head: BlockPosition::new(caret.block, range.end),
        });
        self.dragging = false;
        self.selection_changed(cx);
    }

    /// Top-level blocks with laid-out geometry, in document order, with the
    /// union of their leaves' bounds (D22).
    pub(crate) fn top_level_bounds(&self) -> Vec<(usize, BlockId, Bounds<Pixels>)> {
        let doc = &self.model.doc;
        let frame = self.frame.borrow();
        let children = doc.children(doc.root);
        let mut out: Vec<(usize, BlockId, Bounds<Pixels>)> = Vec::new();
        for leaf in &frame.leaves {
            let path = doc.path(leaf.info.block);
            let Some(top) = path.get(1).copied() else {
                continue;
            };
            let Some(ix) = children.iter().position(|c| *c == top) else {
                continue;
            };
            let b = leaf.bounds();
            match out.iter_mut().find(|(_, id, _)| *id == top) {
                Some(entry) => entry.2 = entry.2.union(&b),
                None => out.push((ix, top, b)),
            }
        }
        out.sort_by_key(|(ix, _, _)| *ix);
        out
    }

    /// D22: the top-level table or code block whose edge handle
    /// (`block_handle_at`) is under `at`; only those can be dragged.
    pub(crate) fn drag_handle_at(&self, at: Point<Pixels>) -> Option<BlockId> {
        if self.readonly {
            return None;
        }
        let block = self.block_handle_at(at)?;
        let doc = &self.model.doc;
        // A code block's handle is its leaf; tables report the table.
        let top = doc.path(block).get(1).copied()?;
        (top == block).then_some(block)
    }
}
