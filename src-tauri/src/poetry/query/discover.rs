//! Deterministic discover feed: the daily pick and a seeded random pick.

use rusqlite::{params, OptionalExtension};

use crate::error::AppResult;
use crate::poetry::model::PoemDetail;

use super::PoetryDb;

impl PoetryDb {
    // ---- discover ----

    /// Deterministic daily pick: same date ⇒ same poem while the installed
    /// set does not change.
    pub fn discover_daily(&self) -> AppResult<Option<PoemDetail>> {
        let days = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs() / 86_400)
            .unwrap_or(0);
        self.discover_pick(&format!("day:{days}"))
    }

    pub fn discover_random(&self, seed: &str) -> AppResult<Option<PoemDetail>> {
        self.discover_pick(seed)
    }

    fn discover_pick(&self, seed: &str) -> AppResult<Option<PoemDetail>> {
        let conn = self.open()?;
        let total: i64 = conn.query_row("SELECT COUNT(*) FROM poems", [], |r| r.get(0))?;
        if total == 0 {
            return Ok(None);
        }
        let digest = seed_offset(seed);
        let uid: Option<String> = conn
            .query_row(
                "SELECT uid FROM poems ORDER BY uid LIMIT 1 OFFSET ?",
                params![digest % total],
                |row| row.get(0),
            )
            .optional()?;
        drop(conn);
        match uid {
            Some(uid) => Ok(Some(self.poem_detail(&uid)?)),
            None => Ok(None),
        }
    }
}

fn seed_offset(seed: &str) -> i64 {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(seed.as_bytes());
    let mut value: u64 = 0;
    for byte in digest.iter().take(8) {
        value = (value << 8) | u64::from(*byte);
    }
    (value % i64::MAX as u64) as i64
}
