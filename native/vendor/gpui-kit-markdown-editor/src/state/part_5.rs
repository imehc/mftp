// Upstream state.rs; split at impl method boundaries without changing behavior.
impl BlockEditorState {

    /// Inline-mark input rules: a closing `` ` ``, `*`, `**` or `~~` typed
    /// after an opening one in the same leaf turns the text between into
    /// code, italic, bold or strikethrough and drops the delimiters. One undo
    /// group of its own: undo restores the literal delimiters.
    fn apply_mark_rule(&mut self, cx: &mut Context<Self>) {
        let Some(caret) = self.model.caret() else {
            return;
        };
        let Some(inline) = self.model.doc.inline(caret.block) else {
            return;
        };
        let Some((open, close, kind, typed_opening)) = mark_rule(inline, caret.offset) else {
            return;
        };
        let block = caret.block;
        let d = close.len();
        let pos = |offset| BlockPosition::new(block, offset);
        self.model.break_coalescing();
        self.model.history.begin_transaction();
        let _ = self.model.set_selection(BlockSelection::Text {
            anchor: pos(close.start),
            head: pos(close.end),
        });
        let _ = self.model.delete(false);
        let _ = self.model.set_selection(BlockSelection::Text {
            anchor: pos(open.start),
            head: pos(open.end),
        });
        let _ = self.model.delete(false);
        let end = close.start - d;
        let _ = self.model.set_selection(BlockSelection::Text {
            anchor: pos(open.start),
            head: pos(end),
        });
        let _ = self.model.run(EditorCommand::ApplyMark(
            super::marks::MarkChange::new().set(kind),
        ));
        // The caret stays where the user typed: after the span when the
        // closing delimiter came last, before it when the opening one did.
        let caret_at = if typed_opening { open.start } else { end };
        let _ = self
            .model
            .set_selection(BlockSelection::caret(pos(caret_at)));
        // Text typed next is outside the new span.
        let after = super::marks::MarkChange::new()
            .clear(kind)
            .apply(&self.model.active_marks().0);
        self.model.history.commit_transaction();
        self.model.break_coalescing();
        self.model.stored_marks = Some(after);
        self.after_edit(EditOrigin::InputRule("inline_mark"), cx);
    }

    /// Replace a typed code fence with an empty code block, caret inside,
    /// as its own undo group (one undo restores the typed fence).
    fn fence_to_code_block(&mut self, block: BlockId, lang: String, cx: &mut Context<Self>) {
        let len = self.model.doc.leaf_len(block).unwrap_or(0);
        self.model.break_coalescing();
        self.model.history.begin_transaction();
        let _ = self.model.set_selection(BlockSelection::Text {
            anchor: BlockPosition::new(block, 0),
            head: BlockPosition::new(block, len),
        });
        let _ = self.model.delete(false);
        let (lang, meta) = lang
            .split_once(char::is_whitespace)
            .map_or((lang.as_str(), None), |(lang, meta)| {
                (lang, Some(meta.trim_start().to_owned()))
            });
        let _ = self.model.set_code_block_info(Some(lang.to_owned()), meta);
        self.model.history.commit_transaction();
        self.model.break_coalescing();
        self.after_edit(EditOrigin::InputRule("code_block"), cx);
    }

    // ---- IME ---------------------------------------------------------------

    /// The IME sees the caret leaf as its document.
    fn ime_block(&self) -> Option<BlockId> {
        if let Some(m) = &self.marked {
            return Some(m.block);
        }
        let (_, head) = self.head_anchor()?;
        Some(head.block)
    }

    fn ime_text(&self) -> &str {
        self.ime_block()
            .and_then(|id| self.model.doc.leaf_text(id))
            .unwrap_or("")
    }

    fn select_utf16(&mut self, block: BlockId, range16: Range<usize>) {
        let text = self.ime_text();
        let range = utf16_to_byte(text, range16.start)..utf16_to_byte(text, range16.end);
        let _ = self.model.set_selection(BlockSelection::Text {
            anchor: BlockPosition::new(block, range.start),
            head: BlockPosition::new(block, range.end),
        });
    }

    fn select_marked_or(&mut self, range16: Option<Range<usize>>) {
        let Some(block) = self.ime_block() else {
            return;
        };
        if let Some(range16) = range16 {
            self.select_utf16(block, range16);
        } else if let Some(m) = self.marked.clone() {
            let _ = self.model.set_selection(BlockSelection::Text {
                anchor: BlockPosition::new(m.block, m.range.start),
                head: BlockPosition::new(m.block, m.range.end),
            });
        }
    }

}
