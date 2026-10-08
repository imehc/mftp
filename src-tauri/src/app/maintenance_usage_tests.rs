use super::*;
use crate::models::AppDataModule;
use crate::modules::maintenance::data::{app_data_clear, app_data_usage};

#[tokio::test]
async fn usage_respects_maintenance_admission_and_recovers_after_release() {
    let fixture = Fixture::new();
    let maintenance = fixture.state().executor.maintenance().await.unwrap();
    assert_eq!(
        app_data_usage(fixture.state()).await.unwrap_err().code,
        "app:maintenance_in_progress"
    );
    drop(maintenance);
    assert!(
        app_data_usage(fixture.state())
            .await
            .unwrap()
            .main_database_bytes
            > 0
    );
}

#[tokio::test]
async fn clear_runs_usage_inside_its_existing_maintenance_gate() {
    let fixture = Fixture::new();
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        app_data_clear(fixture.state(), AppDataModule::Todo),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(result.bytes_freed, Some(0));
    assert!(result.usage_error.is_none());
    assert!(app_data_usage(fixture.state()).await.is_ok());
}

#[tokio::test]
async fn usage_failure_does_not_turn_completed_deletion_into_a_command_error() {
    let fixture = Fixture::new();
    let conn = fixture.storage.conn().unwrap();
    conn.execute_batch("INSERT INTO todo_items(id,title,completed,created_at,updated_at) VALUES('todo','Task',0,1,1); DROP TABLE vault_entries;").unwrap();
    assert!(app_data_usage(fixture.state()).await.is_err());
    let result = app_data_clear(fixture.state(), AppDataModule::Todo)
        .await
        .unwrap();
    assert_eq!(result.records_deleted, 1);
    assert!(result.bytes_freed.is_none());
    assert_eq!(result.usage_error.unwrap().code, "db:sqlite");
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM todo_items", [], |row| row
            .get::<_, u32>(0))
            .unwrap(),
        0
    );
}
