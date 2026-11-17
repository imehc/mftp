

impl EntityInputHandler for BlockEditorState {
    fn text_for_range(
        &mut self,
        range16: Range<usize>,
        adjusted: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let text = self.ime_text();
        let range = utf16_to_byte(text, range16.start)..utf16_to_byte(text, range16.end);
        adjusted.replace(byte_to_utf16(text, range.start)..byte_to_utf16(text, range.end));
        text.get(range).map(str::to_string)
    }

    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        let (anchor, head) = self.head_anchor()?;
        let text = self.ime_text();
        // Cross-block selections are reported as the caret leaf's part.
        let in_leaf = |p: BlockPosition| {
            if p.block == head.block {
                p.offset
            } else if self.model.doc.cmp_positions(p, head).ok() == Some(std::cmp::Ordering::Less) {
                0
            } else {
                text.len()
            }
        };
        let (a, h) = (in_leaf(anchor), head.offset);
        Some(UTF16Selection {
            range: byte_to_utf16(text, a.min(h))..byte_to_utf16(text, a.max(h)),
            reversed: h < a,
        })
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        let m = self.marked.as_ref()?;
        let text = self.model.doc.leaf_text(m.block)?;
        Some(byte_to_utf16(text, m.range.start)..byte_to_utf16(text, m.range.end))
    }

    fn unmark_text(&mut self, _: &mut Window, _: &mut Context<Self>) {
        self.end_composition();
    }

    fn paste(&mut self, item: ClipboardItem, _: &mut Window, cx: &mut Context<Self>) {
        BlockEditorState::paste(self, item, false, cx);
    }

    fn replace_text_in_range(
        &mut self,
        range16: Option<Range<usize>>,
        text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.readonly {
            return;
        }
        let composing = self.marked.is_some();
        self.select_marked_or(range16);
        let origin = if composing {
            EditOrigin::Ime
        } else {
            EditOrigin::Typing
        };
        self.edit(origin, |m| m.insert_text(text, origin), cx);
        self.end_composition();
        if text == " " {
            self.apply_input_rule(cx);
        } else if text.ends_with(['`', '*', '~']) && self.rule_on(RuleKind::InlineMarks) {
            self.apply_mark_rule(cx);
        } else if text.ends_with(')') && self.rule_on(RuleKind::Link) {
            self.apply_link_rule(cx);
        }
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range16: Option<Range<usize>>,
        new_text: &str,
        new_selected16: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.readonly {
            return;
        }
        if new_text.is_empty() {
            // Cancelled composition: remove the marked text, close the group.
            if let Some(marked) = self.marked.clone() {
                self.select_marked_or(None);
                if !marked.range.is_empty() {
                    self.edit(EditOrigin::Ime, |m| m.delete(false), cx);
                }
            }
            self.end_composition();
            return;
        }
        self.select_marked_or(range16);
        let start = match self.model.doc.resolve_selection(self.model.selection()) {
            Ok(range) => range.start,
            Err(_) => return,
        };
        if !self.composition_open {
            // The whole composition is one undo step. Opened only once
            // something is about to be inserted; always closed by
            // `end_composition`.
            self.model.history.begin_transaction();
            self.composition_open = true;
        }
        let revision = self.model.revision();
        self.edit(
            EditOrigin::Ime,
            |m| m.insert_text(new_text, EditOrigin::Ime),
            cx,
        );
        let inserted = self.model.revision() != revision;
        let Some((_, head)) = self.head_anchor().filter(|_| inserted) else {
            // Nothing was inserted (e.g. into a code block): close the group.
            self.end_composition();
            return;
        };
        let block = head.block;
        let begin = if block == start.block {
            start.offset
        } else {
            head.offset.saturating_sub(new_text.len())
        };
        let range = begin..begin + new_text.len();
        self.marked = Some(Marked {
            block,
            range: range.clone(),
        });
        if let Some(sel16) = new_selected16 {
            let sel = utf16_to_byte(new_text, sel16.start)..utf16_to_byte(new_text, sel16.end);
            let _ = self.model.set_selection(BlockSelection::Text {
                anchor: BlockPosition::new(block, range.start + sel.start),
                head: BlockPosition::new(block, range.start + sel.end),
            });
        }
    }

    fn bounds_for_range(
        &mut self,
        range16: Range<usize>,
        _: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let block = self.ime_block()?;
        let text = self.ime_text();
        let start = utf16_to_byte(text, range16.start);
        let end = utf16_to_byte(text, range16.end);
        let frame = self.frame.borrow();
        let width = self.style.caret_width();
        let a = frame.caret_bounds(BlockPosition::new(block, start), width)?;
        let b = frame.caret_bounds(BlockPosition::new(block, end), width)?;
        Some(Bounds::from_corners(
            a.origin,
            gpui::point(
                b.origin.x.max(a.origin.x + width),
                a.origin.y + a.size.height,
            ),
        ))
    }

    fn character_index_for_point(
        &mut self,
        at: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        let pos = self.frame.borrow().hit_test(at)?;
        if Some(pos.block) != self.ime_block() {
            return None;
        }
        Some(byte_to_utf16(self.ime_text(), pos.offset))
    }
}

/// The byte range of the contiguous run linking to `url` around `offset`.
fn link_extent(
    inline: &super::inline::InlineText,
    offset: usize,
    url: &SharedString,
) -> Option<Range<usize>> {
    let pieces: Vec<_> = inline
        .pieces()
        .map(|(range, marks, _)| (range, marks.link.as_ref().map(|l| l.url.clone())))
        .collect();
    let ix = pieces
        .iter()
        .position(|(r, _)| r.start <= offset && offset < r.end)?;
    let same = |i: usize| pieces[i].1.as_ref() == Some(url);
    let (mut lo, mut hi) = (ix, ix);
    while lo > 0 && same(lo - 1) {
        lo -= 1;
    }
    while hi + 1 < pieces.len() && same(hi + 1) {
        hi += 1;
    }
    Some(pieces[lo].0.start..pieces[hi].0.end)
}

/// `[text](url)` ending at `caret`: the `[` offset, the text and the url.
fn link_rule(text: &str, caret: usize) -> Option<(usize, String, String)> {
    let before = text.get(..caret)?.strip_suffix(')')?;
    let open_paren = before.rfind("](")?;
    let url = &before[open_paren + 2..];
    if url.is_empty() || url.contains(char::is_whitespace) {
        return None;
    }
    let head = &before[..open_paren];
    let open = head.rfind('[')?;
    let label = &head[open + 1..];
    if label.is_empty() || label.contains(['[', ']']) {
        return None;
    }
    Some((open, label.to_string(), url.to_string()))
}

/// The language of a typed code fence (```` ``` ```` plus an optional word).
fn code_fence(text: &str) -> Option<String> {
    let lang = text.strip_prefix("```")?;
    lang.chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '+' | '-' | '_' | '#' | '.'))
        .then(|| lang.to_string())
}

/// The `(opening delimiter, closing delimiter, mark, typed_opening)` of an
/// inline-mark input rule completed by the delimiter just typed before
/// `caret`. Either order works: the closing delimiter typed after the text
/// (`*it*`), or, when the text already ends with one, the opening delimiter
/// typed in front of it (`it*`, caret moved back, `*`). Nothing fires inside
/// inline code, across an atom, around empty / space-padded content, or for
/// an escaped (`\`) delimiter.
fn mark_rule(
    inline: &super::inline::InlineText,
    caret: usize,
) -> Option<(Range<usize>, Range<usize>, MarkKind, bool)> {
    let text = inline.text();
    let prefix = text.get(..caret)?;
    let (delim, kind) = typed_delimiter(prefix)?;
    let typed = caret - delim.len()..caret;
    let pair = closing_pair(text, typed.clone(), delim)
        .map(|open| (open, typed.clone(), false))
        .or_else(|| opening_pair(text, typed.clone(), delim).map(|close| (typed, close, true)))?;
    let (open, close, typed_opening) = pair;
    let content = &text[open.end..close.start];
    if content.is_empty()
        || content.contains(super::inline::ATOM_CHAR)
        || (kind != MarkKind::Code
            && (content.starts_with(char::is_whitespace) || content.ends_with(char::is_whitespace)))
    {
        return None;
    }
    let in_code = inline
        .pieces()
        .any(|(r, m, _)| m.code && r.start < close.end && r.end > open.start);
    (!in_code).then_some((open, close, kind, typed_opening))
}

/// The delimiter ending `prefix` and its mark (longest first).
fn typed_delimiter(prefix: &str) -> Option<(&'static str, MarkKind)> {
    if prefix.ends_with('`') {
        Some(("`", MarkKind::Code))
    } else if prefix.ends_with("~~") {
        Some(("~~", MarkKind::Strikethrough))
    } else if prefix.ends_with("**") {
        Some(("**", MarkKind::Bold))
    } else if prefix.ends_with('*') {
        Some(("*", MarkKind::Italic))
    } else {
        None
    }
}

/// Forward order: the opening `delim` before the just-typed closing one.
fn closing_pair(text: &str, close: Range<usize>, delim: &str) -> Option<Range<usize>> {
    let before = &text[..close.start];
    let start = before.rfind(delim)?;
    // `*` must not be half of a `**`.
    if delim == "*" && (before[..start].ends_with('*') || before.ends_with('*')) {
        return None;
    }
    Some(start..start + delim.len())
}

/// Reverse order: `delim` was just typed in front of text that already ends
/// with a matching closing `delim`. Both delimiters must sit on word edges
/// (so `2*3` or `snake_case*` style punctuation inside words stays literal),
/// neither may be escaped or half of a longer run of the same character, and
/// the closing one is the nearest after the caret.
fn opening_pair(text: &str, open: Range<usize>, delim: &str) -> Option<Range<usize>> {
    let ch = delim.chars().next()?;
    let before = &text[..open.start];
    let after = &text[open.end..];
    if before.ends_with(ch) || before.ends_with('\\') || after.starts_with(ch) {
        return None;
    }
    if before
        .chars()
        .next_back()
        .is_some_and(char::is_alphanumeric)
    {
        return None;
    }
    let rel = after.find(delim)?;
    let close = open.end + rel..open.end + rel + delim.len();
    let (inner, tail) = (&text[open.end..close.start], &text[close.end..]);
    if inner.ends_with(ch) || inner.ends_with('\\') || tail.starts_with(ch) {
        return None;
    }
    if tail.chars().next().is_some_and(char::is_alphanumeric) {
        return None;
    }
    Some(close)
}
