//! Virtual list delegates selection and keyboard navigation to GPUI Kit.

use super::thumbnails::{Thumbnail, Thumbnails};
use super::{Destination, TodoPage};
use crate::i18n::{Locale, text};
use gpui_kit::component::Sizable;
use gpui_kit::{
    App, Context, Role, SharedString, TestSupportExt, WeakEntity, Window,
    component::{
        ActiveTheme, Disableable, IconName, IndexPath,
        button::{Button, ButtonVariants},
        checkbox::Checkbox,
        list::{ListDelegate, ListItem, ListState},
        menu::{DropdownMenu, PopupMenuItem},
    },
    div,
    prelude::*,
};
use mftp_todo::TodoRecord;
use std::collections::HashMap;

pub(super) struct TodoRows {
    pub records: Vec<TodoRecord>,
    pub selected_id: Option<String>,
    pub summaries: HashMap<String, super::super::note_summary::NoteSummary>,
    pub thumbnails: Thumbnails,
    owner: WeakEntity<TodoPage>,
    groups: Vec<(usize, usize, Option<String>)>,
    view: mftp_todo::TodoView,
}

impl TodoRows {
    pub fn new(owner: WeakEntity<TodoPage>) -> Self {
        Self {
            records: Vec::new(),
            selected_id: None,
            summaries: HashMap::new(),
            thumbnails: HashMap::new(),
            owner,
            groups: Vec::new(),
            view: mftp_todo::TodoView::Active,
        }
    }

    pub fn regroup(&mut self, view: mftp_todo::TodoView) {
        self.view = view;
        self.groups.clear();
        for (index, record) in self.records.iter().enumerate() {
            let date = mftp_todo::group_date(record.item(), view);
            if let Some((_, end, previous)) = self.groups.last_mut()
                && *previous == date
            {
                *end = index + 1;
            } else {
                self.groups.push((index, index + 1, date));
            }
        }
    }

    fn offset(&self, index: IndexPath) -> Option<usize> {
        self.groups
            .get(index.section)
            .and_then(|(start, end, _)| (*start + index.row < *end).then_some(*start + index.row))
    }

    pub fn index_of(&self, offset: usize) -> Option<IndexPath> {
        self.groups
            .iter()
            .enumerate()
            .find_map(|(section, (start, end, _))| {
                (*start <= offset && offset < *end)
                    .then_some(IndexPath::new(offset - start).section(section))
            })
    }

    pub fn selected_offset(&self, index: IndexPath) -> Option<usize> {
        self.offset(index)
    }

    pub fn selected(&self) -> Option<TodoRecord> {
        self.selected_id
            .as_ref()
            .and_then(|id| self.records.iter().find(|record| &record.item().id == id))
            .cloned()
    }
}

impl ListDelegate for TodoRows {
    type Item = ListItem;

    fn sections_count(&self, _: &App) -> usize {
        self.groups.len().max(1)
    }
    fn items_count(&self, section: usize, _: &App) -> usize {
        self.groups
            .get(section)
            .map_or(0, |(start, end, _)| end - start)
    }
    fn render_section_header(
        &mut self,
        section: usize,
        _: &mut Window,
        cx: &mut Context<ListState<Self>>,
    ) -> Option<impl IntoElement> {
        let (start, end, date) = self.groups.get(section)?;
        let locale = self
            .owner
            .read_with(cx, |page, _| page.locale())
            .unwrap_or(Locale::English);
        let label = date.clone().unwrap_or_else(|| {
            text(
                if matches!(
                    self.view,
                    mftp_todo::TodoView::Completed | mftp_todo::TodoView::Abandoned
                ) {
                    "todo.untracked"
                } else {
                    "todo.unscheduled"
                },
                locale,
            )
            .into_owned()
        });
        Some(
            div()
                .h_8()
                .px_2()
                .flex()
                .items_center()
                .justify_between()
                .text_color(cx.theme().muted_foreground)
                .child(label)
                .child((end - start).to_string()),
        )
    }

    fn set_selected_index(
        &mut self,
        ix: Option<IndexPath>,
        _: &mut Window,
        _: &mut Context<ListState<Self>>,
    ) {
        self.selected_id = ix
            .and_then(|ix| self.offset(ix))
            .and_then(|offset| self.records.get(offset))
            .map(|record| record.item().id.clone());
    }

    fn confirm(&mut self, _: bool, window: &mut Window, cx: &mut Context<ListState<Self>>) {
        let Some(record) = self.selected() else {
            return;
        };
        let owner = self.owner.clone();
        // The list entity must be released before the owner changes list selection or opens an overlay.
        window.defer(cx, move |window, cx| {
            let _ = owner.update(cx, |page, cx| {
                page.request(Destination::Read(record), window, cx)
            });
        });
    }

    fn render_item(
        &mut self,
        ix: IndexPath,
        window: &mut Window,
        cx: &mut Context<ListState<Self>>,
    ) -> Option<Self::Item> {
        let record = self.records.get(self.offset(ix)?)?.clone();
        let (locale, busy, dirty) = self
            .owner
            .read_with(cx, |page, _| {
                (
                    page.locale(),
                    page.busy,
                    page.session
                        .draft
                        .as_ref()
                        .is_some_and(super::super::session::Draft::is_dirty),
                )
            })
            .unwrap_or((Locale::English, true, false));
        let item = record.item();
        let summary = self.summaries.get(&item.id).cloned().unwrap_or_default();
        let thumbnail = summary.first_image.as_ref().and_then(|asset| {
            let key = (item.id.clone(), asset.clone());
            if !self.thumbnails.contains_key(&key) {
                if self.thumbnails.len() >= 64 {
                    self.clear_thumbnails(cx);
                }
                self.thumbnails.insert(key.clone(), Thumbnail::Pending);
                let owner = self.owner.clone();
                let (item, asset) = key.clone();
                window.defer(cx, move |window, cx| {
                    let _ = owner.update(cx, |page, cx| {
                        page.load_row_thumbnail(item, asset, window, cx)
                    });
                });
            }
            match self.thumbnails.get(&key) {
                Some(Thumbnail::Ready(image)) => Some(image.clone()),
                _ => None,
            }
        });
        let thumbnail_missing = thumbnail.is_none();
        let id = SharedString::from(item.id.clone());
        let completed = item.completed;
        let abandoned = item.abandoned;
        let owner = self.owner.clone();
        let toggle_record = record.clone();
        let menu_owner = self.owner.clone();
        let menu_record = record.clone();
        Some(
            ListItem::new(SharedString::from(format!("todo-row:{id}")))
                .accessibility_label(item.title.clone())
                .h(gpui_kit::rems(3.5))
                .gap_3()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .w_full()
                        .min_w_0()
                        .child(
                            Checkbox::new(SharedString::from(format!("todo-complete:{id}")))
                                .checked(completed)
                                .accessibility_label(
                                    text(
                                        if completed || abandoned {
                                            "todo.restore"
                                        } else {
                                            "todo.complete"
                                        },
                                        locale,
                                    )
                                    .into_owned(),
                                )
                                .disabled(busy || dirty)
                                .on_change(move |_, window, cx| {
                                    cx.stop_propagation();
                                    let owner = owner.clone();
                                    let record = toggle_record.clone();
                                    window.defer(cx, move |window, cx| {
                                        let _ = owner.update(cx, |page, cx| {
                                            page.change_completed(record, window, cx)
                                        });
                                    });
                                }),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .gap_1()
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .child(
                                            div()
                                                .id(SharedString::from(format!("todo-title:{id}")))
                                                .test_support()
                                                .role(Role::Label)
                                                .aria_label(item.title.clone())
                                                .flex_1()
                                                .min_w_0()
                                                .text_ellipsis()
                                                .child(item.title.clone()),
                                        )
                                        .child(super::metadata_tags::render_tags(item, locale)),
                                )
                                .when(
                                    item.notes.as_ref().is_some_and(|notes| !notes.is_empty())
                                        || summary.image_count > 0
                                        || item.due_date.is_some()
                                        || item.due_at.is_some()
                                        || mftp_todo::closure_time(item).is_some(),
                                    |view| {
                                        view.child(
                                            div()
                                                .text_xs()
                                                .text_color(cx.theme().muted_foreground)
                                                .text_ellipsis()
                                                .child(super::presentation::row_summary(
                                                    item,
                                                    locale,
                                                    summary.image_count,
                                                )),
                                        )
                                    },
                                ),
                        )
                        .when(summary.image_count > 0, |view| {
                            view.child(
                                div()
                                    .id(SharedString::from(format!("todo-thumbnail:{id}")))
                                    .test_support()
                                    .role(Role::Label)
                                    .aria_label(super::presentation::image_count_label(
                                        summary.image_count,
                                        locale,
                                    ))
                                    .size_8()
                                    .flex_shrink_0()
                                    .overflow_hidden()
                                    .rounded_md()
                                    .when_some(thumbnail, |view, image| {
                                        view.child(
                                            gpui_kit::img(image)
                                                .size_full()
                                                .object_fit(gpui_kit::ObjectFit::Cover),
                                        )
                                    })
                                    .when(thumbnail_missing, |view| {
                                        view.child(gpui_kit::component::Icon::new(
                                            gpui_kit::assets::IconName::Image,
                                        ))
                                    }),
                            )
                        }),
                )
                .suffix(move |_, _| {
                    let owner = menu_owner.clone();
                    let record = menu_record.clone();
                    Button::new(SharedString::from(format!("todo-more:{id}")))
                        .ghost()
                        .small()
                        .icon(IconName::Ellipsis)
                        .accessibility_label(text("todo.more", locale).into_owned())
                        .disabled(busy)
                        .dropdown_menu(move |menu, _, _| {
                            let edit_owner = owner.clone();
                            let edit_record = record.clone();
                            let abandon_owner = owner.clone();
                            let abandon_record = record.clone();
                            let delete_owner = owner.clone();
                            let delete_record = record.clone();
                            menu.item(
                                PopupMenuItem::new(text("todo.edit", locale).into_owned())
                                    .icon(gpui_kit::assets::IconName::SquarePen)
                                    .on_click(move |_, window, cx| {
                                        let edit_owner = edit_owner.clone();
                                        let record = edit_record.clone();
                                        window.defer(cx, move |window, cx| {
                                            let _ = edit_owner.update(cx, |page, cx| {
                                                page.request(Destination::Edit(record), window, cx)
                                            });
                                        });
                                    }),
                            )
                            .item(
                                PopupMenuItem::new(
                                    text(
                                        if record.item().abandoned {
                                            "todo.restore"
                                        } else {
                                            "todo.abandon"
                                        },
                                        locale,
                                    )
                                    .into_owned(),
                                )
                                .icon(gpui_kit::assets::IconName::Archive)
                                .disabled(dirty)
                                .on_click(move |_, window, cx| {
                                    let owner = abandon_owner.clone();
                                    let record = abandon_record.clone();
                                    window.defer(cx, move |window, cx| {
                                        let _ = owner.update(cx, |page, cx| {
                                            page.change_abandoned(record, window, cx)
                                        });
                                    });
                                }),
                            )
                            .separator()
                            .item(
                                PopupMenuItem::new(text("todo.delete", locale).into_owned())
                                    .icon(gpui_kit::assets::IconName::Trash)
                                    .disabled(dirty)
                                    .on_click(move |_, window, cx| {
                                        let owner = delete_owner.clone();
                                        let record = delete_record.clone();
                                        window.defer(cx, move |window, cx| {
                                            let _ = owner.update(cx, |page, cx| {
                                                page.confirm_delete(record, window, cx)
                                            });
                                        });
                                    }),
                            )
                        })
                }),
        )
    }
}
