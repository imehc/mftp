use super::library_validation::{missing, name};
use super::repository::ModelLibraryRepository;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use specta::Type;

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelAttachment {
    pub id: String,
    pub name: String,
    pub kind: ModelAttachmentKind,
    pub size: u32,
}
#[derive(Debug, Serialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ModelAttachmentKind {
    Text,
    Markdown,
    Pdf,
}

fn error(code: &'static str) -> AppError {
    AppError::external(code, "Model attachment operation failed")
}
fn kind(value: &str) -> AppResult<ModelAttachmentKind> {
    match value {
        "txt" => Ok(ModelAttachmentKind::Text),
        "md" => Ok(ModelAttachmentKind::Markdown),
        "pdf" => Ok(ModelAttachmentKind::Pdf),
        _ => Err(error("model:attachment_invalid")),
    }
}
fn validate(file_name: &str, bytes: &[u8]) -> AppResult<String> {
    let extension = file_name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let format = kind(&extension)?;
    if !name(file_name, 240)
        || file_name.contains(['/', '\\', ':'])
        || bytes.is_empty()
        || bytes.len() > 8 * 1024 * 1024
    {
        return Err(error("model:attachment_invalid"));
    }
    if format == ModelAttachmentKind::Pdf {
        // This is a type check, not a claim that PDF active content has been sanitized.
        // PDFs are never rendered inside the application origin.
        if !bytes.starts_with(b"%PDF-") {
            return Err(error("model:attachment_invalid"));
        }
    } else {
        let text = std::str::from_utf8(bytes).map_err(|_| error("model:attachment_invalid"))?;
        if bytes.len() > 1024 * 1024
            || text
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        {
            return Err(error("model:attachment_invalid"));
        }
    }
    Ok(extension)
}
fn require_model(conn: &Connection, id: &str) -> AppResult<()> {
    conn.query_row(
        "SELECT 1 FROM model_library WHERE id = ?1 AND ready = 1",
        [id],
        |_| Ok(()),
    )
    .optional()?
    .ok_or_else(missing)
}
impl ModelLibraryRepository {
    pub(crate) fn attachments(&self, model: &str) -> AppResult<Vec<ModelAttachment>> {
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction()?;
        require_model(&tx, model)?;
        let rows = tx.prepare("SELECT id, name, kind, LENGTH(bytes) FROM model_attachments WHERE model_id = ?1 ORDER BY name, id")?
            .query_map([model], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, u32>(3)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(id, name, format, size)| {
                Ok(ModelAttachment {
                    id,
                    name,
                    kind: kind(&format)?,
                    size,
                })
            })
            .collect()
    }
    pub(crate) fn add_attachment(
        &self,
        model: &str,
        file_name: &str,
        bytes: &[u8],
    ) -> AppResult<String> {
        let format = validate(file_name, bytes)?;
        let mut conn = self.storage.conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_model(&tx, model)?;
        let (count, size): (u32, i64) = tx.query_row("SELECT COUNT(*), COALESCE(SUM(LENGTH(bytes)), 0) FROM model_attachments WHERE model_id = ?1", [model], |r| Ok((r.get(0)?, r.get(1)?)))?;
        if count >= 16 || size + bytes.len() as i64 > 32 * 1024 * 1024 {
            return Err(error("model:attachment_capacity"));
        }
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM model_attachments WHERE model_id = ?1 AND name = ?2)",
            params![model, file_name],
            |r| r.get(0),
        )?;
        if exists {
            return Err(error("model:attachment_exists"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute("INSERT INTO model_attachments(id, model_id, name, kind, bytes) VALUES(?1, ?2, ?3, ?4, ?5)", params![id, model, file_name, format, bytes])?;
        tx.commit()?;
        Ok(id)
    }
    pub(crate) fn read_attachment(&self, model: &str, id: &str) -> AppResult<Vec<u8>> {
        self.storage.conn()?.query_row("SELECT a.bytes FROM model_attachments a JOIN model_library m ON m.id = a.model_id WHERE a.model_id = ?1 AND a.id = ?2 AND m.ready = 1", params![model, id], |r| r.get(0)).optional()?.ok_or_else(missing)
    }
    pub(crate) fn delete_attachment(&self, model: &str, id: &str) -> AppResult<()> {
        let changed = self.storage.conn()?.execute(
            "DELETE FROM model_attachments WHERE model_id = ?1 AND id = ?2",
            params![model, id],
        )?;
        if changed == 0 {
            return Err(missing());
        }
        Ok(())
    }
}
