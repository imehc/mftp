use super::repository::{init, DEFAULT_PORT};
use rusqlite::Connection;

fn database() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    connection
        .execute_batch("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        .unwrap();
    init(&mut connection).unwrap();
    connection
}

fn port(connection: &Connection) -> u16 {
    connection
        .query_row("SELECT port FROM mcp_settings WHERE id=1", [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn fresh_database_uses_new_default_port() {
    assert_eq!(port(&database()), DEFAULT_PORT);
}

#[test]
fn old_default_is_migrated_once_without_removing_credentials() {
    let mut connection = database();
    connection.execute_batch("UPDATE app_meta SET value='1' WHERE key='mcp_schema_version'; UPDATE mcp_settings SET port=1489; INSERT INTO mcp_credentials VALUES('client','test','digest','{}',1)").unwrap();
    init(&mut connection).unwrap();
    assert_eq!(port(&connection), DEFAULT_PORT);
    let count: u32 = connection
        .query_row("SELECT COUNT(*) FROM mcp_credentials", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 1);
    connection
        .execute("UPDATE mcp_settings SET port=1489", [])
        .unwrap();
    init(&mut connection).unwrap();
    assert_eq!(port(&connection), 1489);
}

#[test]
fn custom_port_is_preserved_during_migration() {
    let mut connection = database();
    connection.execute_batch("UPDATE app_meta SET value='1' WHERE key='mcp_schema_version'; UPDATE mcp_settings SET port=6022").unwrap();
    init(&mut connection).unwrap();
    assert_eq!(port(&connection), 6022);
}
