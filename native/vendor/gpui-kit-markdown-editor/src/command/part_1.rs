// Upstream command.rs; split at impl method boundaries without changing behavior.
impl BlockEditorModel {

    /// A heading becomes a paragraph in one transaction; text, marks and
    /// the caret stay.
    fn heading_to_paragraph(
        &mut self,
        block: BlockId,
        name: &'static str,
    ) -> Result<(), CommandError> {
        self.transact(EditOrigin::Command(name), |tx| {
            tx.set_kind(block, BlockKindData::Paragraph)?;
            Ok(None)
        })
        .map(|_| ())
    }

    /// Enter in a code block inserts a newline; Enter on a trailing empty
    /// line (caret at the end, text ending in a newline) leaves the block:
    /// the newline goes and an empty paragraph follows.
    fn code_enter(&mut self, range: ResolvedSelection) -> Result<bool, CommandError> {
        self.transact(EditOrigin::Command("code_enter"), |tx| {
            let pos = if range.is_collapsed() {
                range.start
            } else {
                delete_range(tx, range)?
            };
            let Some(code) = tx.doc.plain(pos.block) else {
                return Err(CommandError::NotEditable(pos.block));
            };
            if pos.offset == code.len() && code.ends_with('\n') {
                tx.replace_plain(pos.block, pos.offset - 1..pos.offset, "")?;
                return Ok(caret(exit_below(tx, pos.block)?));
            }
            tx.replace_plain(pos.block, pos.offset..pos.offset, "\n")?;
            Ok(caret(BlockPosition::new(pos.block, pos.offset + 1)))
        })
    }

    /// Arrow down past the end of a code block that ends the document (or
    /// its container): add an empty paragraph after it and move there.
    pub(crate) fn exit_code_block(&mut self) -> Result<bool, CommandError> {
        let Some(pos) = self.caret() else {
            return Ok(false);
        };
        if self.doc.plain(pos.block).is_none() {
            return Ok(false);
        }
        self.transact(EditOrigin::Command("exit_code_block"), |tx| {
            Ok(caret(exit_below(tx, pos.block)?))
        })
    }

    /// Turn the caret's paragraph into a code block holding its text (or
    /// insert an empty code block when the caret is elsewhere).
    fn set_code_block(&mut self, lang: Option<String>) -> Result<bool, CommandError> {
        self.set_code_block_info(lang, None)
    }
    pub(crate) fn set_code_block_info(
        &mut self,
        lang: Option<String>,
        meta: Option<String>,
    ) -> Result<bool, CommandError> {
        let pos = self
            .caret()
            .ok_or(CommandError::Unsupported("block selection"))?;
        let lang = lang.filter(|l| !l.is_empty()).map(SharedString::from);
        let meta = meta.filter(|m| !m.is_empty()).map(SharedString::from);
        self.transact(EditOrigin::Command("code_block"), |tx| {
            let doc = &*tx.doc;
            let (parent, index) = doc
                .index_in_parent(pos.block)
                .ok_or(PositionError::UnknownBlock(pos.block))?;
            let (text, at) = match doc.kind(pos.block) {
                Some(BlockKindData::Paragraph | BlockKindData::Heading { .. }) => {
                    let text = doc
                        .inline(pos.block)
                        .map(|i| i.text().replace(super::inline::ATOM_CHAR, ""))
                        .unwrap_or_default();
                    tx.remove_block(pos.block)?;
                    (text, index)
                }
                Some(BlockKindData::CodeBlock { meta: old_meta, .. }) => {
                    let meta = meta.or_else(|| old_meta.clone());
                    tx.set_kind(pos.block, BlockKindData::CodeBlock { lang, meta })?;
                    return Ok(caret(pos));
                }
                _ => (String::new(), index + 1),
            };
            let offset = pos.offset.min(text.len());
            let code = DetachedBlock::leaf(
                BlockKindData::CodeBlock { lang, meta },
                BlockContent::Plain(text),
            );
            let id = code.id;
            tx.insert(parent, at, vec![code])?;
            Ok(caret(BlockPosition::new(id, offset)))
        })
    }

    /// Tab / Shift+Tab in a code block: indent or outdent the caret's line by
    /// four spaces.
    fn code_indent(&mut self, pos: BlockPosition, outdent: bool) -> Result<bool, CommandError> {
        let Some(code) = self.doc.plain(pos.block) else {
            return Ok(false);
        };
        let line_start = code[..pos.offset].rfind('\n').map_or(0, |i| i + 1);
        if !outdent {
            return self.transact(EditOrigin::Command("indent"), |tx| {
                tx.replace_plain(pos.block, pos.offset..pos.offset, "    ")?;
                Ok(caret(BlockPosition::new(pos.block, pos.offset + 4)))
            });
        }
        let spaces = code[line_start..]
            .bytes()
            .take(4)
            .take_while(|b| *b == b' ')
            .count();
        if spaces == 0 {
            return Ok(false);
        }
        self.transact(EditOrigin::Command("outdent"), |tx| {
            tx.replace_plain(pos.block, line_start..line_start + spaces, "")?;
            let offset = pos.offset.saturating_sub(spaces).max(line_start);
            Ok(caret(BlockPosition::new(pos.block, offset)))
        })
    }

    /// Enter in an empty list item whose only child is the caret's empty
    /// paragraph: a nested item outdents one level, a top-level item becomes
    /// a paragraph after the list (splitting it when mid-list). One
    /// transaction, so one undo step. Returns `false` when it does not apply.
    /// Enter on an empty paragraph that is a trailing child of a list item
    /// or any child of a blockquote (D16): lift it out, like an empty item.
    fn lift_empty_trailing(&mut self, pos: BlockPosition) -> Result<bool, CommandError> {
        if self.lift_item_trailing(pos, true)? {
            return Ok(true);
        }
        self.exit_quote(pos)
    }

    fn empty_paragraph_at(&self, pos: BlockPosition) -> bool {
        self.doc.kind(pos.block) == Some(&BlockKindData::Paragraph)
            && self.doc.inline(pos.block).is_some_and(|i| i.is_empty())
    }

    /// An (empty, when `empty`) paragraph that is the last, not the first,
    /// child of a list item becomes an empty item of its own after that
    /// item. From there Enter / Shift+Tab outdent and leave the list as
    /// for any empty item.
    fn lift_item_trailing(
        &mut self,
        pos: BlockPosition,
        empty: bool,
    ) -> Result<bool, CommandError> {
        let doc = &self.doc;
        if doc.kind(pos.block) != Some(&BlockKindData::Paragraph)
            || (empty && !self.empty_paragraph_at(pos))
        {
            return Ok(false);
        }
        let Some((item, index)) = doc.index_in_parent(pos.block) else {
            return Ok(false);
        };
        if index == 0
            || !doc.kind(item).is_some_and(is_list_item)
            || index + 1 != doc.children(item).len()
            || !self.empty_paragraph_at(pos)
        {
            return Ok(false);
        }
        let Some((list, item_index)) = doc.index_in_parent(item) else {
            return Ok(false);
        };
        let checked = match doc.kind(item) {
            Some(BlockKindData::ListItem { checked, .. }) => checked.map(|_| false),
            _ => None,
        };
        let leaf = pos.block;
        self.transact(EditOrigin::Command("lift_paragraph"), |tx| {
            let para = tx.remove_block(leaf)?;
            // The item was loose only because of the trailing paragraph.
            if tx.doc.children(item).len() == 1
                && let Some(BlockKindData::ListItem { checked, .. }) = tx.doc.kind(item).cloned()
            {
                tx.set_kind(
                    item,
                    BlockKindData::ListItem {
                        checked,
                        spread: false,
                    },
                )?;
            }
            let new_item = DetachedBlock::container(
                BlockKindData::ListItem {
                    checked,
                    spread: false,
                },
                vec![para],
            );
            tx.insert(list, item_index + 1, vec![new_item])?;
            Ok(caret(BlockPosition::new(leaf, 0)))
        })?;
        Ok(true)
    }

    /// Enter on an empty paragraph in a blockquote: the last child moves
    /// after the quote; one in the middle splits the quote around it.
    fn exit_quote(&mut self, pos: BlockPosition) -> Result<bool, CommandError> {
        if !self.empty_paragraph_at(pos) {
            return Ok(false);
        }
        let doc = &self.doc;
        let Some((quote, index)) = doc.index_in_parent(pos.block) else {
            return Ok(false);
        };
        if doc.kind(quote) != Some(&BlockKindData::Blockquote) {
            return Ok(false);
        }
        let Some((outer, quote_index)) = doc.index_in_parent(quote) else {
            return Ok(false);
        };
        let count = doc.children(quote).len();
        let leaf = pos.block;
        self.transact(EditOrigin::Command("exit_quote"), |tx| {
            let rest = tx.remove(quote, index + 1..count)?;
            let para = tx.remove_block(leaf)?;
            let mut at = quote_index + 1;
            if index == 0 {
                tx.remove(outer, quote_index..quote_index + 1)?;
                at = quote_index;
            }
            tx.insert(outer, at, vec![para])?;
            if !rest.is_empty() {
                let tail = DetachedBlock::container(BlockKindData::Blockquote, rest);
                tx.insert(outer, at + 1, vec![tail])?;
            }
            Ok(caret(BlockPosition::new(leaf, 0)))
        })?;
        Ok(true)
    }

    /// Backspace at the start of a blockquote's first paragraph: move it
    /// out before the quote (the quote goes when it empties).
    fn lift_first_in_quote(&mut self, pos: BlockPosition) -> Result<bool, CommandError> {
        let doc = &self.doc;
        if doc.kind(pos.block) != Some(&BlockKindData::Paragraph) {
            return Ok(false);
        }
        let Some((quote, 0)) = doc.index_in_parent(pos.block) else {
            return Ok(false);
        };
        if doc.kind(quote) != Some(&BlockKindData::Blockquote) {
            return Ok(false);
        }
        let Some((outer, quote_index)) = doc.index_in_parent(quote) else {
            return Ok(false);
        };
        let only = doc.children(quote).len() == 1;
        let leaf = pos.block;
        self.transact(EditOrigin::Command("lift_quote"), |tx| {
            let para = tx.remove_block(leaf)?;
            if only {
                tx.remove(outer, quote_index..quote_index + 1)?;
            }
            tx.insert(outer, quote_index, vec![para])?;
            Ok(caret(BlockPosition::new(leaf, 0)))
        })?;
        Ok(true)
    }

    /// Check or uncheck the task item whose first leaf is `leaf`, keeping
    /// the selection. One undo step.
    pub(crate) fn set_item_checked(
        &mut self,
        leaf: BlockId,
        on: bool,
    ) -> Result<bool, CommandError> {
        let Some((item, _)) = self.doc.index_in_parent(leaf) else {
            return Ok(false);
        };
        let Some(BlockKindData::ListItem { spread, .. }) = self.doc.kind(item).cloned() else {
            return Ok(false);
        };
        self.transact(EditOrigin::Command("set_task_checked"), |tx| {
            tx.set_kind(
                item,
                BlockKindData::ListItem {
                    checked: Some(on),
                    spread,
                },
            )?;
            Ok(None)
        })
    }

    fn exit_empty_item(&mut self, pos: BlockPosition) -> Result<bool, CommandError> {
        let doc = &self.doc;
        if doc.kind(pos.block) != Some(&BlockKindData::Paragraph)
            || doc
                .inline(pos.block)
                .is_none_or(|inline| !inline.is_empty())
        {
            return Ok(false);
        }
        let Some((item, 0)) = doc.index_in_parent(pos.block) else {
            return Ok(false);
        };
        if !doc.kind(item).is_some_and(is_list_item) || doc.children(item).len() != 1 {
            return Ok(false);
        }
        let Some((list, index)) = doc.index_in_parent(item) else {
            return Ok(false);
        };
        let Some(BlockKindData::List { ordered, .. }) = doc.kind(list).cloned() else {
            return Ok(false);
        };
        let Some((outer, list_index)) = doc.index_in_parent(list) else {
            return Ok(false);
        };
        if doc.kind(outer).is_some_and(is_list_item) {
            self.outdent()?;
            return Ok(true);
        }
        let leaf = pos.block;
        self.transact(EditOrigin::Command("exit_list"), |tx| {
            let count = tx.doc.children(list).len();
            let mut removed = tx.remove(list, index..count)?;
            let rest: Vec<_> = removed.drain(1..).collect();
            let item = removed.pop().ok_or(StepError::OutOfRange)?;
            let DetachedContent::Children(content) = item.content else {
                return Err(StepError::KindMismatch.into());
            };
            let mut at = list_index + 1;
            if index == 0 {
                tx.remove(outer, list_index..list_index + 1)?;
                at = list_index;
            }
            let inserted = content.len();
            tx.insert(outer, at, content)?;
            if !rest.is_empty() {
                let tail = DetachedBlock::container(
                    BlockKindData::List {
                        ordered,
                        start: None,
                    },
                    rest,
                );
                tx.insert(outer, at + inserted, vec![tail])?;
            }
            Ok(caret(BlockPosition::new(leaf, 0)))
        })?;
        Ok(true)
    }

    /// Paste Markdown as blocks, as one undo step. Text without a line
    /// break, or that parses to a single paragraph, is left to plain
    /// insertion (`insert_text`). Otherwise the text is parsed: a
    /// leading paragraph merges into the text before the caret, a trailing
    /// one into the text after it, and the blocks between are inserted
    /// between the two halves. Returns whether it applied (`false` for
    /// single-line text or when the caret is not in an editable text block;
    /// the caller then inserts plain text).
    pub fn paste_blocks(&mut self, text: &str) -> Result<bool, CommandError> {
        self.paste_block_markdown(text, false)
    }

    /// Paste the editor's own block copy: always parsed as blocks, even a
    /// single line (`# Title`).
    pub(crate) fn paste_blocks_markdown(&mut self, text: &str) -> Result<bool, CommandError> {
        self.paste_block_markdown(text, true)
    }
}
