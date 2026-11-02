//! Single outlet for SFTP transfer progress events. The frontend transfer
//! panel listens through TRANSFER_PROGRESS in src/lib/events.ts.

/// Wire name kept from history (predates the scheme:// convention); both
/// sides derive from this constant — never change it unilaterally.
pub const TRANSFER_PROGRESS_EVENT: &str = "sftp-transfer-progress";

/// The external-service activity panel gained a revision. Payload: the new
/// cursor. Frontend listens to this instead of polling; it re-reads the
/// snapshot through `diagnostics_snapshot` (the event carries no record data).
pub const ACTIVITY_PANEL_EVENT: &str = "diagnostics://activity";
