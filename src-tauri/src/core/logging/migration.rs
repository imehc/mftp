use super::{Event, LogService, Payload};
use crate::{
    error::{AppError, AppResult},
    models::ActivityLog,
};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
};

impl LogService {
    pub(crate) fn import_legacy(&self, records: &[ActivityLog]) -> AppResult<()> {
        self.flush()?;
        let mut digest = Sha256::new();
        for record in records {
            digest.update(record.id.as_bytes());
        }
        let digest = digest.finalize();
        let mut identity = [0; 16];
        identity.copy_from_slice(&digest[..16]);
        let id = uuid::Uuid::from_bytes(identity).to_string();
        let target = self
            .directory()
            .join(format!("mftp-migrated-{id}-000001.jsonl"));
        if target.try_exists()? {
            let reader = BufReader::new(File::open(&target)?);
            let mut count = 0;
            for line in reader.lines() {
                let event: Event = serde_json::from_str(&line?)?;
                let Payload::Operation { record } = event.payload else {
                    return Err(AppError::external(
                        "logs:migration",
                        "Unexpected legacy log event",
                    ));
                };
                if records
                    .get(count)
                    .is_none_or(|expected| expected.id != record.id)
                {
                    return Err(AppError::external(
                        "logs:migration",
                        "Legacy log identity mismatch",
                    ));
                }
                count += 1;
            }
            if count != records.len() {
                return Err(AppError::external(
                    "logs:migration",
                    "Incomplete legacy log segment",
                ));
            }
            return Ok(());
        }
        let pending = target.with_extension("pending");
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&pending)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        let redactor = crate::core::diagnostics::Redactor::default();
        for (sequence, record) in records.iter().enumerate() {
            let mut record = record.clone();
            record.ip = redactor.text(&record.ip).0;
            record.detail = record.detail.map(|text| redactor.text(&text).0);
            record.error = record.error.map(|error| redactor.error(error));
            let event = Event {
                schema_version: 1,
                event_id: record.id.clone(),
                run_id: id.clone(),
                sequence: sequence.to_string(),
                timestamp: record.created_at,
                generation: 0,
                payload: Payload::Operation { record },
            };
            serde_json::to_writer(&mut file, &event)?;
            file.write_all(b"\n")?;
        }
        file.sync_all()?;
        fs::rename(pending, target)?;
        #[cfg(unix)]
        File::open(self.directory())?.sync_all()?;
        Ok(())
    }
}
