// Upstream state.rs; split at impl method boundaries without changing behavior.
impl BlockEditorState {
    /// Create an editor holding one empty paragraph.
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let focus_handle = cx.focus_handle();
        let blink_cursor = cx.new(|_| BlinkCursor::new());
        // Focus and blink wiring as in `InputBaseState::new_in_mode` (§7.1).
        let subscriptions = vec![
            cx.observe(&blink_cursor, |_, _, cx| cx.notify()),
            cx.on_focus(&focus_handle, window, |this, _, cx| {
                this.blink_cursor.update(cx, |b, cx| b.start(cx));
                cx.emit(BlockEditorEvent::Focus);
            }),
            cx.on_blur(&focus_handle, window, |this, _, cx| {
                this.blink_cursor.update(cx, |b, cx| b.stop(cx));
                this.model.break_coalescing();
                this.end_composition();
                cx.emit(BlockEditorEvent::Blur);
            }),
            cx.observe_window_activation(window, |this, window, cx| {
                if window.is_window_active() && this.focus_handle.is_focused(window) {
                    this.blink_cursor.update(cx, |b, cx| b.start(cx));
                }
            }),
        ];
        let model = BlockEditorModel::from_markdown("", MarkdownExtensions::default())
            .unwrap_or_else(|_| unreachable!("empty source always parses"));
        Self {
            model,
            focus_handle,
            blink_cursor,
            style: BlockEditorStyle::default(),
            projection: ProjectionCache::default(),
            frame: Rc::default(),
            cull: Rc::default(),
            a11y_value: RefCell::default(),
            scroll_handle: Some(gpui::ScrollHandle::new()),
            reveal: Default::default(),
            marked: None,
            composition_open: false,
            goal_x: None,
            dragging: false,
            block_drag: None,
            readonly: false,
            toolbar_hidden: false,
            image_policy: super::ImagePolicy::default(),
            submit_policy: SubmitPolicy::default(),
            clipboard_policy: ClipboardPolicy::default(),
            paste_sequence: 0,
            pending_paste: None,
            input_rules: super::input_rule::InputRule::markdown_defaults(),
            input_rule_filter: None,
            hovered_link: None,
            pointer_hand: false,
            table_menu: None,
            table_hover: Vec::new(),
            grip_hover: false,
            _subscriptions: subscriptions,
        }
    }

    pub fn with_submit_policy(mut self, policy: SubmitPolicy) -> Self {
        self.submit_policy = policy;
        self
    }
    /// Replace the policy; notify the editor after changing it so the
    /// retained view's policy-scoped key context is refreshed.
    pub fn set_submit_policy(&mut self, policy: SubmitPolicy) {
        self.submit_policy = policy;
    }
    pub(crate) fn key_context(&self) -> &'static str {
        match (
            self.submit_policy == SubmitPolicy::Enter,
            self.table_menu.is_some(),
        ) {
            (true, false) => "BlockEditor submit=enter",
            (true, true) => "BlockEditor submit=enter table_menu",
            (false, false) => CONTEXT,
            (false, true) => "BlockEditor table_menu",
        }
    }
    pub fn with_clipboard_policy(mut self, policy: ClipboardPolicy) -> Self {
        self.clipboard_policy = policy;
        self
    }
    pub fn set_clipboard_policy(&mut self, policy: ClipboardPolicy) {
        self.clipboard_policy = policy;
    }
    /// The retained scroll owner; content-sized wrappers share this handle.
    pub fn scroll_handle(&self) -> Option<gpui::ScrollHandle> {
        self.scroll_handle.clone()
    }

    /// Builder: the Markdown input rules to run while typing (D13). The
    /// default is [`InputRule::markdown_defaults`](super::InputRule); pass an
    /// empty list to type Markdown literally.
    pub fn with_input_rules(
        mut self,
        rules: impl IntoIterator<Item = super::input_rule::InputRule>,
    ) -> Self {
        self.input_rules = rules.into_iter().collect();
        self
    }

    /// Pure policy invoked before an enabled input rule rewrites typed content.
    /// Return false when a host workflow (e.g. completion) owns the same sigil.
    /// Receives leaf-native text before the caret, never serialized offsets;
    /// must not perform I/O or re-enter the editor. Defaults to allowing rules.
    pub fn with_input_rule_filter(
        mut self,
        filter: impl Fn(super::InputRule, &str) -> bool + Send + Sync + 'static,
    ) -> Self {
        self.input_rule_filter = Some(Arc::new(filter));
        self
    }

    /// Replace the input rules (see [`Self::with_input_rules`]).
    pub fn set_input_rules(
        &mut self,
        rules: impl IntoIterator<Item = super::input_rule::InputRule>,
    ) {
        self.input_rules = rules.into_iter().collect();
    }

    /// Check or uncheck the task item holding `block` (a list item or its
    /// text leaf); one undo step (D14). The selection is kept.
    pub fn set_task_checked(&mut self, block: BlockId, checked: bool, cx: &mut Context<Self>) {
        if self.readonly {
            return;
        }
        let leaf = if self.model.doc.inline(block).is_some() {
            block
        } else {
            match self.model.doc.children(block).first() {
                Some(child) => *child,
                None => return,
            }
        };
        self.model.break_coalescing();
        self.edit(
            EditOrigin::Command("set_task_checked"),
            |m| m.set_item_checked(leaf, checked).map(|_| ()),
            cx,
        );
        self.model.break_coalescing();
    }

    fn rule_on(&self, kind: super::input_rule::RuleKind) -> bool {
        self.input_rules.iter().any(|rule| rule.0 == kind)
            && self.input_rule_filter.as_ref().is_none_or(|filter| {
                filter(
                    super::InputRule(kind),
                    self.model.caret_prefix().unwrap_or_default(),
                )
            })
    }

    /// Builder: initial Markdown.
    pub fn with_source(mut self, source: &str) -> Self {
        let _ = self.model.set_source(source);
        self.projection.invalidate();
        self
    }

    /// Replace the content. No `Changed` event; clears history.
    pub fn set_source(&mut self, source: &str, cx: &mut Context<Self>) -> Result<(), SharedString> {
        self.model.set_source(source)?;
        self.marked = None;
        self.composition_open = false;
        self.pending_paste = None;
        self.projection.invalidate();
        cx.notify();
        Ok(())
    }

    /// The document as canonical Markdown.
    pub fn source(&self) -> String {
        self.model.source()
    }

    /// Shared canonical source, materialized at most once per revision.
    pub fn source_snapshot(&self) -> super::SourceSnapshot {
        self.model.source_snapshot()
    }

    pub fn capture_caret(&self) -> Result<super::CapturedRange, super::CapturedRangeError> {
        self.model.capture_caret()
    }
    pub fn capture_selection(&self) -> Result<super::CapturedRange, super::CapturedRangeError> {
        self.model.capture_selection()
    }
    pub fn capture_suffix(
        &self,
        len: usize,
    ) -> Result<super::CapturedRange, super::CapturedRangeError> {
        self.model.capture_suffix(len)
    }
    pub fn capture_leaf_range(
        &self,
        range: std::ops::Range<usize>,
    ) -> Result<super::CapturedRange, super::CapturedRangeError> {
        self.model.capture_leaf_range(range)
    }
    /// Configure presentation/resource admission without mutating the document.
    pub fn with_image_policy(mut self, policy: super::ImagePolicy) -> Self {
        self.image_policy = policy;
        self
    }
    pub fn set_image_policy(&mut self, policy: super::ImagePolicy, cx: &mut Context<Self>) {
        self.image_policy = policy;
        self.projection.invalidate();
        cx.notify();
    }
    pub fn image_policy(&self) -> super::ImagePolicy {
        self.image_policy
    }

    pub fn caret_prefix_snapshot(&self) -> Option<SharedString> {
        self.model.caret_prefix_snapshot()
    }
    pub fn caret_prefix(&self) -> Option<&str> {
        self.model.caret_prefix()
    }
    pub fn is_capture_current(&self, range: &super::CapturedRange) -> bool {
        self.model.is_capture_current(range)
    }
    pub fn replace_captured(
        &mut self,
        range: &mut super::CapturedRange,
        text: &str,
        cx: &mut Context<Self>,
    ) -> Result<(), super::CapturedRangeError> {
        if self.readonly || self.marked.is_some() {
            return Err(super::CapturedRangeError::Stale);
        }
        self.model.replace_captured(range, text)?;
        self.after_edit(EditOrigin::Api, cx);
        Ok(())
    }
    pub fn select_end(&mut self, cx: &mut Context<Self>) -> Result<(), super::SelectionError> {
        self.model.select_end()?;
        self.selection_changed(cx);
        Ok(())
    }
    /// Reveal the current caret after viewport/layout changes without moving it.
    pub fn reveal_caret(&mut self, cx: &mut Context<Self>) {
        self.reveal.set(true);
        cx.notify();
    }
    /// Fence host callbacks on external owner changes without reparsing content.
    pub fn invalidate_captures(&mut self) {
        self.model.invalidate_captures();
        self.pending_paste = None;
    }
    pub fn is_composing(&self) -> bool {
        self.marked.is_some()
    }

    /// The headless model (document, selection, history).
    pub fn model(&self) -> &BlockEditorModel {
        &self.model
    }

    /// Document revision; bumped by every committed transaction.
    pub fn revision(&self) -> u64 {
        self.model.revision()
    }

    /// The current selection.
    pub fn selection(&self) -> &BlockSelection {
        self.model.selection()
    }

    /// Kind of the text block holding the caret, if any.
    pub fn block_kind_at_caret(&self) -> Option<BlockKind> {
        self.model.block_kind_at_caret()
    }

    /// Override caret, selection and composition colours (`BlockEditorStyle`).
    pub fn set_editor_style(&mut self, style: BlockEditorStyle, cx: &mut Context<Self>) {
        self.style = style;
        cx.notify();
    }

    /// The editor style overrides in effect.
    pub fn editor_style(&self) -> &BlockEditorStyle {
        &self.style
    }

    /// The scroll container the editor sits in (its `track_scroll` handle).
    /// With one set, the caret is scrolled into view after it moves; blocks
    /// outside the container's visible area are culled either way.
    pub fn set_scroll_handle(&mut self, handle: gpui::ScrollHandle) {
        self.scroll_handle = Some(handle);
    }

    /// Whether edits are blocked (navigation and selection still work).
    pub fn is_readonly(&self) -> bool {
        self.readonly
    }

    /// Block or allow edits.
    pub fn set_readonly(&mut self, readonly: bool, cx: &mut Context<Self>) {
        self.readonly = readonly;
        cx.notify();
    }

    /// Whether the optional toolbar is hidden. Only matters when the host
    /// shows one (`component::BlockEditor::toolbar` or `EditorToolbar`).
    pub fn is_toolbar_hidden(&self) -> bool {
        self.toolbar_hidden
    }

    /// Hide or show the optional toolbar.
    pub fn set_toolbar_hidden(&mut self, hidden: bool, cx: &mut Context<Self>) {
        if self.toolbar_hidden != hidden {
            self.toolbar_hidden = hidden;
            cx.notify();
        }
    }

    pub(crate) fn on_toggle_toolbar(
        &mut self,
        _: &ToggleToolbar,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.set_toolbar_hidden(!self.toolbar_hidden, cx);
    }

    /// Focus the editor.
    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        window.focus(&self.focus_handle, cx);
    }

    /// Set the selection; emits `SelectionChanged`.
    pub fn set_selection(
        &mut self,
        selection: BlockSelection,
        cx: &mut Context<Self>,
    ) -> Result<(), super::SelectionError> {
        self.model.set_selection(selection)?;
        self.selection_changed(cx);
        Ok(())
    }

    /// Run a model command as one transaction.
    pub fn run(
        &mut self,
        command: EditorCommand,
        cx: &mut Context<Self>,
    ) -> Result<bool, CommandError> {
        if self.readonly {
            return Ok(false);
        }
        let name = command_name(&command);
        self.end_composition();
        let revision = self.model.revision();
        let changed = self.model.run(command)?;
        if self.model.revision() != revision {
            self.after_edit(EditOrigin::Command(name), cx);
        } else {
            // Stored-mark toggles change no text but show in the toolbar.
            cx.notify();
        }
        Ok(changed)
    }

    /// Undo the last transaction (or IME composition) group.
    pub fn undo(&mut self, cx: &mut Context<Self>) {
        if self.readonly {
            return;
        }
        if self.model.undo() {
            self.after_edit(EditOrigin::Undo, cx);
        }
    }

    /// Redo the last undone group.
    pub fn redo(&mut self, cx: &mut Context<Self>) {
        if self.readonly {
            return;
        }
        if self.model.redo() {
            self.after_edit(EditOrigin::Redo, cx);
        }
    }

    /// The document as plain text for assistive technology (D8): leaves in
    /// order, one per line, inline atoms dropped. Built at most once per
    /// revision, and only asked for while accessibility is active.
    pub(crate) fn accessible_value(&self) -> SharedString {
        let revision = self.model.revision();
        if let Some((cached, value)) = &*self.a11y_value.borrow()
            && *cached == revision
        {
            return value.clone();
        }
        let doc = &self.model.doc;
        let value: SharedString = doc
            .leaves()
            .iter()
            .filter_map(|id| doc.leaf_text(*id))
            .map(|text| text.replace(super::inline::ATOM_CHAR, ""))
            .collect::<Vec<_>>()
            .join("\n")
            .into();
        *self.a11y_value.borrow_mut() = Some((revision, value.clone()));
        value
    }

    pub(crate) fn snapshot(&mut self) -> Rc<Snapshot> {
        self.projection
            .set_placeholders(self.image_policy == super::ImagePolicy::Placeholder);
        self.projection.snapshot(&self.model.doc)
    }

    /// Blocks that are always laid out: the selection ends, the IME
    /// composition, and their ancestors.
    pub(crate) fn pinned_blocks(&self) -> Vec<BlockId> {
        let doc = &self.model.doc;
        let mut ids = match self.model.selection() {
            BlockSelection::Text { anchor, head } => vec![anchor.block, head.block],
            BlockSelection::Blocks { anchor, head } | BlockSelection::Cells { anchor, head } => {
                vec![*anchor, *head]
            }
        };
        if let Some((block, _)) = self.marked_range() {
            ids.push(block);
        }
        // Every ancestor, so a chunk of a long list holding the caret's item
        // is pinned too.
        ids.into_iter().flat_map(|id| doc.path(id)).collect()
    }
}
