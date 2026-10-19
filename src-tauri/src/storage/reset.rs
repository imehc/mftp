use super::Storage;
use crate::error::{AppError, AppResult, CustomErrorCode};
use crate::models::{AppDataResetProgress, AppDataResetStep};
use rusqlite::{Connection, OptionalExtension};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

fn invalid() -> AppError {
    AppError::custom(CustomErrorCode::AppResetStateInvalid)
}

fn read(conn: &Connection) -> AppResult<Option<AppDataResetProgress>> {
    let row: Option<(u32, String)> = conn
        .query_row(
            "SELECT version, payload FROM app_reset_journal WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((version, payload)) = row else {
        return Ok(None);
    };
    if version != 1 {
        return Err(invalid());
    }
    let progress: AppDataResetProgress = serde_json::from_str(&payload).map_err(|_| invalid())?;
    if uuid::Uuid::parse_str(&progress.id).is_err()
        || progress
            .pending
            .iter()
            .enumerate()
            .any(|(i, step)| progress.pending[..i].contains(step))
    {
        return Err(invalid());
    }
    Ok(Some(progress))
}

fn matching(conn: &Connection, id: &str) -> AppResult<AppDataResetProgress> {
    read(conn)?
        .filter(|progress| progress.id == id)
        .ok_or_else(|| AppError::custom(CustomErrorCode::AppResetChanged))
}

impl Storage {
    pub(super) fn init_reset_journal(&self) -> AppResult<()> {
        let conn = self.conn()?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS app_reset_journal (
            id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL, payload TEXT NOT NULL
        );",
        )?;
        // Invalid payloads still block business admission. The status command
        // returns the diagnostic instead of treating corruption as no reset.
        let exists: bool =
            conn.query_row("SELECT EXISTS(SELECT 1 FROM app_reset_journal)", [], |r| {
                r.get(0)
            })?;
        self.reset_pending.store(exists, Ordering::SeqCst);
        Ok(())
    }

    pub(crate) fn reset_gate(&self) -> Arc<AtomicBool> {
        self.reset_pending.clone()
    }

    pub(crate) fn reset_is_pending(&self) -> bool {
        self.reset_pending.load(Ordering::SeqCst)
    }

    pub(crate) fn reset_progress(&self) -> AppResult<Option<AppDataResetProgress>> {
        read(&self.conn()?)
    }

    pub(crate) fn begin_app_reset(&self) -> AppResult<AppDataResetProgress> {
        let mut conn = self.conn()?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if read(&tx)?.is_some() {
            return Err(AppError::custom(CustomErrorCode::AppResetPending));
        }
        let records_deleted = Self::reset_database_in(&tx)?;
        let progress = AppDataResetProgress {
            id: uuid::Uuid::new_v4().to_string(),
            records_deleted,
            pending: vec![
                AppDataResetStep::Poetry,
                AppDataResetStep::Bt,
                AppDataResetStep::Credentials,
                AppDataResetStep::Translation,
            ],
        };
        tx.execute(
            "INSERT INTO app_reset_journal(id,version,payload) VALUES(1,1,?1)",
            [serde_json::to_string(&progress)?],
        )?;
        tx.commit()?;
        // The caller retains exclusive maintenance until this flag is visible.
        self.reset_pending.store(true, Ordering::SeqCst);
        Ok(progress)
    }

    pub(crate) fn require_reset(&self, id: &str) -> AppResult<AppDataResetProgress> {
        matching(&self.conn()?, id)
    }

    pub(crate) fn complete_reset_step(
        &self,
        id: &str,
        step: AppDataResetStep,
    ) -> AppResult<AppDataResetProgress> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        let mut progress = matching(&tx, id)?;
        progress.pending.retain(|pending| *pending != step);
        tx.execute(
            "UPDATE app_reset_journal SET payload = ?1 WHERE id = 1",
            [serde_json::to_string(&progress)?],
        )?;
        tx.commit()?;
        Ok(progress)
    }

    pub(crate) fn finish_app_reset(&self, id: &str) -> AppResult<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction()?;
        if !matching(&tx, id)?.pending.is_empty() {
            return Err(AppError::custom(CustomErrorCode::AppResetIncomplete));
        }
        tx.execute("DELETE FROM app_reset_journal WHERE id = 1", [])?;
        tx.commit()?;
        self.reset_pending.store(false, Ordering::SeqCst);
        Ok(())
    }
}
