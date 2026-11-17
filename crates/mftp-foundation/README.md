# mftp-foundation

共用 `AppError { kind, code, message, args }`、静态诊断码、Unix 毫秒时间和 SQLite 文件/迁移工具。展示与翻译由调用应用负责。

默认只依赖 Serde。`sqlite`、`json`、`ssh`、`http`、`walkdir`、`tauri` 分别启用对应错误转换与工具；`specta` 启用 IPC 类型派生。各应用只启用需要的 features。

从仓库根目录运行 `cargo check -p mftp-foundation --locked`。跨应用保持错误 wire shape 和诊断码兼容。
