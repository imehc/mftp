use rusqlite::{params, TransactionBehavior};

use super::{
    mcp::model::{
        DetailsOutput, Field, ListInput, ListOutput, TodoStatus, UpdateInput, VersionedItem,
    },
    model::{TodoItem, TodoItemInput},
    note_assets::image_info,
    note_model::{TodoNoteDraft, TodoNoteImageInfo},
    note_repository::{details_in, draft_owner},
    repository::{check_expected_revision, normalize_input, row_to_item, SELECT_COLUMNS},
    TodoRepository,
};
use crate::{
    error::{AppError, AppResult, CustomErrorCode},
    storage::now_ms,
};

impl TodoRepository {
    pub(crate) fn mcp_details(&self, id: &str) -> AppResult<DetailsOutput> {
        let mut connection = self.storage.conn()?;
        let transaction = connection.transaction()?;
        let details = details_in(&transaction, id)?;
        let mut images = details
            .document
            .unique_image_ids()
            .into_iter()
            .map(|asset| image_info(&transaction, asset, Some(id), None, false))
            .collect::<AppResult<Vec<_>>>()?;
        images.sort_by(|left, right| left.id.cmp(&right.id));
        transaction.commit()?;
        Ok(DetailsOutput { details, images })
    }

    pub(crate) fn mcp_list(&self, input: ListInput) -> AppResult<ListOutput> {
        let limit = input.limit.unwrap_or(30);
        if !(1..=100).contains(&limit)
            || input.offset > 1_000_000
            || input
                .query
                .as_ref()
                .is_some_and(|value| value.len() > 1_024)
        {
            return Err(AppError::custom(CustomErrorCode::TodoNoteInvalid));
        }
        let status = match input.status.unwrap_or(TodoStatus::Active) {
            TodoStatus::Active => "active",
            TodoStatus::Completed => "completed",
            TodoStatus::Abandoned => "abandoned",
            TodoStatus::All => "all",
        };
        let priority = input.priority.map(|value| value.as_str());
        let connection = self.storage.conn()?;
        let columns = SELECT_COLUMNS.replace(", notes,", ", NULL AS notes,");
        let mut statement = connection.prepare(&format!(
            "SELECT {columns},revision FROM todo_items
             WHERE (?1='all' OR (?1='active' AND completed=0 AND abandoned=0)
                    OR (?1='completed' AND completed=1) OR (?1='abandoned' AND abandoned=1))
               AND (?2 IS NULL OR category=?2) AND (?3 IS NULL OR priority=?3)
               AND (?4 IS NULL OR instr(lower(title),lower(?4))>0
                    OR instr(lower(coalesce(notes,'')),lower(?4))>0)
             ORDER BY created_at DESC,id ASC LIMIT ?5 OFFSET ?6"
        ))?;
        let mut items = statement
            .query_map(
                params![
                    status,
                    input.category,
                    priority,
                    input.query,
                    limit + 1,
                    input.offset
                ],
                |row| {
                    Ok(VersionedItem {
                        item: row_to_item(row)?,
                        revision: row.get(13)?,
                    })
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;
        let next_offset = (items.len() > limit as usize).then_some(input.offset + limit);
        items.truncate(limit as usize);
        Ok(ListOutput { items, next_offset })
    }

    pub(crate) fn mcp_update(&self, input: UpdateInput) -> AppResult<TodoItem> {
        let mut connection = self.storage.conn()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        check_expected_revision(&transaction, &input.id, Some(input.revision))?;
        let current = details_in(&transaction, &input.id)?.item;
        let normalized = normalize_input(TodoItemInput {
            title: match input.title {
                Field::Missing => current.title,
                Field::Value(Some(title)) => title,
                Field::Value(None) => {
                    return Err(AppError::custom(CustomErrorCode::TodoTitleRequired))
                }
            },
            category: input.category.apply(current.category),
            notes: current.notes,
            due_date: input.due_date.apply(current.due_date),
            due_at: input.due_at.apply(current.due_at),
            completed: current.completed,
            priority: input.priority.apply(current.priority),
        })?;
        transaction.execute(
            "UPDATE todo_items SET title=?2,category=?3,due_date=?4,due_at=?5,priority=?6,
             updated_at=?7,revision=revision+1 WHERE id=?1",
            params![
                input.id,
                normalized.title,
                normalized.category,
                normalized.due_date,
                normalized.due_at,
                normalized.priority.map(|value| value.as_str()),
                now_ms()
            ],
        )?;
        let item = details_in(&transaction, &input.id)?.item;
        transaction.commit()?;
        self.notify_changed(&input.id);
        Ok(item)
    }

    pub(crate) fn mcp_set_state(
        &self,
        id: &str,
        revision: i64,
        value: bool,
        abandoned: bool,
    ) -> AppResult<TodoItem> {
        self.set_state(id, value, abandoned, Some(revision))
    }

    pub(crate) fn mcp_delete(&self, id: &str, revision: i64) -> AppResult<()> {
        self.delete_at_revision(id, Some(revision))
    }

    pub(crate) fn mcp_draft_images(&self, draft_id: &str) -> AppResult<Vec<TodoNoteImageInfo>> {
        let mut connection = self.storage.conn()?;
        let transaction = connection.transaction()?;
        let (item_id, _) = draft_owner(&transaction, draft_id)?;
        let mut statement = transaction.prepare(
            "SELECT id FROM todo_note_images WHERE draft_id=?1 OR item_id=?2 ORDER BY id",
        )?;
        let ids = statement
            .query_map(params![draft_id, item_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let images = ids
            .into_iter()
            .map(|id| image_info(&transaction, &id, item_id.as_deref(), Some(draft_id), false))
            .collect::<AppResult<Vec<_>>>()?;
        transaction.commit()?;
        Ok(images)
    }

    pub(crate) fn mcp_draft_snapshot(&self, draft: &TodoNoteDraft) -> AppResult<TodoNoteDraft> {
        self.ensure_note_draft(&draft.id)?;
        Ok(draft.clone())
    }

    pub(crate) fn mcp_discard_image(&self, draft_id: &str, asset_id: &str) -> AppResult<()> {
        let mut connection = self.storage.conn()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        draft_owner(&transaction, draft_id)?;
        let changed = transaction.execute(
            "DELETE FROM todo_note_images WHERE id=?1 AND draft_id=?2",
            params![asset_id, draft_id],
        )?;
        if changed != 1 {
            return Err(AppError::custom(CustomErrorCode::TodoNoteImageMissing));
        }
        transaction.commit()?;
        Ok(())
    }
}
