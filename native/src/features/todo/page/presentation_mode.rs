//! Presentation changes move retained entities; no edit snapshot or history is reconstructed.
use super::TodoPage;
use gpui_kit::{Context, Window, component::WindowExt};

pub(super) fn wide(window: &Window) -> bool {
    window.viewport_size().width >= gpui_kit::rems(70.).to_pixels(window.rem_size())
}

impl TodoPage {
    pub(super) fn present_task(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.presentation_wide = wide(window);
        if self.leave_destination.is_some() {
            cx.notify();
            return;
        }
        if self.presentation_wide {
            if self.modal_open {
                let focus = window.focused(cx);
                window.close_dialog(cx);
                self.modal_open = false;
                if let Some(focus) = focus {
                    focus.focus(window, cx);
                }
            }
        } else if self.session.draft.is_some() {
            self.mount_task_dialog(window, cx);
        }
        cx.notify();
    }
}
