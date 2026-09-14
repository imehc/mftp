use crate::error::AppResult;
use crate::models::ActivityLog;
use rusqlite::params;
use std::path::Path;

use super::{now_ms, Storage};

impl Storage {
    pub fn record(
        &self,
        source: &str,
        address: &str,
        action: &str,
        detail: Option<&str>,
    ) -> AppResult<()> {
        self.record_result(source, address, action, detail, "success")
    }

    pub fn record_result(
        &self,
        source: &str,
        address: &str,
        action: &str,
        detail: Option<&str>,
        result: &str,
    ) -> AppResult<()> {
        append_activity_log(self.db_path(), source, address, action, result, detail)
    }

    pub fn record_activity_log(
        &self,
        source: &str,
        ip: &str,
        action: &str,
        result: &str,
        detail: Option<&str>,
    ) -> AppResult<()> {
        self.record_result(source, ip, action, detail, result)
    }

    pub fn list_activity_logs(
        &self,
        limit: u32,
        source: Option<&str>,
        result: Option<&str>,
    ) -> AppResult<Vec<ActivityLog>> {
        let conn = self.conn()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT id, created_at, source, ip, request_type, result, detail
            FROM lan_access_logs
            WHERE (?2 IS NULL OR source = ?2)
              AND (?3 IS NULL OR result = ?3)
            ORDER BY created_at DESC
            LIMIT ?1
            "#,
        )?;
        let rows = stmt
            .query_map(params![limit, source, result], |row| {
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

    pub fn clear_activity_logs(&self, source: Option<&str>) -> AppResult<u32> {
        let changed = self.conn()?.execute(
            "DELETE FROM lan_access_logs WHERE ?1 IS NULL OR source = ?1",
            params![source],
        )?;
        Ok(changed as u32)
    }

    pub fn delete_activity_log(&self, id: &str) -> AppResult<()> {
        self.conn()?
            .execute("DELETE FROM lan_access_logs WHERE id = ?1", params![id])?;
        Ok(())
    }
}

pub(crate) fn append_activity_log(
    db_path: &Path,
    source: &str,
    address: &str,
    action: &str,
    result: &str,
    detail: Option<&str>,
) -> AppResult<()> {
    let conn = rusqlite::Connection::open(db_path)?;
    conn.execute(
        "INSERT INTO lan_access_logs(id,created_at,source,ip,request_type,result,detail) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![uuid::Uuid::new_v4().to_string(), now_ms(), source, address, action, result, detail],
    )?;
    Ok(())
}
