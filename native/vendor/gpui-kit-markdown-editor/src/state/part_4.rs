// Upstream state.rs; split at impl method boundaries without changing behavior.
impl BlockEditorState {
    pub(crate) fn on_select_doc_start(
        &mut self,
        _: &SelectDocStart,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.goal_x = None;
        self.move_to(self.model.doc.first_caret(), true, cx);
    }
    pub(crate) fn on_select_doc_end(
        &mut self,
        _: &SelectDocEnd,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.goal_x = None;
        self.move_to(self.model.doc.last_caret(), true, cx);
    }
    pub(crate) fn on_select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.end_composition();
        let _ = self.model.run(EditorCommand::SelectAll);
        self.selection_changed(cx);
    }
    pub(crate) fn on_undo(&mut self, _: &Undo, _: &mut Window, cx: &mut Context<Self>) {
        self.end_composition();
        self.undo(cx);
    }
    pub(crate) fn on_redo(&mut self, _: &Redo, _: &mut Window, cx: &mut Context<Self>) {
        self.end_composition();
        self.redo(cx);
    }
    pub(crate) fn on_normal_text(
        &mut self,
        _: &NormalText,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.readonly {
            return;
        }
        self.end_composition();
        self.model.break_coalescing();
        let _ = self.run(EditorCommand::SetBlockKind(BlockKind::Paragraph), cx);
        self.model.break_coalescing();
    }
    pub(crate) fn on_close_table_menu(
        &mut self,
        _: &CloseTableMenu,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.close_table_menu(cx);
    }
    fn table_key(&mut self, edit: Option<crate::TableEdit>, cx: &mut Context<Self>) {
        if self.readonly || self.model.current_cell().is_none() {
            cx.propagate();
            return;
        }
        self.end_composition();
        self.close_table_menu(cx);
        if let Some(edit) = edit {
            self.model.break_coalescing();
            let _ = self.run(EditorCommand::EditTable(edit), cx);
            self.model.break_coalescing();
        }
    }
    pub(crate) fn on_table_insert_column_left(
        &mut self,
        _: &TableInsertColumnLeft,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.table_key(Some(crate::TableEdit::AddColumnLeft), cx);
    }
    pub(crate) fn on_table_insert_column_right(
        &mut self,
        _: &TableInsertColumnRight,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.table_key(Some(crate::TableEdit::AddColumnRight), cx);
    }
    pub(crate) fn on_table_insert_row_above(
        &mut self,
        _: &TableInsertRowAbove,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.table_key(Some(crate::TableEdit::AddRowAbove), cx);
    }
    pub(crate) fn on_table_insert_row_below(
        &mut self,
        _: &TableInsertRowBelow,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.table_key(Some(crate::TableEdit::AddRowBelow), cx);
    }
    /// Cmd/Ctrl+Alt+Backspace: whole column(s) selected → delete them;
    /// otherwise delete the row(s) of the caret / cell selection, unless
    /// that includes the header row (then nothing happens).
    pub(crate) fn on_table_delete_line(
        &mut self,
        _: &TableDeleteLine,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let edit = self.table_delete_edit();
        self.table_key(edit, cx);
    }
    /// What Cmd/Ctrl+Alt+Backspace does here (`None`: nothing).
    pub fn table_delete_edit(&self) -> Option<crate::TableEdit> {
        if self.model.whole_columns_selected() {
            return Some(crate::TableEdit::RemoveColumn);
        }
        let (_, rows, _) = self.model.table_span()?;
        (*rows.start() > 0).then_some(crate::TableEdit::RemoveRow)
    }
    pub(crate) fn on_toggle_bold(
        &mut self,
        _: &ToggleBold,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.toggle_mark(MarkKind::Bold, cx);
    }
    pub(crate) fn on_toggle_italic(
        &mut self,
        _: &ToggleItalic,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.toggle_mark(MarkKind::Italic, cx);
    }
    pub(crate) fn on_toggle_code(
        &mut self,
        _: &ToggleCode,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.toggle_mark(MarkKind::Code, cx);
    }
    pub(crate) fn on_indent(&mut self, _: &Indent, _: &mut Window, cx: &mut Context<Self>) {
        let _ = self.run(EditorCommand::Indent, cx);
    }
    pub(crate) fn on_outdent(&mut self, _: &Outdent, _: &mut Window, cx: &mut Context<Self>) {
        let _ = self.run(EditorCommand::Outdent, cx);
    }
    pub(crate) fn on_copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        let (text, kind) = self.selected_text();
        if text.is_empty() {
            return;
        }
        cx.write_to_clipboard(match kind.tag() {
            Some(tag) => ClipboardItem::new_string_with_metadata(text, tag.to_string()),
            None => ClipboardItem::new_string(text),
        });
    }
    pub(crate) fn on_cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        self.end_composition();
        self.on_copy(&Copy, window, cx);
        self.edit(
            EditOrigin::Cut,
            |m| m.run(EditorCommand::DeleteSelection).map(|_| ()),
            cx,
        );
    }
    pub(crate) fn on_paste(&mut self, _: &Paste, _: &mut Window, cx: &mut Context<Self>) {
        if self.readonly {
            return;
        }
        if let Some(item) = cx.read_from_clipboard() {
            self.paste(item, false, cx);
        }
    }
    pub(crate) fn on_native_paste(
        &mut self,
        _: &gpui_kit::base::input::Paste,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.on_paste(&Paste, window, cx);
    }
    pub(crate) fn on_paste_plain(
        &mut self,
        _: &PastePlain,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.readonly {
            return;
        }
        if let Some(item) = cx.read_from_clipboard() {
            self.paste(item, true, cx);
        }
    }

    /// Deliver semantic clipboard content. `plain` bypasses Markdown import.
    /// With Host policy this emits one request; there is no fallback insertion
    /// until the owner resolves it, so mixed image/text entries cannot double
    /// insert. This method itself never reads the system clipboard.
    pub fn paste(&mut self, item: ClipboardItem, plain: bool, cx: &mut Context<Self>) {
        if self.readonly {
            return;
        }
        self.end_composition();
        if self.clipboard_policy == ClipboardPolicy::Host {
            self.paste_sequence += 1;
            self.pending_paste = Some(self.paste_sequence);
            let request = PasteRequest {
                range: self.model.capture(self.model.selection.clone()),
                plain,
                copy: CopyKind::of(&item),
                sequence: self.paste_sequence,
            };
            cx.emit(BlockEditorEvent::PasteRequested { request, item });
        } else if let Some(text) = item.text() {
            self.paste_text(&text, plain, CopyKind::of(&item), cx);
        }
    }

    /// Resolve an intercepted paste with text not consumed by the host's other
    /// admissions (e.g. image attachments). `None` means wholly handled or
    /// rejected. Returns false when navigation/edits made the request stale.
    pub fn is_paste_current(&self, request: &PasteRequest) -> bool {
        !self.readonly
            && self.pending_paste == Some(request.sequence)
            && self.model.is_capture_current(&request.range)
    }
    pub fn apply_paste(
        &mut self,
        request: &PasteRequest,
        text: Option<&str>,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.is_paste_current(request) {
            return false;
        }
        self.pending_paste = None;
        if let Some(text) = text {
            self.paste_text(text, request.plain, request.copy, cx);
        }
        true
    }
    fn paste_text(&mut self, text: &str, plain: bool, copy: CopyKind, cx: &mut Context<Self>) {
        self.edit(
            EditOrigin::Paste,
            |model| {
                if !plain && copy == CopyKind::Blocks && model.paste_blocks_markdown(text)? {
                    return Ok(());
                }
                if !plain && copy != CopyKind::External && model.paste_inline_markdown(text)? {
                    return Ok(());
                }
                if !plain && model.paste_blocks(text)? {
                    return Ok(());
                }
                model.insert_text(text, EditOrigin::Paste)
            },
            cx,
        );
    }

    /// Markdown input rules (design §5.3): `# `..`###### `, `- `/`* `/`+ `
    /// and `1. ` at the start of a plain paragraph. The conversion is its own
    /// undo group after the typing, so one undo reverts it and keeps the
    /// typed text.
    fn apply_input_rule(&mut self, cx: &mut Context<Self>) {
        use super::kind::BlockKindData;
        let Some(caret) = self.model.caret() else {
            return;
        };
        let doc = &self.model.doc;
        if doc.kind(caret.block) != Some(&BlockKindData::Paragraph) {
            return;
        }
        // "```lang " typed into an otherwise empty paragraph.
        if self.rule_on(RuleKind::CodeFence)
            && let Some(lang) = doc
                .inline(caret.block)
                .and_then(|i| code_fence(i.text().strip_suffix(' ')?))
                .filter(|_| caret.offset == doc.leaf_len(caret.block).unwrap_or(0))
        {
            self.fence_to_code_block(caret.block, lang, cx);
            return;
        }
        let in_list = doc
            .parent(caret.block)
            .and_then(|parent| doc.kind(parent))
            .is_some_and(|kind| matches!(kind, BlockKindData::ListItem { .. }));
        let Some(text) = doc.inline(caret.block).map(|i| i.text().to_string()) else {
            return;
        };
        let prefix = &text[..caret.offset.min(text.len())];
        let Some(marker) = prefix.strip_suffix(' ') else {
            return;
        };
        let task = match marker {
            "[ ]" => Some(false),
            "[x]" | "[X]" => Some(true),
            _ => None,
        };
        let (commands, rule) = if self.rule_on(RuleKind::Heading)
            && !marker.is_empty()
            && marker.len() <= 6
            && marker.bytes().all(|b| b == b'#')
        {
            let level = marker.len() as u8;
            (
                vec![EditorCommand::SetBlockKind(BlockKind::Heading { level })],
                "heading",
            )
        } else if self.rule_on(RuleKind::BulletList)
            && !in_list
            && matches!(marker, "-" | "*" | "+")
        {
            (
                vec![EditorCommand::ToggleList { ordered: false }],
                "bullet_list",
            )
        } else if self.rule_on(RuleKind::OrderedList)
            && !in_list
            && marker.len() >= 2
            && marker.ends_with('.')
            && marker[..marker.len() - 1]
                .bytes()
                .all(|b| b.is_ascii_digit())
        {
            (
                vec![EditorCommand::ToggleList { ordered: true }],
                "ordered_list",
            )
        } else if self.rule_on(RuleKind::TaskItem)
            && let Some(checked) = task
        {
            let mut commands = Vec::new();
            if !in_list {
                commands.push(EditorCommand::ToggleList { ordered: false });
            }
            commands.push(EditorCommand::SetTaskChecked(checked));
            (commands, "task_item")
        } else if self.rule_on(RuleKind::Blockquote) && marker == ">" {
            (Vec::new(), "blockquote")
        } else {
            return;
        };
        let block = caret.block;
        let len = prefix.len();
        self.model.break_coalescing();
        self.model.history.begin_transaction();
        let _ = self.model.set_selection(BlockSelection::Text {
            anchor: BlockPosition::new(block, 0),
            head: BlockPosition::new(block, len),
        });
        let _ = self.model.delete(false);
        if commands.is_empty() {
            let _ = self.model.wrap_in_blockquote();
        }
        for command in commands {
            let _ = self.model.run(command);
        }
        self.model.history.commit_transaction();
        self.model.break_coalescing();
        self.after_edit(EditOrigin::InputRule(rule), cx);
    }

    /// Link input rule: `[text](url)` typed, on the closing `)`, becomes
    /// `text` with a link mark. One undo group: undo restores the source.
    fn apply_link_rule(&mut self, cx: &mut Context<Self>) {
        let Some(caret) = self.model.caret() else {
            return;
        };
        let Some(inline) = self.model.doc.inline(caret.block) else {
            return;
        };
        let Some((start, text, url)) = link_rule(inline.text(), caret.offset) else {
            return;
        };
        let block = caret.block;
        let pos = |offset| BlockPosition::new(block, offset);
        let text_end = start + 1 + text.len();
        self.model.break_coalescing();
        self.model.history.begin_transaction();
        // Drop "](url)" then "[".
        let _ = self.model.set_selection(BlockSelection::Text {
            anchor: pos(text_end),
            head: pos(caret.offset),
        });
        let _ = self.model.delete(false);
        let _ = self.model.set_selection(BlockSelection::Text {
            anchor: pos(start),
            head: pos(start + 1),
        });
        let _ = self.model.delete(false);
        let end = start + text.len();
        let _ = self.model.set_selection(BlockSelection::Text {
            anchor: pos(start),
            head: pos(end),
        });
        let _ = self.model.run(EditorCommand::ApplyMark(
            super::marks::MarkChange::new().with_link(url, None),
        ));
        let _ = self.model.set_selection(BlockSelection::caret(pos(end)));
        let after = super::marks::MarkChange::new()
            .clear(super::marks::MarkKind::Link)
            .apply(&self.model.active_marks().0);
        self.model.history.commit_transaction();
        self.model.break_coalescing();
        self.model.stored_marks = Some(after);
        self.after_edit(EditOrigin::InputRule("link"), cx);
    }
}
