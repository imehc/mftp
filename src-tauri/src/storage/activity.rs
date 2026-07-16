use crate::error::AppResult;
use crate::models::ActivityLog;
use rusqlite::params;

use super::{now_ms, Storage};

impl Storage {
    pub fn record_activity_log(
        &self,
        source: &str,
        ip: &str,
        action: &str,
        result: &str,
        detail: Option<&str>,
    ) -> AppResult<()> {
        let conn = self.conn()?;
        conn.execute(
            r#"
            INSERT INTO lan_access_logs(
                id, created_at, source, ip, request_type, result, detail
            ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                uuid::Uuid::new_v4().to_string(),
                now_ms(),
                source,
                ip,
                action,
                result,
                detail,
            ],
        )?;
        Ok(())
    }

    pub fn list_activity_logs(&self, limit: u32) -> AppResult<Vec<ActivityLog>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, created_at, source, ip, request_type, result, detail
            FROM lan_access_logs
            ORDER BY created_at DESC
            LIMIT ?1
            "#,
        )?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(ActivityLog {
                    id: row.get(0)?,
                    created_at: row.get(1)?,
                    source: row.get(2)?,
                    ip: row.get(3)?,
                    request_type: row.get(4)?,
                    result: row.get(5)?,
                    detail: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn clear_activity_logs(&self) -> AppResult<()> {
        self.conn()?.execute("DELETE FROM lan_access_logs", [])?;
        Ok(())
    }

    pub fn delete_activity_log(&self, id: &str) -> AppResult<()> {
        self.conn()?
            .execute("DELETE FROM lan_access_logs WHERE id = ?1", params![id])?;
        Ok(())
    }
}
