mod drafts;
pub(super) mod model;

use std::sync::Arc;

use rmcp::model::{CallToolResult, ContentBlock};
use rmcp::schemars::JsonSchema;
use serde::{de::DeserializeOwned, Serialize};

use super::{
    model::TodoItemInput, note_model::TodoNoteSaveInput, note_service::TodoNoteService,
    TodoRepository,
};
use crate::{
    core::execution::Executor,
    error::{AppError, AppResult, CustomErrorCode},
    modules::mcp::{
        access::{Caller, Permission},
        registry::{content_tool, tool, ModuleLifecycle, ModuleRegistration, RegisteredTool},
    },
};
use model::*;

pub(crate) struct TodoContext {
    repository: TodoRepository,
    executor: Executor,
    drafts: drafts::Drafts,
}

impl ModuleLifecycle for TodoContext {
    fn reopen(&self) -> AppResult<()> {
        self.drafts.reopen()
    }
    fn close_subject(&self, subject: &str) -> AppResult<()> {
        self.close_subject(subject)
    }
    fn shutdown(&self) -> AppResult<()> {
        self.close_all()
    }
    fn busy(&self) -> AppResult<bool> {
        self.busy()
    }
}

impl TodoContext {
    pub(crate) fn new(
        repository: TodoRepository,
        notes: Arc<TodoNoteService>,
        executor: Executor,
    ) -> Arc<Self> {
        Arc::new(Self {
            drafts: drafts::Drafts::new(repository.clone(), notes),
            repository,
            executor,
        })
    }

    pub(crate) fn close_subject(&self, subject: &str) -> AppResult<()> {
        self.drafts.close_subject(subject)
    }

    pub(crate) fn close_all(&self) -> AppResult<()> {
        self.drafts.close_all()
    }

    pub(crate) fn busy(&self) -> AppResult<bool> {
        self.drafts.busy()
    }
}

fn register<I, O>(
    context: &Arc<TodoContext>,
    name: &'static str,
    description: &'static str,
    permission: Permission,
    operation: impl Fn(&TodoContext, Caller, I) -> AppResult<O> + Send + Sync + 'static,
) -> AppResult<RegisteredTool>
where
    I: DeserializeOwned + JsonSchema + Send + 'static,
    O: Serialize + JsonSchema + Send + 'static,
{
    let context = context.clone();
    let operation = Arc::new(operation);
    tool(name, description, permission, move |caller, input| {
        let context = context.clone();
        let operation = operation.clone();
        async move {
            let executor = context.executor.clone();
            executor
                .blocking_unlogged(move || {
                    caller
                        .clone()
                        .execute(|| operation(&context, caller, input))
                })
                .await
        }
    })
}

pub(crate) fn registration(context: Arc<TodoContext>) -> AppResult<ModuleRegistration> {
    let mut tools = vec![
        register(&context, "todo_list", "List todos with stable pagination. Default status is active; timestamps are UTC milliseconds. Notes are omitted; use todo_get for the full document.", Permission::Read,
            |context, _, input: ListInput| context.repository.mcp_list(input))?,
        register(&context, "todo_get", "Read a todo's complete version-2 document, metadata and revision. Read each image separately with todo_note_image_read.", Permission::Read,
            |context, _, input: ItemInput| context.repository.mcp_details(&input.id))?,
        register(&context, "todo_create", "Create a plain-text todo. For image-and-text creation, open a new draft, import images, then save its full document. Never retry creation automatically.", Permission::Write,
            |context, _, mut input: TodoItemInput| { input.completed = false; context.repository.create(input) })?,
        register(&context, "todo_update", "Patch metadata with an expected revision; omitted fields are preserved and null clears nullable fields. Does not overwrite the rich note.", Permission::Write,
            |context, _, input: UpdateInput| context.repository.mcp_update(input))?,
        register(&context, "todo_set_completed", "Set completion explicitly using the current revision. Completing clears abandoned state.", Permission::Write,
            |context, _, input: StateInput| context.repository.mcp_set_state(&input.id, input.revision, input.value, false))?,
        register(&context, "todo_set_abandoned", "Set abandonment explicitly using the current revision. Abandoning clears completed state.", Permission::Write,
            |context, _, input: StateInput| context.repository.mcp_set_state(&input.id, input.revision, input.value, true))?,
        register(&context, "todo_delete", "Delete one todo and its images with the expected revision. Requires separate delete permission. Never retry automatically.", Permission::Delete,
            |context, _, input: RevisionInput| context.repository.mcp_delete(&input.id, input.revision))?,
        register(&context, "todo_note_draft_begin", "Open a new or existing todo draft. Returns its base snapshot and shared limits. Drafts belong to the calling credential, expire, and do not store client-side edits before save.", Permission::Write,
            |context, caller, input: BeginInput| context.drafts.begin(caller.subject(), input.item_id.as_deref()))?,
        register(&context, "todo_note_draft_get", "Read your valid draft's base snapshot and uploaded assets; unsaved client-side document changes are not included.", Permission::Write,
            |context, caller, input: DraftInput| context.drafts.get(caller.subject(), &input.draft_id))?,
        register(&context, "todo_note_image_import", "Import one static PNG/JPEG/WebP into your draft from actual Base64 bytes supplied by the MCP host. MIME must match bytes. Returns an assetId; do not invent Base64 or use a local path.", Permission::Write,
            |context, caller, input: ImportInput| context.drafts.import(caller.subject(), input, || caller.cancelled()))?,
        register(&context, "todo_note_image_copy", "Copy a readable todo image into your draft, returning a new assetId. Does not use the system clipboard.", Permission::Write,
            |context, caller, input: CopyInput| context.drafts.copy(caller.subject(), &input.draft_id, &input.source_item_id, &input.asset_id))?,
        register(&context, "todo_note_image_discard", "Discard an uncommitted uploaded image owned by your draft. Cannot delete committed or other-client images.", Permission::Write,
            |context, caller, input: DiscardInput| context.drafts.discard(caller.subject(), &input.draft_id, &input.asset_id))?,
        register(&context, "todo_note_save", "Atomically save metadata and the complete version-2 document from your draft. Preserve all desired text and image nodes. Rejects concurrent edits; never save truncated content or replay uncertain saves.", Permission::Write,
            |context, caller, input: TodoNoteSaveInput| context.drafts.save(caller.subject(), input))?,
        register(&context, "todo_note_save_status", "Verify an uncertain save using your draftId. A bounded in-memory receipt returns the saved itemId and revision for 15 minutes. Unknown does not prove that nothing was saved; never replay an uncertain write.", Permission::Write,
            |context, caller, input: DraftInput| context.drafts.save_status(caller.subject(), &input.draft_id))?,
        register(&context, "todo_note_draft_close", "Cancel your uncommitted draft and release its images after the real worker exits. Does not delete saved todos.", Permission::Write,
            |context, caller, input: DraftInput| context.drafts.close(caller.subject(), &input.draft_id))?,
    ];
    let image_context = context.clone();
    let mut image = content_tool("todo_note_image_read", "Read one committed image or your draft image as MCP image content. Exactly one itemId or draftId is required; draft reads also require write permission.", Permission::Read,
        move |caller: Caller, input: ImageInput| {
            let context = image_context.clone();
            async move {
                let executor = context.executor.clone();
                executor.blocking_unlogged(move || caller.execute(|| match (input.item_id, input.draft_id) {
                    (Some(item), None) => context.repository.note_image_data(&input.asset_id, Some(&item), None, input.thumbnail),
                    (None, Some(draft)) if caller.allows("todo", Permission::Write) => context.drafts.read(caller.subject(), &draft, &input.asset_id, input.thumbnail),
                    _ => Err(AppError::custom(CustomErrorCode::TodoNoteInvalid)),
                })).await
            }
        }, |output: super::note_model::TodoNoteImageData| {
            let mut result = CallToolResult::success(vec![ContentBlock::image(output.data_base64, output.image.mime_type.clone())]);
            result.structured_content = Some(serde_json::json!({ "image": output.image }));
            Ok(result)
        })?;
    image.description.output_schema = None;
    tools.push(image);
    Ok(ModuleRegistration {
        id: "todo",
        title: "待办事项",
        tools,
        lifecycle: Some(context),
    })
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod event_tests;
