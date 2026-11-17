//! Themed, content-sized Markdown editor. Base retains all editing behavior.
pub use crate::{
    BlockEditorEvent, BlockEditorState, CapturedRange, CapturedRangeError, ClipboardPolicy,
    ImagePolicy, PasteRequest, SourceSnapshot, SubmitPolicy,
};
use gpui::prelude::FluentBuilder as _;
use gpui::{
    App, Entity, InteractiveElement, IntoElement, ParentElement, RenderOnce,
    StatefulInteractiveElement, Styled, Window, div, rems,
};
use gpui_kit::component::ActiveTheme;

// Medium input-family proportions (10px/8px at the default 16px rem),
// expressed on the same relative axis as the editor's content rows.
const INPUT_PADDING_X: f32 = 0.625;
const INPUT_PADDING_Y: f32 = 0.5;
const ROW_HEIGHT: f32 = 1.5;

#[derive(IntoElement)]
pub struct BlockEditor {
    state: Entity<BlockEditorState>,
    min_rows: usize,
    max_rows: usize,
    toolbar: bool,
}
impl BlockEditor {
    pub fn new(state: &Entity<BlockEditorState>) -> Self {
        Self {
            state: state.clone(),
            min_rows: 2,
            max_rows: 16,
            toolbar: false,
        }
    }
    /// Content-sized viewport clamped to content rows plus internal insets. The
    /// editor's retained handle owns scrolling and caret reveal; no outer
    /// scrolling node or application height mirror is needed.
    pub fn auto_grow(mut self, min: usize, max: usize) -> Self {
        self.min_rows = min.max(1);
        self.max_rows = max.max(self.min_rows);
        self
    }
    /// Show the optional formatting toolbar above the content (off by
    /// default; when off nothing is built). Users can still hide a shown
    /// toolbar with the [`crate::ToggleToolbar`] action if the app binds it.
    pub fn toolbar(mut self, toolbar: bool) -> Self {
        self.toolbar = toolbar;
        self
    }
}
impl RenderOnce for BlockEditor {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let scroll = self.state.read(cx).scroll_handle();
        let min_height = rems(self.min_rows as f32 * ROW_HEIGHT + INPUT_PADDING_Y * 2.);
        let max_height = rems(self.max_rows as f32 * ROW_HEIGHT + INPUT_PADDING_Y * 2.);
        let toolbar = self.toolbar && !self.state.read(cx).is_toolbar_hidden();
        let viewport = div()
            .id(("block-editor-viewport", self.state.entity_id()))
            .w_full()
            .min_w_0()
            .min_h(min_height)
            .max_h(max_height)
            .overflow_y_scroll()
            .when_some(scroll, |this, scroll| this.track_scroll(&scroll))
            .text_color(cx.theme().foreground)
            // Padding belongs to the native root, inside the sole scroll owner.
            .child(
                crate::BlockEditor::new(&self.state)
                    .min_h(min_height)
                    .px(rems(INPUT_PADDING_X))
                    .py(rems(INPUT_PADDING_Y)),
            );
        if !toolbar {
            return viewport.into_any_element();
        }
        div()
            .w_full()
            .min_w_0()
            .flex()
            .flex_col()
            .child(
                div()
                    .px(rems(INPUT_PADDING_X / 2.))
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .child(crate::EditorToolbar::new(&self.state)),
            )
            .child(viewport)
            .into_any_element()
    }
}
