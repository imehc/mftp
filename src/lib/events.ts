/**
 * 与 Rust 后端共享的事件名。
 *
 * 这些字符串是一种契约：每一个都必须与 Rust 侧传给 `app.emit(...)` 的
 * 字面量完全一致。集中放在这里，重命名时会在每个监听处暴露为类型错误，
 * 而不是静默失效。
 *
 * 命名因历史原因并不统一 —— `sftp-transfer-progress` 早于后续模块采用的
 * `scheme://` 约定。事件值完全保持后端发出的原样；这里只集中管理引用。
 */

/**
 * SFTP 与 BT 任务共用的传输进度（共享的后端通道位于
 * `src-tauri/src/transfer.rs`）。载荷类型：`TransferProgress`。
 *
 * 线上的事件值早于 `scheme://` 约定；重命名它需要前后端协调改动，
 * 却没有任何功能收益。
 */
export const TRANSFER_PROGRESS = "sftp-transfer-progress";

/** 由 `src-tauri/src/lib.rs` 发出，对应游戏房间的生命周期。 */
export const GAME_ROOM_PEER = "game-room://peer";
export const GAME_ROOM_MESSAGE = "game-room://message";
export const GAME_ROOM_CLOSED = "game-room://closed";

/**
 * SSH 终端事件按会话区分，因此事件名中带有会话 id。
 * 由 `src-tauri/src/ssh/shell_worker.rs` 以相同结构生成。
 */
export const sshDataEvent = (sessionId: string) => `ssh://data/${sessionId}`;
export const sshClosedEvent = (sessionId: string) =>
  `ssh://closed/${sessionId}`;

/** 诗词库的同步 / 导入 / 索引进度。载荷类型：`PoetrySyncProgress`。 */
export const LIBRARY_SYNC_PROGRESS = "library://sync-progress";

/** BT 任务级事件（存到本地完成 / 失败）。载荷类型：`BtTaskEvent`。 */
export const BT_TASK_EVENT = "bt://task-event";
