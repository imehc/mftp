

impl EditorRoot {
    /// Scroll the caret into view in the owner's scroll container, once its
    /// block has been laid out (a culled block is pinned, so it is laid out
    /// in the frame after the caret moved there).
    fn reveal_caret(&self, bounds: Bounds<Pixels>, window: &mut Window, cx: &mut App) {
        let state = self.state.read(cx);
        if !state.reveal.get() {
            return;
        }
        let (Some(handle), Some(pos)) = (state.scroll_handle.clone(), state.model.caret()) else {
            state.reveal.set(false);
            return;
        };
        let Some(caret) = state
            .frame
            .borrow()
            .caret_bounds(pos, self.style.caret_width())
        else {
            return;
        };
        state.reveal.set(false);
        // The scroll owner stays at the region edge; text and the revealed
        // caret stay inside the root's presentation inset at either scroll end.
        let padding = self
            .padding
            .to_pixels(bounds.size.map(Into::into), window.rem_size());
        let mut view = handle.bounds();
        view.origin.y += padding.top;
        view.size.height = (view.size.height - padding.top - padding.bottom).max(Pixels::ZERO);
        let mut offset = handle.offset();
        if caret.top() < view.top() {
            offset.y += view.top() - caret.top();
        } else if caret.bottom() > view.bottom() {
            offset.y -= caret.bottom() - view.bottom();
        } else {
            return;
        }
        handle.set_offset(offset);
        window.refresh();
    }
}

impl Element for EditorRoot {
    type RequestLayoutState = AnyElement;
    type PrepaintState = Prepaint;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, AnyElement) {
        let mut child = self
            .child
            .take()
            .unwrap_or_else(|| div().into_any_element());
        let layout_id = child.request_layout(window, cx);
        (layout_id, child)
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        child: &mut AnyElement,
        window: &mut Window,
        cx: &mut App,
    ) -> Prepaint {
        if let Some(backgrounds) = self.backgrounds.take() {
            let (_, geometries) = collect_leaf_geometry(backgrounds, || child.prepaint(window, cx));
            // Swap in the complete frame; handlers read it until the next one.
            let mut frame = super::frame::into_frame(
                geometries,
                self.snapshot.leaves.clone(),
                &self.snapshot.tables,
            );
            frame.content = Some(self.content_bounds.get());
            {
                let state = self.state.read(cx);
                let doc = &state.model.doc;
                let shapes: Vec<super::frame::TableShape> = self
                    .snapshot
                    .tables
                    .iter()
                    .map(|(table, _)| super::frame::TableShape {
                        table: *table,
                        grid: super::table::grid(doc, *table),
                        aligns: match doc.kind(*table) {
                            Some(super::kind::BlockKindData::Table { aligns }) => aligns.clone(),
                            _ => Vec::new(),
                        },
                    })
                    .collect();
                // gpui-kit's cell padding is `px_3`: 0.75rem.
                let pad = window.rem_size() * 0.75;
                let right = frame.content.map(|c| c.right());
                frame.layout_tables(&shapes, pad, right);
            }
            *self.state.read(cx).frame.borrow_mut() = frame;
            let mask = window.content_mask().bounds;
            let content = self.content_bounds.get();
            let cull = self.state.read(cx).cull.clone();
            let geometry_changed = cull.borrow_mut().set_geometry(
                content.size.width,
                window.rem_size(),
                &self.typography,
            );
            // Retain a visible caret or an existing reveal request, but do not
            // interrupt manual scrolling. Wait for fresh spacer positions.
            if geometry_changed {
                if self.caret_was_visible {
                    self.state.read(cx).reveal.set(true);
                }
            } else {
                self.reveal_caret(bounds, window, cx);
            }
            if geometry_changed || cull.borrow_mut().finish_frame(content, mask) {
                // Geometry changed or scrolling left the laid-out span.
                let state = self.state.clone();
                window.on_next_frame(move |_, cx| state.update(cx, |_, cx| cx.notify()));
            }
        } else {
            child.prepaint(window, cx);
        }
        Prepaint {
            hitbox: window.insert_hitbox(bounds, HitboxBehavior::Normal),
        }
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        child: &mut AnyElement,
        prepaint: &mut Prepaint,
        window: &mut Window,
        cx: &mut App,
    ) {
        let state = self.state.read(cx);
        let focus = state.focus_handle.clone();
        let collapsed = state.selection_ranges().is_empty();
        let marked = state.marked_range();
        let caret = state.model.caret();
        let show_caret = state.show_caret(window, cx) && collapsed;
        let frame = state.frame.clone();
        let menu_line = state.table_menu.as_ref().map(|m| (m.table, m.line));
        let grips = state.table_grips_at(window.mouse_position());
        // Whole-table corner handles to show: the hovered table's, and any
        // node-selected table's. `true` when the pointer is on the handle.
        let table_handles: Vec<(Bounds<Pixels>, bool)> = {
            let mouse = window.mouse_position();
            let on = state.table_handle_at(mouse);
            let selected: Vec<BlockId> = state
                .model
                .selected_blocks()
                .map(|(parent, range)| {
                    state
                        .model
                        .doc
                        .children(parent)
                        .get(range)
                        .unwrap_or_default()
                        .to_vec()
                })
                .unwrap_or_default();
            let frame = state.frame.borrow();
            state
                .table_handles()
                .into_iter()
                .filter(|(table, handle)| {
                    selected.contains(table)
                        || on == Some(*table)
                        || frame.grids.iter().any(|g| {
                            g.table == *table
                                && g.bounds
                                    .union(handle)
                                    .dilate(px(TABLE_HOVER_REACH))
                                    .contains(&mouse)
                        })
                })
                .map(|(table, handle)| (handle, on == Some(table) || selected.contains(&table)))
                .collect()
        };
        // Node selection (a table, code block, …): the blocks' laid-out area.
        let selected_area = state.model.selected_blocks().and_then(|(parent, range)| {
            let doc = &state.model.doc;
            let ids = doc.children(parent).get(range)?.to_vec();
            let frame = frame.borrow();
            frame
                .leaves
                .iter()
                .filter(|leaf| {
                    let path = doc.path(leaf.info.block);
                    ids.iter()
                        .any(|id| *id == leaf.info.block || path.contains(id))
                })
                .map(|leaf| leaf.bounds())
                .reduce(|a, b| a.union(&b))
        });

        window.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.state.clone()),
            cx,
        );
        child.paint(window, cx);

        let frame = frame.borrow();
        let style = &self.style;
        // Block handle: a grip in the left edge of the hovered table or code
        // block; clicking the edge node-selects it (`block_handle_at`).
        let mouse = window.mouse_position();
        // Tables use the corner handle below instead.
        let hovered = frame
            .leaves
            .iter()
            .filter(|l| state_plain(&self.state, l.info.block, cx))
            .map(|l| l.bounds())
            .find(|b| {
                mouse.y >= b.top()
                    && mouse.y < b.bottom()
                    && mouse.x >= b.left() - px(24.)
                    && mouse.x < b.right()
            });
        if let Some(b) = hovered {
            let grip = Bounds::new(
                point(b.left() - px(14.), b.top() + px(2.)),
                size(px(4.), px(16.).min(b.size.height)),
            );
            window.paint_quad(fill(grip, style.caret().opacity(0.35)).corner_radii(px(2.)));
        }
        // Whole-table handle: a small rounded square with a 2x2 grid glyph
        // at the frame's outer top-left corner, distinct from the thin
        // row / column grips.
        for (handle, active) in table_handles {
            let alpha = if active { 0.9 } else { 0.45 };
            window.paint_quad(gpui::quad(
                handle,
                px(3.),
                style.selection().opacity(if active { 0.45 } else { 0.0 }),
                px(1.),
                style.caret().opacity(alpha),
                gpui::BorderStyle::Solid,
            ));
            let dot = px(2.);
            let c = handle.center();
            for (dx, dy) in [(-2.5, -2.5), (0.5, -2.5), (-2.5, 0.5), (0.5, 0.5)] {
                window.paint_quad(fill(
                    Bounds::new(point(c.x + px(dx), c.y + px(dy)), size(dot, dot)),
                    style.caret().opacity(alpha),
                ));
            }
        }
        // Table grips (D20): only for the hovered column / row, or the
        // line whose menu is open.
        for (table, line, grip) in grips {
            let open = menu_line == Some((table, line));
            let alpha = if open { 0.8 } else { 0.35 };
            window.paint_quad(fill(grip, style.caret().opacity(alpha)).corner_radii(px(2.)));
        }
        if let Some(area) = selected_area {
            let area = area.dilate(px(4.));
            window.paint_quad(gpui::quad(
                area,
                px(4.),
                style.selection().opacity(0.35),
                px(2.),
                style.caret(),
                gpui::BorderStyle::Solid,
            ));
        }
        // D22: where a dragged block would drop.
        if let Some(line) = self.state.read(cx).drop_indicator() {
            window.paint_quad(fill(line, style.caret()).corner_radii(px(1.)));
        }
        if let Some((block, range)) = marked
            && let Some(leaf) = frame.leaf(block)
        {
            let a = leaf.caret_point(range.start);
            let b = leaf.caret_point(range.end);
            let thickness = style.caret_width();
            let underline = Bounds::new(
                point(a.x, a.y + leaf.line_height() - thickness),
                size((b.x - a.x).max(thickness), thickness),
            );
            window.paint_quad(fill(underline, style.composition_underline()));
        }
        if show_caret
            && let Some(pos) = caret
            && let Some(b) = frame.caret_bounds(pos, style.caret_width())
        {
            // Whole device pixels, like the input caret: a 1px line at a
            // fractional x would blur over two pixels.
            let b = crate::support::snap_caret_to_device_pixels(b, window.scale_factor());
            window.paint_quad(fill(b, style.caret()));
        }
        drop(frame);

        // Mouse: handlers update the entity at event time, never in paint.
        let hitbox = prepaint.hitbox.clone();
        let entity = self.state.clone();
        window.on_mouse_event(move |event: &MouseDownEvent, phase, window, cx| {
            if phase != DispatchPhase::Bubble
                || event.button != MouseButton::Left
                || !hitbox.is_hovered(window)
            {
                return;
            }
            // A table grip selects its row / column and opens the menu;
            // any other click closes an open menu.
            if !event.modifiers.shift
                && entity.update(cx, |state, cx| {
                    let hit = state.click_table_grip(event.position, cx);
                    if !hit {
                        state.close_table_menu(cx);
                    }
                    hit
                })
            {
                let focus = entity.read(cx).focus_handle.clone();
                window.focus(&focus, cx);
                cx.stop_propagation();
                return;
            }
            // A task checkbox toggles without moving the caret or starting
            // a drag; nothing else handles this mouse-down.
            if !event.modifiers.shift
                && entity.update(cx, |state, cx| state.click_checkbox(event.position, cx))
            {
                cx.stop_propagation();
                return;
            }
            entity.update(cx, |state, cx| {
                let focus = state.focus_handle.clone();
                window.focus(&focus, cx);
                if secondary_modifier().is_subset_of(&event.modifiers)
                    && state.follow_link_at(event.position, cx)
                {
                    return;
                }
                state.dragging = true;
                if !event.modifiers.shift {
                    state.arm_block_drag(event.position);
                }
                state.mouse_at(event.position, event.modifiers.shift, cx);
                if !event.modifiers.shift && event.click_count >= 2 {
                    state.select_unit(event.click_count >= 3, cx);
                }
            });
        });
        let entity = self.state.clone();
        window.on_mouse_event(move |event: &MouseMoveEvent, phase, _, cx| {
            if phase != DispatchPhase::Bubble {
                return;
            }
            if event.pressed_button.is_none() {
                entity.update(cx, |state, cx| {
                    state.hover_at(
                        event.position,
                        secondary_modifier().is_subset_of(&event.modifiers),
                        cx,
                    )
                });
                return;
            }
            if event.pressed_button != Some(MouseButton::Left) {
                return;
            }
            entity.update(cx, |state, cx| {
                if state.block_drag_to(event.position, cx) {
                    return;
                }
                if state.dragging {
                    state.mouse_at(event.position, true, cx);
                }
            });
        });
        let entity = self.state.clone();
        window.on_mouse_event(move |_: &MouseUpEvent, phase, _, cx| {
            if phase == DispatchPhase::Bubble {
                entity.update(cx, |state, cx| {
                    state.dragging = false;
                    state.finish_block_drag(cx);
                });
            }
        });
    }
}

/// Pointer reach around a table where its corner handle shows.
const TABLE_HOVER_REACH: f32 = 28.;

fn state_plain(state: &Entity<BlockEditorState>, block: BlockId, cx: &App) -> bool {
    state.read(cx).model.doc.plain(block).is_some()
}
