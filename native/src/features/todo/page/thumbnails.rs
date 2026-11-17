//! Visible rows admit thumbnail reads; the list owns a bounded image cache.
use super::{TodoPage, rows::TodoRows};
use gpui_kit::{App, Context, Image, Window};
use std::{collections::HashMap, sync::Arc};

pub(super) enum Thumbnail {
    Pending,
    Ready(Arc<Image>),
    Missing,
}

pub(super) type Thumbnails = HashMap<(String, String), Thumbnail>;

impl TodoRows {
    pub(super) fn clear_thumbnails(&mut self, cx: &mut App) {
        for (_, entry) in self.thumbnails.drain() {
            if let Thumbnail::Ready(image) = entry {
                image.remove_asset(cx);
            }
        }
    }
}

impl TodoPage {
    pub(super) fn load_row_thumbnail(
        &self,
        item: String,
        asset: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let generation = self.read_generation;
        let task = self.client.row_thumbnail(item.clone(), asset.clone());
        cx.spawn_in(window, async move |this, cx| {
            let result = match task {
                Ok(task) => task.await,
                Err(error) => Err(error),
            };
            let _ = this.update_in(cx, |this, _, cx| {
                if generation != this.read_generation {
                    return;
                }
                this.rows.update(cx, |list, cx| {
                    let rows = list.delegate_mut();
                    if let Some(entry) = rows.thumbnails.get_mut(&(item, asset)) {
                        *entry = result.map_or(Thumbnail::Missing, Thumbnail::Ready);
                        cx.notify();
                    }
                });
            });
        })
        .detach();
    }
}
