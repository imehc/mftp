use super::*;
use rusqlite::Connection;

fn initialized() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    init(&mut conn).unwrap();
    conn
}

#[test]
fn init_is_idempotent_and_drops_legacy_history_table() {
    let mut conn = initialized();
    init(&mut conn).unwrap();
    conn.execute(
        "INSERT INTO lan_transfer_settings(id,device_name,port,download_dir,auto_start,security_mode,default_permission)
         VALUES(1,'dev',3000,'/dl',0,'open','readWrite')",
        [],
    )
    .unwrap();
    let (bind_host, max_concurrent): (String, i64) = conn
        .query_row(
            "SELECT bind_host, max_concurrent_transfers FROM lan_transfer_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(bind_host, "");
    assert_eq!(max_concurrent, 3);
    conn.execute_batch("INSERT INTO lan_shared_dirs(id,name,path,created_at) VALUES('d','n','/p',1);
                        INSERT INTO lan_trusted_devices(id,label,ip,created_at) VALUES('t','l','10.0.0.2',1);")
        .unwrap();
    assert!(conn
        .query_row("SELECT COUNT(*) FROM lan_transfer_history", [], |row| row
            .get::<_, i64>(
            0
        ))
        .is_err());
}

#[test]
fn init_adds_columns_to_legacy_settings_shape() {
    let mut conn = Connection::open_in_memory().unwrap();
    // Shape from the first released builds: no bind_host / concurrency column.
    conn.execute_batch(
        "CREATE TABLE lan_transfer_settings (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            device_name TEXT NOT NULL,
            port INTEGER NOT NULL,
            download_dir TEXT NOT NULL,
            auto_start INTEGER NOT NULL,
            security_mode TEXT NOT NULL,
            default_permission TEXT NOT NULL
         );
         INSERT INTO lan_transfer_settings VALUES(1,'old',3000,'/dl',1,'code','readOnly');",
    )
    .unwrap();
    init(&mut conn).unwrap();
    let (bind_host, max_concurrent): (String, i64) = conn
        .query_row(
            "SELECT bind_host, max_concurrent_transfers FROM lan_transfer_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(bind_host, "");
    assert_eq!(max_concurrent, 3);
}

#[test]
fn reset_clears_rows_inside_the_caller_transaction_only() {
    let mut conn = initialized();
    conn.execute_batch(
        "INSERT INTO lan_transfer_settings(id,device_name,port,bind_host,download_dir,auto_start,security_mode,default_permission,max_concurrent_transfers)
             VALUES(1,'dev',3000,'','/dl',0,'open','readWrite',3);
         INSERT INTO lan_shared_dirs(id,name,path,created_at) VALUES('d1','n1','/p1',1),('d2','n2','/p2',2);
         INSERT INTO lan_trusted_devices(id,label,ip,created_at) VALUES('t','l','10.0.0.2',1);",
    )
    .unwrap();
    {
        let tx = conn.transaction().unwrap();
        assert_eq!(reset(&tx).unwrap(), 4);
        tx.rollback().unwrap();
    }
    let remaining: i64 = conn
        .query_row("SELECT (SELECT COUNT(*) FROM lan_transfer_settings) + (SELECT COUNT(*) FROM lan_shared_dirs) + (SELECT COUNT(*) FROM lan_trusted_devices)", [], |row| row.get(0))
        .unwrap();
    assert_eq!(remaining, 4);
    {
        let tx = conn.transaction().unwrap();
        assert_eq!(reset(&tx).unwrap(), 4);
        tx.commit().unwrap();
    }
    {
        let tx = conn.transaction().unwrap();
        assert_eq!(reset(&tx).unwrap(), 0);
        tx.commit().unwrap();
    }
}
