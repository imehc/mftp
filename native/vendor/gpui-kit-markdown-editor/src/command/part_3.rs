// Upstream command.rs; split at impl method boundaries without changing behavior.
impl BlockEditorModel {

    fn toggle_list(&mut self, ordered: bool) -> Result<bool, CommandError> {
        let resolved = self.caret_resolved()?;
        let leaf = resolved.pos.block;
        let item = resolved.nearest(&self.doc, is_list_item);
        self.transact(EditOrigin::Command("toggle_list"), |tx| {
            match item {
                Some(item) => {
                    let (list, index) = tx
                        .doc
                        .index_in_parent(item)
                        .ok_or(StepError::UnknownBlock(item))?;
                    let Some(BlockKindData::List {
                        ordered: was,
                        start,
                    }) = tx.doc.kind(list).cloned()
                    else {
                        return Ok(None);
                    };
                    if was != ordered {
                        tx.set_kind(list, BlockKindData::List { ordered, start })?;
                        return Ok(None);
                    }
                    // Lift the item out of its list, splitting the list.
                    let (outer, list_index) = tx
                        .doc
                        .index_in_parent(list)
                        .ok_or(StepError::UnknownBlock(list))?;
                    let count = tx.doc.children(list).len();
                    let after = tx.remove(list, index + 1..count)?;
                    if !after.is_empty() {
                        let rest = DetachedBlock::container(
                            BlockKindData::List {
                                ordered,
                                start: None,
                            },
                            after,
                        );
                        tx.insert(outer, list_index + 1, vec![rest])?;
                    }
                    let content_len = tx.doc.children(item).len();
                    let content = tx.remove(item, 0..content_len)?;
                    tx.insert(outer, list_index + 1, content)?;
                }
                None => {
                    let (parent, index) = tx
                        .doc
                        .index_in_parent(leaf)
                        .ok_or(StepError::UnknownBlock(leaf))?;
                    let block = tx.remove_block(leaf)?;
                    let list = DetachedBlock::container(
                        BlockKindData::List {
                            ordered,
                            start: None,
                        },
                        vec![DetachedBlock::container(
                            BlockKindData::ListItem {
                                checked: None,
                                spread: false,
                            },
                            vec![block],
                        )],
                    );
                    tx.insert(parent, index, vec![list])?;
                }
            }
            Ok(None)
        })
    }

    /// The `---` input rule: the caret's (empty) paragraph becomes a
    /// horizontal rule followed by an empty paragraph holding the caret.
    pub(crate) fn paragraph_to_rule(&mut self) -> Result<bool, CommandError> {
        let leaf = self.caret_resolved()?.pos.block;
        self.transact(EditOrigin::Command("horizontal_rule"), |tx| {
            let (parent, index) = tx
                .doc
                .index_in_parent(leaf)
                .ok_or(StepError::UnknownBlock(leaf))?;
            let rule = DetachedBlock::leaf(
                BlockKindData::HorizontalRule,
                BlockContent::Atom(super::document::AtomData::None),
            );
            let para = DetachedBlock::paragraph(InlineText::new());
            let id = para.id;
            tx.remove_block(leaf)?;
            tx.insert(parent, index, vec![rule, para])?;
            Ok(caret(BlockPosition::new(id, 0)))
        })
    }

    /// Wrap the caret's leaf in a blockquote (the `> ` input rule).
    pub(crate) fn wrap_in_blockquote(&mut self) -> Result<bool, CommandError> {
        let leaf = self.caret_resolved()?.pos.block;
        self.transact(EditOrigin::Command("blockquote"), |tx| {
            let (parent, index) = tx
                .doc
                .index_in_parent(leaf)
                .ok_or(StepError::UnknownBlock(leaf))?;
            let block = tx.remove_block(leaf)?;
            let quote = DetachedBlock::container(BlockKindData::Blockquote, vec![block]);
            tx.insert(parent, index, vec![quote])?;
            Ok(None)
        })
    }

    /// Whether the caret is inside a blockquote.
    pub fn in_blockquote(&self) -> bool {
        self.caret_resolved()
            .ok()
            .and_then(|r| r.nearest(&self.doc, |k| matches!(k, BlockKindData::Blockquote)))
            .is_some()
    }

    /// Whether [`EditorCommand::Indent`] would nest the caret's list item
    /// (it needs a previous sibling item to nest under).
    pub fn can_indent(&self) -> bool {
        let Ok(resolved) = self.caret_resolved() else {
            return false;
        };
        resolved
            .nearest(&self.doc, is_list_item)
            .and_then(|item| self.doc.index_in_parent(item))
            .is_some_and(|(_, index)| index > 0)
    }

    /// Whether [`EditorCommand::Outdent`] would lift the caret's list item
    /// one level (it must be nested inside another item).
    pub fn can_outdent(&self) -> bool {
        let Ok(resolved) = self.caret_resolved() else {
            return false;
        };
        resolved
            .nearest(&self.doc, is_list_item)
            .and_then(|item| self.doc.index_in_parent(item))
            .and_then(|(list, _)| self.doc.index_in_parent(list))
            .is_some_and(|(outer, _)| self.doc.kind(outer).is_some_and(is_list_item))
    }

    fn toggle_blockquote(&mut self) -> Result<bool, CommandError> {
        let resolved = self.caret_resolved()?;
        let pos = resolved.pos;
        if let Some(quote) = resolved.nearest(&self.doc, |k| matches!(k, BlockKindData::Blockquote))
        {
            let (outer, index) = self
                .doc
                .index_in_parent(quote)
                .ok_or(PositionError::UnknownBlock(quote))?;
            let count = self.doc.children(quote).len();
            return self.transact(EditOrigin::Command("unquote"), |tx| {
                let blocks = tx.remove(quote, 0..count)?;
                tx.remove(outer, index..index + 1)?;
                tx.insert(outer, index, blocks)?;
                Ok(caret(pos))
            });
        }
        if !matches!(
            self.doc.kind(pos.block),
            Some(
                BlockKindData::Paragraph
                    | BlockKindData::Heading { .. }
                    | BlockKindData::CodeBlock { .. }
            )
        ) {
            return Err(CommandError::Unsupported("blockquote here"));
        }
        self.wrap_in_blockquote()?;
        let _ = self.set_selection(BlockSelection::caret(pos));
        Ok(true)
    }

    fn indent(&mut self) -> Result<bool, CommandError> {
        let resolved = self.caret_resolved()?;
        let Some(item) = resolved.nearest(&self.doc, is_list_item) else {
            return Ok(false);
        };
        let Some((list, index)) = self.doc.index_in_parent(item) else {
            return Ok(false);
        };
        if index == 0 {
            return Ok(false);
        }
        let prev = self.doc.children(list)[index - 1];
        let ordered = matches!(
            self.doc.kind(list),
            Some(BlockKindData::List { ordered: true, .. })
        );
        self.transact(EditOrigin::Command("indent"), |tx| {
            let nested = tx
                .doc
                .children(prev)
                .last()
                .copied()
                .filter(|id| matches!(tx.doc.kind(*id), Some(BlockKindData::List { .. })));
            let block = tx.remove_block(item)?;
            match nested {
                Some(nested) => {
                    let len = tx.doc.children(nested).len();
                    tx.insert(nested, len, vec![block])?;
                }
                None => {
                    let len = tx.doc.children(prev).len();
                    let list = DetachedBlock::container(
                        BlockKindData::List {
                            ordered,
                            start: None,
                        },
                        vec![block],
                    );
                    tx.insert(prev, len, vec![list])?;
                }
            }
            Ok(None)
        })
    }

    fn outdent(&mut self) -> Result<bool, CommandError> {
        // Shift+Tab on a list item's trailing empty paragraph lifts it.
        if let Ok(range) = self.resolved()
            && range.is_collapsed()
            && self.lift_item_trailing(range.start, true)?
        {
            return Ok(true);
        }
        let resolved = self.caret_resolved()?;
        let Some(item) = resolved.nearest(&self.doc, is_list_item) else {
            return Ok(false);
        };
        let Some((list, index)) = self.doc.index_in_parent(item) else {
            return Ok(false);
        };
        let Some((outer_item, _)) = self.doc.index_in_parent(list) else {
            return Ok(false);
        };
        if !self.doc.kind(outer_item).is_some_and(is_list_item) {
            // Lifting a top-level item out of its list is toggle_list.
            return Ok(false);
        }
        let list_kind = self.doc.kind(list).cloned();
        self.transact(EditOrigin::Command("outdent"), |tx| {
            let (outer_list, outer_index) = tx
                .doc
                .index_in_parent(outer_item)
                .ok_or(StepError::UnknownBlock(outer_item))?;
            // Following siblings become children of the outdented item.
            let count = tx.doc.children(list).len();
            let following = tx.remove(list, index + 1..count)?;
            let mut block = tx.remove_block(item)?;
            if !following.is_empty()
                && let (DetachedContent::Children(children), Some(kind)) =
                    (&mut block.content, list_kind.clone())
            {
                children.push(DetachedBlock::container(kind, following));
            }
            tx.insert(outer_list, outer_index + 1, vec![block])?;
            Ok(None)
        })
    }

    /// Move the top-level `block` to the gap `to` between the document's
    /// top-level blocks (0 = before the first, `len` = after the last),
    /// counted before the move (drag to reorder, D22). Nested blocks are
    /// refused with `Unsupported`; a move onto its own position is a no-op.
    pub(crate) fn move_block_to(
        &mut self,
        block: BlockId,
        to: usize,
    ) -> Result<bool, CommandError> {
        let root = self.doc.root;
        let Some((parent, index)) = self.doc.index_in_parent(block) else {
            return Err(CommandError::Position(PositionError::UnknownBlock(block)));
        };
        if parent != root {
            return Err(CommandError::Unsupported("move a nested block"));
        }
        let len = self.doc.children(root).len();
        if to > len {
            return Err(CommandError::Unsupported("gap out of range"));
        }
        let new_index = if to > index { to - 1 } else { to };
        if new_index == index {
            return Ok(false);
        }
        let selection = BlockSelection::Blocks {
            anchor: block,
            head: block,
        };
        self.transact(EditOrigin::Command("move_block_to"), |tx| {
            tx.move_block(block, root, new_index)?;
            Ok(Some(selection))
        })
    }

    fn move_blocks(&mut self, down: bool) -> Result<bool, CommandError> {
        let target = match self.selected_blocks() {
            Some((parent, range)) if range.len() == 1 => self.doc.children(parent)[range.start],
            Some(_) => return Err(CommandError::Unsupported("move several blocks")),
            None => {
                let resolved = self.caret_resolved()?;
                resolved
                    .nearest(&self.doc, is_list_item)
                    .unwrap_or(resolved.pos.block)
            }
        };
        let Some((parent, index)) = self.doc.index_in_parent(target) else {
            return Ok(false);
        };
        let len = self.doc.children(parent).len();
        let new_index = if down {
            if index + 1 >= len {
                return Ok(false);
            }
            index + 1
        } else {
            if index == 0 {
                return Ok(false);
            }
            index - 1
        };
        let selection = self.selection.clone();
        self.transact(EditOrigin::Command("move_blocks"), |tx| {
            tx.move_block(target, parent, new_index)?;
            Ok(Some(selection))
        })
    }

}
