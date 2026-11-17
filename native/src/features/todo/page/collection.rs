//! Read projections and explicit row writes stay separate from editor admission.
use super::*;

impl TodoPage {
    pub fn reload(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.initialized {
            return;
        }
        self.read_generation += 1;
        let generation = self.read_generation;
        let view = self.view;
        let (category, priority) = self.filters.read(cx).value(cx);
        let query = self.search.read(cx).value().to_string();
        self.loading = true;
        let task = self.client.projection(view, query, category, priority);
        cx.spawn_in(window, async move |this, cx| {
            let result = match task {
                Ok(task) => task.await,
                Err(error) => Err(error),
            };
            let _ = this.update_in(cx, |this, window, cx| {
                if generation != this.read_generation {
                    return;
                }
                this.loading = false;
                match result {
                    Ok(projection) => {
                        this.counts = projection.todos.counts;
                        this.categories = projection.todos.categories;
                        this.update_input_labels(window, cx);
                        let records = projection.todos.records;
                        this.read_error = None;
                        this.rows.update(cx, |list, cx| {
                            let selected = list.delegate().selected_id.clone();
                            let previous_row = list
                                .selected_index()
                                .and_then(|ix| list.delegate().selected_offset(ix));
                            list.delegate_mut().clear_thumbnails(cx);
                            list.delegate_mut().summaries = projection.notes;
                            list.delegate_mut().records = records;
                            list.delegate_mut().regroup(view);
                            let ix = selected
                                .and_then(|id| {
                                    list.delegate()
                                        .records
                                        .iter()
                                        .position(|record| record.item().id == id)
                                })
                                .or_else(|| {
                                    previous_row
                                        .filter(|_| !list.delegate().records.is_empty())
                                        .map(|row| row.min(list.delegate().records.len() - 1))
                                })
                                .and_then(|offset| list.delegate().index_of(offset));
                            list.set_selected_index(ix, window, cx);
                            cx.notify();
                        });
                    }
                    Err(error) => this.read_error = Some(error),
                }
                if this.focus_after_read {
                    this.focus_after_read = false;
                    this.focus_collection(window, cx);
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    pub(super) fn focus_collection(&self, window: &mut Window, cx: &mut Context<Self>) {
        if self.rows.read(cx).delegate().records.is_empty() {
            self.new_focus.focus(window, cx);
        } else {
            self.rows.update(cx, |list, cx| list.focus(window, cx));
        }
    }

    pub(super) fn change_completed(
        &mut self,
        record: TodoRecord,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.busy || self.session.draft.as_ref().is_some_and(Draft::is_dirty) {
            return;
        }
        self.set_busy(true, cx);
        self.write_error = None;
        let id = record.item().id.clone();
        let task = self.client.set_completed(
            id.clone(),
            !record.item().completed && !record.item().abandoned,
            record.revision(),
        );
        self.finish_row_write(id, task, window, cx);
    }

    pub(super) fn change_abandoned(
        &mut self,
        record: TodoRecord,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.busy || self.session.draft.as_ref().is_some_and(Draft::is_dirty) {
            return;
        }
        self.set_busy(true, cx);
        self.write_error = None;
        let id = record.item().id.clone();
        let task = if record.item().abandoned {
            self.client
                .set_abandoned(id.clone(), false, record.revision())
        } else {
            self.client
                .set_abandoned(id.clone(), true, record.revision())
        };
        self.finish_row_write(id, task, window, cx);
    }

    pub(super) fn finish_row_write<T: Send + 'static>(
        &mut self,
        id: String,
        task: AppResult<super::super::TodoTask<T>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        cx.spawn_in(window, async move |this, cx| {
            let result = match task {
                Ok(task) => task.await,
                Err(error) => Err(error),
            };
            let _ = this.update_in(cx, |this, window, cx| {
                this.set_busy(false, cx);
                this.detail_action = None;
                match result {
                    Ok(_) => {
                        if this
                            .session
                            .draft
                            .as_ref()
                            .and_then(|draft| draft.original.as_ref())
                            .is_some_and(|item| item.id == id)
                        {
                            this.close_task_dialog(window, cx);
                            this.session.draft = None;
                            this.publish(window, cx);
                        }
                        this.reload(window, cx);
                        this.focus_after_read = true;
                    }
                    Err(error) => this.write_error = Some(error),
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
}
