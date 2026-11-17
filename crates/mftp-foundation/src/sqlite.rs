//! SQLite connection setup and private database file creation.

use crate::AppResult;
use rusqlite::Connection;
use std::fs;
use std::path::Path;

pub fn bool_to_int(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

pub fn column_exists(conn: &Connection, table: &str, column: &str) -> AppResult<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns.iter().any(|item| item == column))
}

pub fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> AppResult<()> {
    if !column_exists(conn, table, column)? {
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )?;
    }
    Ok(())
}

#[cfg(unix)]
pub fn restrict_file_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
pub fn restrict_file_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Create the database privately before SQLite can create journals or write data.
pub fn prepare_database(path: &Path) -> AppResult<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.into()),
    }
    restrict_file_permissions(path)?;
    // SQLite derives new sidecar permissions from the database on Unix.
    // Existing journals must be secured before any connection opens them.
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut companion = path.as_os_str().to_os_string();
        companion.push(suffix);
        match restrict_file_permissions(Path::new(&companion)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}
