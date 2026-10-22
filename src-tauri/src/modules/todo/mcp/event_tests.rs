use std::{collections::BTreeMap, sync::Arc};

use parking_lot::Mutex;
use serde_json::{json, Value};

use super::{TodoContext, TodoNoteService};
use crate::{
    core::{
        activity::{ActivitySink, OperationContext},
        execution::Executor,
        operations::Operations,
    },
    error::{AppError, AppResult},
    modules::{
        mcp::{
            access::{Caller, ModuleGrant},
            registry::{ModuleLifecycle, Registry},
        },
        todo::TodoRepository,
    },
};

struct NoLog;

impl ActivitySink for NoLog {
    fn record(&self, _: &OperationContext, _: Option<&AppError>) -> AppResult<()> {
        Ok(())
    }
}

async fn call(registry: &Registry, name: &str, input: Value) -> Value {
    let caller = Caller::new(
        "event-test".into(),
        BTreeMap::from([(
            "*".into(),
            ModuleGrant {
                read: true,
                write: true,
                delete: true,
            },
        )]),
    );
    let result = registry.call(caller, name, input).await.unwrap();
    assert_eq!(result.is_error, Some(false), "{result:?}");
    result.structured_content.unwrap()
}

#[tokio::test]
async fn mcp_commits_notify_observers_after_commit_and_rejected_writes_do_not_notify() {
    tokio::task::spawn_blocking(|| {
        let _serial = crate::modules::todo::note_tests::TEST_LOCK.lock();
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            let fixture = crate::modules::todo::note_tests::Fixture::new();
            let observed = Arc::new(Mutex::new(Vec::new()));
            let storage = fixture.storage.clone();
            let snapshots = observed.clone();
            let repository = TodoRepository::with_listener(storage.clone(), Arc::new(move |event| {
                let row = storage.conn().unwrap().query_row(
                    "SELECT title, revision, completed, abandoned FROM todo_items WHERE id=?1",
                    [&event.item_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, bool>(2)?, row.get::<_, bool>(3)?)),
                ).ok();
                snapshots.lock().push((event.item_id, row));
            }));
            let context = TodoContext::new(
                repository.clone(),
                Arc::new(TodoNoteService::new(repository)),
                Executor::new(Arc::new(NoLog), Arc::new(Operations::default())),
            );
            let registry = crate::app::registry::mcp::build(context.clone()).unwrap();
            let created = call(&registry, "todo_create", json!({"title":"created","completed":false})).await;
            let id = created["id"].as_str().unwrap();
            assert_eq!(observed.lock().len(), 1);
            assert_eq!(observed.lock()[0].1.as_ref().unwrap().0, "created");
            let revision = call(&registry, "todo_get", json!({"id":id})).await["revision"].as_i64().unwrap();
            call(&registry, "todo_update", json!({"id":id,"revision":revision,"title":"updated"})).await;
            assert_eq!(observed.lock().len(), 2);
            assert_eq!(observed.lock()[1].1.as_ref().unwrap().0, "updated");
            let caller = Caller::new("event-test".into(), BTreeMap::from([("*".into(), ModuleGrant { read: true, write: true, delete: true })]));
            let rejected = registry.call(caller, "todo_update", json!({"id":id,"revision":revision,"title":"stale"})).await.unwrap();
            assert_eq!(rejected.is_error, Some(true));
            assert_eq!(observed.lock().len(), 2);
            let revision = call(&registry, "todo_get", json!({"id":id})).await["revision"].as_i64().unwrap();
            call(&registry, "todo_set_completed", json!({"id":id,"revision":revision,"value":true})).await;
            assert!(observed.lock()[2].1.as_ref().unwrap().2);
            let revision = call(&registry, "todo_get", json!({"id":id})).await["revision"].as_i64().unwrap();
            call(&registry, "todo_set_abandoned", json!({"id":id,"revision":revision,"value":true})).await;
            assert!(observed.lock()[3].1.as_ref().unwrap().3);
            let draft = call(&registry, "todo_note_draft_begin", json!({"itemId":id})).await;
            call(&registry, "todo_note_save", json!({"draftId":draft["draft"]["id"],"metadata":{"title":"rich updated","completed":false},"document":{"version":2,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"新的图文内容"}]}]}})).await;
            assert_eq!(observed.lock()[4].1.as_ref().unwrap().0, "rich updated");
            let revision = call(&registry, "todo_get", json!({"id":id})).await["revision"].as_i64().unwrap();
            call(&registry, "todo_delete", json!({"id":id,"revision":revision})).await;
            assert_eq!(observed.lock().len(), 6);
            assert!(observed.lock()[5].1.is_none());
            assert!(observed.lock().iter().all(|(item_id, _)| item_id == id));
            context.shutdown().unwrap();
        });
    }).await.unwrap();
}
