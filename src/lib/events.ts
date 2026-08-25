/**
 * Event names shared with the Rust backend.
 *
 * These strings are a contract: each one must match the literal passed to
 * `app.emit(...)` on the Rust side. Keeping them here means a rename shows
 * up as a type error at every listener instead of silently going quiet.
 *
 * Naming is inconsistent by history — `sftp-transfer-progress` predates the
 * `scheme://` convention the later modules adopted. The values are left
 * exactly as the backend emits them; only the references are centralized.
 */

/** SFTP upload/download progress. Payload: `TransferProgress`. */
export const SFTP_TRANSFER_PROGRESS = "sftp-transfer-progress";

/** Emitted by `src-tauri/src/lib.rs` for the game-room lifecycle. */
export const GAME_ROOM_PEER = "game-room://peer";
export const GAME_ROOM_MESSAGE = "game-room://message";
export const GAME_ROOM_CLOSED = "game-room://closed";

/**
 * SSH terminal events are per-session, so the name carries the session id.
 * Built by `src-tauri/src/ssh/shell_worker.rs` with the same shape.
 */
export const sshDataEvent = (sessionId: string) => `ssh://data/${sessionId}`;
export const sshClosedEvent = (sessionId: string) => `ssh://closed/${sessionId}`;

/** Poetry library sync/import/index progress. Payload: `PoetrySyncProgress`. */
export const LIBRARY_SYNC_PROGRESS = "library://sync-progress";
