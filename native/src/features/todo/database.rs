//! Native-only SQLite initialization and connection policy.

use crate::platform::AppPaths;
use mftp_foundation::{AppResult, sqlite::prepare_database};
use mftp_todo::Database;
use rusqlite::Connection;
use std::{path::PathBuf, time::Duration};

#[derive(Clone)]
pub(crate) struct TodoDatabase {
    path: PathBuf,
}

impl TodoDatabase {
    /// Called only by the native blocking worker, never during UI rendering.
    pub(crate) fn open(paths: &AppPaths) -> AppResult<Self> {
        std::fs::create_dir_all(&paths.data_dir)?;
        let database = Self {
            path: paths.data_dir.join("mftp-native.sqlite3"),
        };
        prepare_database(&database.path)?;
        let mut conn = database.conn()?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        mftp_todo::schema::init(&mut conn)?;
        super::note_store::init(&mut conn)?;
        Ok(database)
    }
}

impl Database for TodoDatabase {
    fn conn(&self) -> AppResult<Connection> {
        let conn = Connection::open(&self.path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        // SQLite's synchronous policy belongs to each connection, unlike WAL mode.
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(Duration::from_secs(5))?;
        Ok(conn)
    }
}
