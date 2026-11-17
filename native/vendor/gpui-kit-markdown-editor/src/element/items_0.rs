use std::{cell::Cell, collections::HashMap, ops::Range, rc::Rc};

use gpui::prelude::FluentBuilder as _;
use gpui::{
    AnyElement, App, Bounds, CursorStyle, DefiniteLength, DispatchPhase, Edges, Element, ElementId,
    ElementInputHandler, Entity, GlobalElementId, Hitbox, HitboxBehavior, Hsla, InspectorElementId,
    InteractiveElement, IntoElement, LayoutId, MouseButton, MouseDownEvent, MouseMoveEvent,
    MouseUpEvent, ParentElement, Pixels, Refineable, RenderOnce, Role, StatefulInteractiveElement,
    Style, StyleRefinement, Styled, TextStyle, Window, canvas, div, fill, point, px, size,
};

use super::{cull::Measured, id::BlockId, projection::Snapshot, state::*, style::BlockEditorStyle};
use crate::support::secondary_modifier;
use gpui_kit::base::StyledExt as _;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::base::text::editor_host::{
    BlockNode, FlowPosition, RenderContext, collect_leaf_geometry,
};

/// Items per cull unit of a long top-level list.
const LIST_CHUNK: usize = 32;
type ImageSourceResolver = std::sync::Arc<dyn Fn(&gpui::SharedUri) -> gpui::ImageSource + Send + Sync>;

/// A block-based WYSIWYG Markdown editor (spike). Hold an
/// `Entity<BlockEditorState>` and pass it here in `render`. Instance styling
/// applies to the native input root; it installs no padding or height defaults.
#[derive(IntoElement)]
pub struct BlockEditor {
    state: Entity<BlockEditorState>,
    style: StyleRefinement,
    label: Option<gpui::SharedString>,
    image_source: Option<ImageSourceResolver>,
}

impl BlockEditor {
    pub fn new(state: &Entity<BlockEditorState>) -> Self {
        Self {
            state: state.clone(),
            style: StyleRefinement::default(),
            label: None,
            image_source: None,
        }
    }

    /// Set the host application's localized accessible name.
    pub fn aria_label(mut self, label: impl Into<gpui::SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    /// Resolve images through a host-owned access policy.
    pub fn image_source(mut self, resolver: impl Fn(&gpui::SharedUri) -> gpui::ImageSource + Send + Sync + 'static) -> Self {
        self.image_source = Some(std::sync::Arc::new(resolver));
        self
    }
}

// Presentation is applied inside EditorRoot so padding is part of its
// native hitbox and input bounds, not an unfocusable outer wrapper.
impl Styled for BlockEditor {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

/// The accessible role (and heading level) of a top-level block (Phase 5,
/// per-block accessibility). `None` for blocks that are not exposed on
/// their own (definitions, breaks).
pub(crate) fn block_role(node: &BlockNode) -> Option<(Role, Option<usize>)> {
    Some(match node {
        BlockNode::Paragraph(_) => (Role::Paragraph, None),
        BlockNode::Heading { level, .. } => (Role::Heading, Some(*level as usize)),
        BlockNode::Blockquote { .. } => (Role::Blockquote, None),
        BlockNode::List { .. } => (Role::List, None),
        BlockNode::CodeBlock(_) => (Role::Code, None),
        BlockNode::Table(_) => (Role::Table, None),
        BlockNode::HorizontalRule { .. } => (Role::Splitter, None),
        BlockNode::Custom { .. } => (Role::Group, None),
        BlockNode::ListItem { .. } => (Role::ListItem, None),
        BlockNode::Root { .. }
        | BlockNode::Break { .. }
        | BlockNode::Definition { .. }
        | BlockNode::Unknown => return None,
        _ => return None,
    })
}

impl RenderOnce for BlockEditor {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = gpui_kit::base::Theme::global(cx);
        // Links are followed by the editor itself (Cmd/Ctrl-click); the shared
        // renderer must never open a URL on its own.
        let mut render_cx = RenderContext::from_app(cx).on_link_click(|_, _, _, _| {});
        if let Some(resolver) = self.image_source {
            render_cx = render_cx.with_image_source(move |uri| resolver(uri));
        }
        let text_style = render_cx.style().clone();
        let mut style = self.state.read(cx).style.resolved(&theme.tokens);
        if style.selection_is_default() {
            style = style.with_selection(text_style.selection());
        }
        // Read the prior frame before request_layout can reset shared text
        // layouts. Manual scrolling must not become a reflow reveal request.
        let caret_was_visible = {
            let state = self.state.read(cx);
            state
                .scroll_handle
                .as_ref()
                .zip(state.model.caret())
                .is_some_and(|(handle, pos)| {
                    state
                        .frame
                        .borrow()
                        .caret_bounds(pos, style.caret_width())
                        .is_some_and(|caret| handle.bounds().contains(&caret.center()))
                })
        };
        let (focus, snapshot, backgrounds, extensions, keep, list_items) =
            self.state.update(cx, |state, _| {
                let snapshot = state.snapshot();
                let mut backgrounds: HashMap<u64, Vec<(Range<usize>, Hsla)>> = HashMap::new();
                for (block, range) in state.selection_ranges() {
                    // Atoms paint whole (O(1) lookup, not a scan of the leaves).
                    let range = match state.model.doc.get(block).map(|e| &e.content) {
                        Some(super::document::BlockContent::Atom(_)) => {
                            0..state.model.doc.leaf_len(block).unwrap_or(range.end)
                        }
                        _ => range,
                    };
                    backgrounds
                        .entry(block.as_u64())
                        .or_default()
                        .push((range, style.selection()));
                }
                (
                    state.focus_handle.clone(),
                    snapshot,
                    backgrounds,
                    state.model.doc.extensions.clone(),
                    state.pinned_blocks(),
                    // Only needed to rebuild the cached cull units.
                    (!state.cull.borrow().index.is_current(state.model.revision())).then(|| {
                        let doc = &state.model.doc;
                        doc.children(doc.root)
                            .iter()
                            .filter(|id| {
                                matches!(
                                    doc.kind(**id),
                                    Some(super::kind::BlockKindData::List { .. })
                                ) && doc.children(**id).len() > LIST_CHUNK
                            })
                            .map(|id| (*id, Rc::<[BlockId]>::from(doc.children(*id))))
                            .collect::<HashMap<_, _>>()
                    }),
                )
            });

        // Match the native root's effective inherited/instance typography
        // before deriving body-relative node metrics and culling geometry.
        let mut typography = window.text_style();
        typography.refine(&self.style.text);
        let node_cx = render_cx
            .with_markdown_extensions(extensions)
            .with_body_font_size(typography.font_size.to_pixels(window.rem_size()));
        let (cull, revision) = {
            let state = self.state.read(cx);
            (state.cull.clone(), state.model.revision())
        };
        let mut children: Vec<AnyElement> = Vec::new();
        {
            let mut cull_state = cull.borrow_mut();
            cull_state.measured.clear();
            let window_span = cull_state.visible.map(|(top, bottom)| {
                // Overscan two viewports each way, so a fast scroll stays
                // within laid-out blocks until the next frame catches up.
                let margin = ((bottom - top) * 2.).max(px(600.));
                (top - margin, bottom + margin)
            });
            let cull_state = &mut *cull_state;
            if let Some(list_items) = list_items {
                // Cull units: each top-level node, except that a long
                // top-level list is split into chunks of `LIST_CHUNK` items,
                // each rendered as a list of its own (continuing the
                // numbering, no gap between chunks). Rebuilt per revision.
                let nodes: Vec<&BlockNode> = snapshot
                    .blocks
                    .iter()
                    .flat_map(|b| b.nodes.iter())
                    .collect();
                let mut units = Vec::with_capacity(nodes.len());
                let mut node_ix = 0;
                for (block_ix, block) in snapshot.blocks.iter().enumerate() {
                    for (node_in_block, node) in block.nodes.iter().enumerate() {
                        let flow = FlowPosition::at(&nodes, node_ix, false);
                        let unit = |id, items| super::cull::UnitDesc {
                            id,
                            block: block_ix,
                            node: node_in_block,
                            node_ix,
                            items,
                            flow,
                        };
                        match (node, list_items.get(&block.id)) {
                            (BlockNode::List { children, .. }, Some(ids))
                                if ids.len() == children.len() =>
                            {
                                for start in (0..ids.len()).step_by(LIST_CHUNK) {
                                    let range = start..(start + LIST_CHUNK).min(ids.len());
                                    units.push(unit(ids[start], Some((range, ids.clone()))));
                                }
                            }
                            _ => units.push(unit(block.id, None)),
                        }
                        node_ix += 1;
                    }
                }
                cull_state.index.rebuild(
                    revision,
                    units.iter().map(|u| {
                        let covered: &[BlockId] = match &u.items {
                            Some((range, ids)) => &ids[range.clone()],
                            None => &[],
                        };
                        (u.id, covered)
                    }),
                    &cull_state.heights,
                );
                cull_state.units = units;
                cull_state.node_count = nodes.len();
            }
            let units = &cull_state.units;
            let count = cull_state.node_count;
            let index = &cull_state.index;
            let n = units.len();
            // Units to lay out: the visible range (binary search over the
            // prefix sums) plus pinned units (selection ends, IME).
            let (first, last) = match window_span {
                None => (0, n),
                Some((top, bottom)) => {
                    let first = index.find(top.max(px(0.))).min(n);
                    (first, (index.find(bottom) + 1).min(n).max(first))
                }
            };
            let mut wanted: Vec<usize> = keep
                .iter()
                .filter_map(|id| index.unit_of.get(id).copied())
                .filter(|ix| *ix < first || *ix >= last)
                .collect();
            wanted.extend(first..last);
            wanted.sort_unstable();
            wanted.dedup();
            let mut cursor = px(0.);
            let mut rendered = 0;
            for unit_ix in wanted {
                let unit = &units[unit_ix];
                let node_ix = unit.node_ix;
                let top = index.prefix(unit_ix);
                if top > cursor {
                    children.push(div().h(top - cursor).into_any_element());
                }
                cursor = top + index.height(unit_ix);
                rendered += 1;
                let flow = unit.flow;
                let is_last_node = node_ix + 1 == count;
                let node = &snapshot.blocks[unit.block].nodes[unit.node];
                let element = match (&unit.items, node) {
                    (
                        Some((range, ids)),
                        BlockNode::List {
                            children: items,
                            ordered,
                            start,
                            ..
                        },
                    ) => {
                        let last_chunk = range.end == ids.len();
                        let chunk = BlockNode::List {
                            children: items[range.clone()].to_vec(),
                            ordered: *ordered,
                            start: if *ordered {
                                Some(start.unwrap_or(1) + range.start as u32)
                            } else {
                                *start
                            },
                            span: None,
                        };
                        let flow = if range.start == 0 {
                            flow
                        } else {
                            flow.first(false)
                        };
                        chunk.render(
                            node_ix,
                            // Inner chunks drop the list's bottom gap.
                            flow.last(!last_chunk || is_last_node),
                            &node_cx,
                            window,
                            cx,
                        )
                    }
                    _ => node.render(node_ix, flow.last(is_last_node), &node_cx, window, cx),
                };
                // Per-block accessibility node around the rendered block.
                let element = match block_role(node) {
                    Some((role, level)) => div()
                        .id(("block", unit.id.as_u64() as usize))
                        .role(role)
                        .when_some(level, |this, level| this.aria_level(level))
                        .child(element)
                        .into_any_element(),
                    None => element,
                };
                children.push(
                    Measured {
                        id: unit.id,
                        index: unit_ix,
                        state: cull.clone(),
                        child: Some(element),
                    }
                    .into_any_element(),
                );
            }
            let total = index.prefix(n);
            if total > cursor {
                children.push(div().h(total - cursor).into_any_element());
            }
            cull_state.rendered = rendered;
        }

        let content_bounds = Rc::new(Cell::new(Bounds::default()));
        let measured_content = content_bounds.clone();
        let mut root_style = Style::default();
        root_style.refine(&self.style);
        let s = &self.state;
        div()
            .id(("block-editor", self.state.entity_id()))
            .test_support()
            .when_some(self.label, |this, label| this.aria_label(label))
            // D8: one multi-line text input over the document; the value is
            // built only while accessibility is active (cached per revision).
            .role(Role::MultilineTextInput)
            .when(window.is_a11y_active() || cfg!(test) || cfg!(feature = "test-support"), |this| {
                this.aria_value(self.state.read(cx).accessible_value())
            })
            .key_context(self.state.read(cx).key_context())
            .track_focus(&focus)
            .cursor(if self.state.read(cx).grip_hover {
                CursorStyle::OpenHand
            } else if self.state.read(cx).pointer_hand {
                CursorStyle::PointingHand
            } else {
                CursorStyle::IBeam
            })
            .w_full()
            .on_action(window.listener_for(s, BlockEditorState::on_backspace))
            .on_action(window.listener_for(s, BlockEditorState::on_delete))
            .on_action(window.listener_for(s, BlockEditorState::on_delete_word_left))
            .on_action(window.listener_for(s, BlockEditorState::on_delete_word_right))
            .on_action(window.listener_for(s, BlockEditorState::on_delete_to_line_start))
            .on_action(window.listener_for(s, BlockEditorState::on_delete_to_line_end))
            .on_action(window.listener_for(s, BlockEditorState::on_move_paragraph_start))
            .on_action(window.listener_for(s, BlockEditorState::on_move_paragraph_end))
            .on_action(window.listener_for(s, BlockEditorState::on_select_paragraph_start))
            .on_action(window.listener_for(s, BlockEditorState::on_select_paragraph_end))
            .on_action(window.listener_for(s, BlockEditorState::on_enter))
            .on_action(window.listener_for(s, BlockEditorState::on_structural_enter))
            .on_action(window.listener_for(s, BlockEditorState::on_soft_break))
            .on_action(window.listener_for(s, BlockEditorState::on_exit_block))
            .on_action(window.listener_for(s, BlockEditorState::on_move_left))
            .on_action(window.listener_for(s, BlockEditorState::on_move_right))
            .on_action(window.listener_for(s, BlockEditorState::on_move_up))
            .on_action(window.listener_for(s, BlockEditorState::on_move_down))
            .on_action(window.listener_for(s, BlockEditorState::on_move_home))
            .on_action(window.listener_for(s, BlockEditorState::on_move_end))
            .on_action(window.listener_for(s, BlockEditorState::on_select_left))
            .on_action(window.listener_for(s, BlockEditorState::on_move_word_left))
            .on_action(window.listener_for(s, BlockEditorState::on_move_word_right))
            .on_action(window.listener_for(s, BlockEditorState::on_select_word_left))
            .on_action(window.listener_for(s, BlockEditorState::on_select_word_right))
            .on_action(window.listener_for(s, BlockEditorState::on_select_right))
            .on_action(window.listener_for(s, BlockEditorState::on_select_up))
            .on_action(window.listener_for(s, BlockEditorState::on_select_down))
            .on_action(window.listener_for(s, BlockEditorState::on_select_home))
            .on_action(window.listener_for(s, BlockEditorState::on_select_end))
            .on_action(window.listener_for(s, BlockEditorState::on_move_doc_start))
            .on_action(window.listener_for(s, BlockEditorState::on_move_doc_end))
            .on_action(window.listener_for(s, BlockEditorState::on_select_doc_start))
            .on_action(window.listener_for(s, BlockEditorState::on_select_doc_end))
            .on_action(window.listener_for(s, BlockEditorState::on_select_all))
            .on_action(window.listener_for(s, BlockEditorState::on_undo))
            .on_action(window.listener_for(s, BlockEditorState::on_redo))
            .on_action(window.listener_for(s, BlockEditorState::on_normal_text))
            .on_action(window.listener_for(s, BlockEditorState::on_table_insert_column_left))
            .on_action(window.listener_for(s, BlockEditorState::on_table_insert_column_right))
            .on_action(window.listener_for(s, BlockEditorState::on_table_insert_row_above))
            .on_action(window.listener_for(s, BlockEditorState::on_table_insert_row_below))
            .on_action(window.listener_for(s, BlockEditorState::on_table_delete_line))
            .on_action(window.listener_for(s, BlockEditorState::on_close_table_menu))
            .on_action(window.listener_for(s, BlockEditorState::on_toggle_bold))
            .on_action(window.listener_for(s, BlockEditorState::on_toggle_toolbar))
            .on_action(window.listener_for(s, BlockEditorState::on_toggle_italic))
            .on_action(window.listener_for(s, BlockEditorState::on_edit_link))
            .on_action(window.listener_for(s, BlockEditorState::on_toggle_code))
            .on_action(window.listener_for(s, BlockEditorState::on_indent))
            .on_action(window.listener_for(s, BlockEditorState::on_outdent))
            .on_action(window.listener_for(s, BlockEditorState::on_copy))
            .on_action(window.listener_for(s, BlockEditorState::on_cut))
            .on_action(window.listener_for(s, BlockEditorState::on_paste))
            .on_action(window.listener_for(s, BlockEditorState::on_native_paste))
            .on_action(window.listener_for(s, BlockEditorState::on_paste_plain))
            .children(super::table_ui::render_menu(&self.state, cx))
            .child(EditorRoot {
                state: self.state.clone(),
                child: Some(
                    div()
                        .w_full()
                        .refine_style(&self.style)
                        .child(
                            div().relative().w_full().children(children).child(
                                canvas(
                                    move |bounds, _, _| measured_content.set(bounds),
                                    |_, _, _, _| {},
                                )
                                .absolute()
                                .top_0()
                                .left_0()
                                .size_full(),
                            ),
                        )
                        .into_any_element(),
                ),
                content_bounds,
                padding: root_style.padding,
                typography,
                caret_was_visible,
                backgrounds: Some(backgrounds),
                snapshot,
                style,
            })
    }
}

type LeafBackgrounds = HashMap<u64, Vec<(Range<usize>, Hsla)>>;

struct EditorRoot {
    state: Entity<BlockEditorState>,
    child: Option<AnyElement>,
    backgrounds: Option<LeafBackgrounds>,
    snapshot: Rc<Snapshot>,
    style: BlockEditorStyle,
    content_bounds: Rc<Cell<Bounds<Pixels>>>,
    padding: Edges<DefiniteLength>,
    typography: TextStyle,
    caret_was_visible: bool,
}

impl IntoElement for EditorRoot {
    type Element = Self;
    fn into_element(self) -> Self::Element {
        self
    }
}

pub(crate) struct Prepaint {
    hitbox: Hitbox,
}
