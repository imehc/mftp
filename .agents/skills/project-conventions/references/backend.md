# 后端规范 (Rust / src-tauri)

## 600 行拆分模式

超过 600 行时，把一个大 `.rs` 拆成一个**模块目录**，按功能块分文件。本项目已有范例：`src-tauri/src/ssh/` 目录把 SSH/SFTP 能力拆成 `auth.rs / upload.rs / download_*.rs / remote_ops.rs / transfer_*.rs / types.rs` 等；`src-tauri/src/commands/` 把 command 层按领域拆成 `hosts.rs / keys.rs / sftp.rs / ssh.rs / lan_transfer.rs`。

拆分步骤：

1. 建目录 `foo/`，把原 `foo.rs` 拆成 `foo/mod.rs`（或保留 `foo.rs` 作为模块入口）+ 若干子文件。
2. 按职责切：类型定义 → `types.rs`／`models.rs`；纯逻辑按功能分块；`#[tauri::command]` 入口层单独放 `commands/`。
3. 模块入口只做 `mod x; pub use x::*;` 与协调，不堆业务逻辑。
4. `main.rs` 保持极薄，逻辑在 `lib.rs`；所有 command 记得注册进 `generate_handler![]`。

**优先重构对象**：`src-tauri/src/lan_transfer.rs`（当前 1414 行）应拆为如 `lan_transfer/{mod,discovery,protocol,session,transfer,models}.rs`。`storage.rs`（712 行）可按表/领域拆分。

## 分层与边界

- **command 层**（`commands/`）：只做参数解析、调用业务层、映射错误。薄。
- **业务/领域层**（`ssh/`、`lan_transfer/`、`storage`）：核心逻辑。
- **模型层**（`models.rs`、各 `*_models.rs`、`types.rs`）：可序列化的 DTO 与内部类型。
- **错误层**（`error.rs`）：统一错误类型，跨 IPC 边界返回前端可读信息。

重逻辑（文件系统、网络、加密、密钥、SSH/SFTP、LAN 协议）一律在后端；前端只接收结果。

## 性能

- 不要在 async 上下文里做阻塞 IO/CPU 密集操作；用 `tokio::task::spawn_blocking` 或独立线程。
- 大文件/流式传输用 Tauri **channel / event** 分块推进度，别一次性 `invoke` 返回巨量数据或前端轮询。
- 锁的粒度尽量小，持锁时间短；跨 `.await` 持有 `std::sync` 锁会出问题，用 `tokio::sync` 或缩小作用域。
- 会话、连接、临时文件、监听器要有明确的创建/清理生命周期（参考已有的 `temp_cleanup.rs`、`transfer_control.rs`）。

## IPC 契约与类型同步

- 前后端类型是硬契约。当前 `models.rs` ↔ 前端 `src/types.ts` 手动同步，改一边必须同一次改动改另一边。
- 目标方案 **specta + tauri-specta**：从 Rust 命令/类型自动生成 TS 绑定，单一事实来源；落地需装依赖、动 `lib.rs`，作为独立任务推进。
- `#[tauri::command]` 命名统一 `动词_名词`；参数/返回值用具名可序列化类型，不用裸 tuple/魔法字段。
- 事件名集中为常量/枚举，勿散字符串。

## 错误处理纪律

- 生产路径**禁止** `.unwrap()` / `panic!` / `.expect()`（仅测试、或逻辑上绝不可能失败且已注释处例外）。一律 `Result<T, AppError>` + `?`，经 `error.rs` 统一。
- 错误带诊断上下文（主机/路径/操作），但不落密钥、口令、token 明文。

## 测试

- 核心逻辑（LAN 协议、SFTP 路径处理、storage 迁移/读写）写 `#[cfg(test)]` 单元测试，`cargo test` 跑。
- 纯逻辑与 Tauri 运行时解耦，便于脱离 app 测试。修 bug 先写复现测试。
- 提交前：`cargo fmt` + `cargo clippy`（警告尽量清零）+ `cargo test`。

## 数据与持久化 (SQLite)

- schema 变更版本化 + 向前迁移（参考 `migrate_legacy_json`），迁移幂等、不破坏旧数据，并注释「从哪版到哪版、为什么」。
- SQL 一律参数化查询，杜绝拼接注入。

## 安全与移动端

- 路径遍历校验、输入校验；最小权限原则配置 `capabilities/`。
- 密钥/口令不落明文日志。
- 移动/桌面差异用 `#[cfg(mobile)]` / `#[cfg(desktop)]` 分支，桌面专属能力（如系统托盘、多窗口）不要无条件编译进移动端。

## 注释

在协议握手、并发/锁策略、`cfg` 分支、序列化边界、绕坑写法处写「为什么」注释。参见 SKILL.md 的注释规范。
