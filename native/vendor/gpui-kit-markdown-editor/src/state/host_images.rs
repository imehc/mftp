// Host image changes stay atomic and use native positions, never source offsets.
impl BlockEditorState {
    pub fn set_visible_images(&mut self, urls: std::collections::HashSet<String>, cx: &mut Context<Self>) {
        if self.projection.nodes.visible_images.as_ref() != Some(&urls) {
            self.projection.invalidate();
            self.projection.nodes.visible_images = Some(urls);
            self.cull.borrow_mut().invalidate_measurements();
            cx.notify();
        }
    }
    pub fn insert_image(
        &mut self,
        captured: &super::CapturedRange,
        url: &str,
        alt: &str,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.readonly || self.is_composing() || !self.is_capture_current(captured) {
            return false;
        }
        let Ok(range) = self.model.doc.resolve_selection(&self.model.selection) else {
            return false;
        };
        if self.model.doc.inline(range.start.block).is_none() {
            return false;
        }
        let mut image = gpui_kit::base::text::editor_host::ImageNode::default();
        image.url = url.to_owned().into();
        image.alt = Some(alt.to_owned().into());
        let revision = self.model.revision();
        self.model.break_coalescing();
        self.edit(EditOrigin::Api, |model| {
            model.transact(EditOrigin::Api, |tx| {
                let pos = super::command::delete_range(tx, range)?;
                let insert = super::inline::InlineText::atom(
                    super::inline::InlineAtom::Image(image), Default::default());
                let len = insert.len();
                tx.replace_text(pos.block, pos.offset..pos.offset, insert)?;
                Ok(Some(BlockSelection::caret(BlockPosition::new(pos.block, pos.offset + len))))
            })?;
            Ok(())
        }, cx);
        self.model.break_coalescing();
        revision != self.model.revision()
    }

    pub fn remove_image(&mut self, url: &str, cx: &mut Context<Self>) {
        if self.readonly || self.is_composing() { return; }
        let ranges: Vec<_> = self.model.doc.leaves().iter().flat_map(|block| {
            self.model.doc.inline(*block).into_iter().flat_map(move |inline| {
                inline.pieces().filter_map(move |(range, _, atom)| match atom {
                    Some(super::inline::InlineAtom::Image(image)) if image.url.as_ref() == url => Some((*block, range)),
                    _ => None,
                })
            })
        }).collect();
        self.model.break_coalescing();
        self.edit(EditOrigin::Api, |model| {
            model.transact(EditOrigin::Api, |tx| {
                for (block, range) in ranges.into_iter().rev() {
                    tx.replace_text(block, range, super::inline::InlineText::new())?;
                }
                Ok(None)
            })?;
            Ok(())
        }, cx);
        self.model.break_coalescing();
    }
}
