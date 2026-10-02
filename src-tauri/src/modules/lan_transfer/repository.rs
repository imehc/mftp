use super::{
    LanExportData, LanSharedDir, LanSharedDirInput, LanTransferSettings, LanTrustedDevice,
    LanTrustedDeviceInput,
};
use crate::error::AppResult;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use crate::models::ImportMode;
use crate::storage::{now_ms, Storage};

#[derive(Clone)]
pub(crate) struct LanRepository {
    storage: Storage,
}

impl LanRepository {
    pub(crate) fn new(storage: Storage) -> Self {
        Self { storage }
    }

    pub(crate) fn settings(&self) -> AppResult<LanTransferSettings> {
        let mut conn = self.storage.conn()?;
        // Reading can create defaults or normalize a historical device name.
        // Serialize that read/write pair so it cannot overwrite a concurrent save.
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let stored = tx
            .query_row(
                "SELECT device_name, port, bind_host, download_dir, auto_start,
                    security_mode, default_permission, max_concurrent_transfers
             FROM lan_transfer_settings WHERE id = 1",
                [],
                lan_transfer_settings_from_row,
            )
            .optional()?;
        let settings = match stored {
            Some(mut settings) => {
                // Retain custom names; old automatic names can adopt the pretty name.
                if is_auto_generated_device_name(&settings.device_name) {
                    let resolved_name = default_device_name();
                    if settings.device_name != resolved_name {
                        settings.device_name = resolved_name;
                        settings = persist_settings(&tx, settings)?;
                    }
                }
                settings
            }
            None => persist_settings(&tx, default_lan_transfer_settings())?,
        };
        tx.commit()?;
        Ok(settings)
    }

    pub(crate) fn save_settings(
        &self,
        settings: LanTransferSettings,
    ) -> AppResult<LanTransferSettings> {
        persist_settings(&self.storage.conn()?, settings)
    }

    pub(crate) fn export(&self) -> AppResult<LanExportData> {
        Ok(LanExportData {
            settings: self.settings()?,
            shared_dirs: self.shared_dirs()?,
            trusted_devices: self.trusted_devices()?,
        })
    }

    pub(crate) fn shared_dirs(&self) -> AppResult<Vec<LanSharedDir>> {
        let conn = self.storage.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, path, created_at FROM lan_shared_dirs ORDER BY created_at ASC",
        )?;
        let dirs = stmt
            .query_map([], lan_shared_dir_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(dirs)
    }

    pub(crate) fn add_shared_dir(&self, input: LanSharedDirInput) -> AppResult<LanSharedDir> {
        let dir = LanSharedDir {
            id: uuid::Uuid::new_v4().to_string(),
            name: input.name,
            path: input.path,
            created_at: now_ms(),
        };
        let conn = self.storage.conn()?;
        conn.execute(
            "INSERT INTO lan_shared_dirs(id, name, path, created_at) VALUES(?1, ?2, ?3, ?4)",
            params![dir.id, dir.name, dir.path, dir.created_at],
        )?;
        Ok(dir)
    }

    pub(crate) fn delete_shared_dir(&self, id: &str) -> AppResult<()> {
        let conn = self.storage.conn()?;
        conn.execute("DELETE FROM lan_shared_dirs WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub(crate) fn trusted_devices(&self) -> AppResult<Vec<LanTrustedDevice>> {
        let conn = self.storage.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, label, ip, created_at FROM lan_trusted_devices ORDER BY created_at ASC",
        )?;
        let devices = stmt
            .query_map([], lan_trusted_device_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(devices)
    }

    pub(crate) fn add_trusted_device(
        &self,
        input: LanTrustedDeviceInput,
    ) -> AppResult<LanTrustedDevice> {
        let device = LanTrustedDevice {
            id: uuid::Uuid::new_v4().to_string(),
            label: input.label,
            ip: input.ip,
            created_at: now_ms(),
        };
        let conn = self.storage.conn()?;
        conn.execute(
            "INSERT INTO lan_trusted_devices(id, label, ip, created_at) VALUES(?1, ?2, ?3, ?4)",
            params![device.id, device.label, device.ip, device.created_at],
        )?;
        Ok(device)
    }

    pub(crate) fn delete_trusted_device(&self, id: &str) -> AppResult<()> {
        let conn = self.storage.conn()?;
        conn.execute("DELETE FROM lan_trusted_devices WHERE id = ?1", params![id])?;
        Ok(())
    }
}

// Applies the LAN export section inside the caller's shared import
// transaction; never commits independently.
pub(crate) fn import(
    conn: &Connection,
    data: &LanExportData,
    mode: ImportMode,
) -> AppResult<(u32, u32)> {
    let mut counts = (0u32, 0u32);
    if mode == ImportMode::Overwrite {
        conn.execute("DELETE FROM lan_transfer_settings", [])?;
        conn.execute("DELETE FROM lan_shared_dirs", [])?;
        conn.execute("DELETE FROM lan_trusted_devices", [])?;
        insert_settings(conn, &data.settings)?;
        counts.1 += 1;
    } else if mode == ImportMode::Merge {
        upsert_settings(conn, &data.settings)?;
        counts.1 += 1;
    }
    for dir in &data.shared_dirs {
        let mut dir = dir.clone();
        if mode == ImportMode::Append {
            dir.id = uuid::Uuid::new_v4().to_string();
        }
        if mode == ImportMode::Merge {
            let changed = conn.execute(
                "UPDATE lan_shared_dirs SET name=?2,path=?3 WHERE id=?1",
                params![dir.id, dir.name, dir.path],
            )?;
            if changed > 0 {
                counts.1 += 1;
                continue;
            }
        }
        conn.execute(
            "INSERT INTO lan_shared_dirs(id,name,path,created_at) VALUES(?1,?2,?3,?4)",
            params![dir.id, dir.name, dir.path, dir.created_at],
        )?;
        counts.0 += 1;
    }
    for device in &data.trusted_devices {
        let mut device = device.clone();
        if mode == ImportMode::Append {
            device.id = uuid::Uuid::new_v4().to_string();
        }
        if mode == ImportMode::Merge {
            let changed = conn.execute(
                "UPDATE lan_trusted_devices SET label=?2,ip=?3 WHERE id=?1",
                params![device.id, device.label, device.ip],
            )?;
            if changed > 0 {
                counts.1 += 1;
                continue;
            }
        }
        conn.execute(
            "INSERT INTO lan_trusted_devices(id,label,ip,created_at) VALUES(?1,?2,?3,?4)",
            params![device.id, device.label, device.ip, device.created_at],
        )?;
        counts.0 += 1;
    }
    Ok(counts)
}

fn insert_settings(conn: &Connection, settings: &LanTransferSettings) -> AppResult<()> {
    conn.execute(
        "INSERT INTO lan_transfer_settings(id,device_name,port,bind_host,download_dir,auto_start,security_mode,default_permission,max_concurrent_transfers) VALUES(1,?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            settings.device_name,
            settings.port,
            settings.bind_host,
            settings.download_dir,
            i64::from(settings.auto_start),
            settings.security_mode,
            settings.default_permission,
            settings.max_concurrent_transfers,
        ],
    )?;
    Ok(())
}

fn upsert_settings(conn: &Connection, settings: &LanTransferSettings) -> AppResult<()> {
    conn.execute(
        "INSERT INTO lan_transfer_settings(id,device_name,port,bind_host,download_dir,auto_start,security_mode,default_permission,max_concurrent_transfers) VALUES(1,?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO UPDATE SET device_name=excluded.device_name,port=excluded.port,bind_host=excluded.bind_host,download_dir=excluded.download_dir,auto_start=excluded.auto_start,security_mode=excluded.security_mode,default_permission=excluded.default_permission,max_concurrent_transfers=excluded.max_concurrent_transfers",
        params![
            settings.device_name,
            settings.port,
            settings.bind_host,
            settings.download_dir,
            i64::from(settings.auto_start),
            settings.security_mode,
            settings.default_permission,
            settings.max_concurrent_transfers,
        ],
    )?;
    Ok(())
}

fn persist_settings(
    conn: &Connection,
    mut settings: LanTransferSettings,
) -> AppResult<LanTransferSettings> {
    // Normalize once rather than recursing through settings/save_settings:
    // some platforms can only resolve the same fallback name again.
    if is_auto_generated_device_name(&settings.device_name) {
        settings.device_name = default_device_name();
    }
    conn.execute(
        r#"
            INSERT INTO lan_transfer_settings(
                id, device_name, port, bind_host, download_dir, auto_start,
                security_mode, default_permission, max_concurrent_transfers
            )
            VALUES(1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
                device_name = excluded.device_name,
                port = excluded.port,
                bind_host = excluded.bind_host,
                download_dir = excluded.download_dir,
                auto_start = excluded.auto_start,
                security_mode = excluded.security_mode,
                default_permission = excluded.default_permission,
                max_concurrent_transfers = excluded.max_concurrent_transfers
            "#,
        params![
            settings.device_name,
            settings.port,
            settings.bind_host,
            settings.download_dir,
            i64::from(settings.auto_start),
            settings.security_mode,
            settings.default_permission,
            settings.max_concurrent_transfers,
        ],
    )?;
    Ok(settings)
}

fn lan_transfer_settings_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<LanTransferSettings> {
    let auto_start: i64 = row.get(4)?;
    Ok(LanTransferSettings {
        device_name: row.get(0)?,
        port: row.get(1)?,
        bind_host: row.get(2)?,
        download_dir: row.get(3)?,
        auto_start: auto_start != 0,
        security_mode: row.get(5)?,
        default_permission: row.get(6)?,
        max_concurrent_transfers: row.get(7)?,
    })
}

fn is_auto_generated_device_name(name: &str) -> bool {
    let name = name.trim();
    if name.is_empty() || name == "MFTP" {
        return true;
    }
    let raw = whoami::hostname().unwrap_or_default();
    let raw = raw.trim();
    (!raw.is_empty() && name == raw) || Some(name) == hostname_device_name().as_deref()
}

fn default_device_name() -> String {
    // Prefer the user-facing "pretty" device name (macOS Computer Name such
    // as "xxx's MacBook Pro", Windows friendly name); hostnames like "Mac.lan"
    // are a last resort. Env vars are unreliable in GUI processes.
    let pretty = whoami::devicename().unwrap_or_default();
    let pretty = pretty.trim();
    if !pretty.is_empty() && pretty != "localhost" {
        return pretty.to_string();
    }
    hostname_device_name().unwrap_or_else(|| {
        std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "MFTP".to_string())
    })
}

fn hostname_device_name() -> Option<String> {
    let hostname = whoami::hostname().unwrap_or_default();
    let hostname = hostname
        .trim()
        .trim_end_matches(".local")
        .trim_end_matches(".lan")
        .to_string();
    (!hostname.is_empty() && hostname != "localhost").then_some(hostname)
}

fn default_lan_transfer_settings() -> LanTransferSettings {
    let device_name = default_device_name();
    let download_dir = dirs::download_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir)
        .to_string_lossy()
        .to_string();
    LanTransferSettings {
        device_name,
        port: 3000,
        bind_host: String::new(),
        download_dir,
        auto_start: false,
        security_mode: "code".to_string(),
        default_permission: "readWrite".to_string(),
        max_concurrent_transfers: 3,
    }
}

fn lan_shared_dir_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LanSharedDir> {
    Ok(LanSharedDir {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        created_at: row.get(3)?,
    })
}

fn lan_trusted_device_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LanTrustedDevice> {
    Ok(LanTrustedDevice {
        id: row.get(0)?,
        label: row.get(1)?,
        ip: row.get(2)?,
        created_at: row.get(3)?,
    })
}

#[cfg(test)]
#[path = "repository_tests.rs"]
mod tests;
