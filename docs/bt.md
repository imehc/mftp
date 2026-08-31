# BT 下载与在线播放 — 功能说明

状态：**P0–P3 已全部实施完成**。本文档记录设计决策、实现落点与遗留的真机验证项；后续改动（含引擎升级）请先对照本文。

## 实现总览

| 层 | 文件 | 职责 |
|---|---|---|
| 引擎封装 | src-tauri/src/bt/mod.rs | Session 懒启动、probe/add/control/list、进度泵 |
| 元数据解析 | src-tauri/src/bt/probe.rs | infohash 提取、元数据 -> 文件列表 |
| 缓存池 | src-tauri/src/bt/cache.rs | 配额、LRU 整种子淘汰、缓存条目、转存本地 |
| 实时状态 | src-tauri/src/bt/stats.rs | 进度泵 + 单任务速率/节点快照 |
| 流服务 | src-tauri/src/bt/stream_server.rs | loopback HTTP Range 流（token 防护） |
| DTO | src-tauri/src/bt/models.rs | IPC 类型（specta 自动进 bindings.ts） |
| 存储 | src-tauri/src/storage/bt.rs | bt_tasks / bt_cache_access 表、app_meta 配额 |
| 命令 | src-tauri/src/commands/bt.rs | 13 个 bt_* IPC 命令 |
| 共享事件 | src-tauri/src/transfer.rs | TRANSFER_PROGRESS + bt://task-event |
| 页面 | src/features/bt/* | BtTool、添加对话框、文件树、缓存管理、节点浮层 |
| 公共预览 | src/features/preview/* + src/lib/preview-kind.ts | 视频/音频/图片/文本预览页，供各模块复用 |
| 路由入口 | src/routes/tools/bt.tsx + src/routes/preview.tsx + entries.tsx | desktop only |

## 1. 目标

- 支持识别磁力链接与 `.torrent` 文件，先解析元数据展示文件目录树，用户按文件决策。
- 两种消费模式并存：
  - **传统下载**：勾选文件 → 选目标目录 → 完整保存，fastresume 断点续传。
  - **在线预览**：视频/音频/图片单文件流式边下边播，数据落临时缓存目录，配额内 LRU 淘汰。
- 缓存内容可「转存本地」复用，避免重复下载。
- 多路缓冲降低播放延迟：moov/首尾 piece 高优先级、自适应预读窗口、起播门槛。

非目标（本期）：移动端后台下载、转码播放（avi/rmvb 等仅提示可下载）、RSS 订阅。

平台范围：**桌面优先**。移动端编译兼容作为约束保留，但功能入口与验证以桌面为准。

## 2. 技术选型结论（已调研）

| 维度 | librqbit 9.x ✅ | rust-libtorrent ❌ |
|---|---|---|
| 维护 | 活跃（2026-08 仍在发版） | Rust 绑定基本停滞 |
| 构建 | 纯 Rust，cargo add 即用 | C++ 绑定，交叉编译痛苦 |
| 流式播放 | 内置 stream 能力：Range/seek，被读区间自动提升 piece 优先级 | 有 API 需自封装 |
| Tauri 兼容 | 作者自己的桌面端即 Tauri 应用，路径已验证 | 无参考案例 |
| 协议 | DHT、磁力、fastresume、选择性下载、UPnP、限速 | 全 |

关键事实：
- `Session` 为核心类型，`Api` 门面专为序列化给 UI 设计，与本项目 tauri-specta IPC 模式契合。
- 默认（且仅支持）顺序下载——对边下边播有利。
- 依赖 `reqwest ^0.13` 与本项目一致；引入完整 tokio 栈为新增项但无版本冲突。
- 许可证 Apache-2.0。

**集成方式**：librqbit 以库形态进 `src-tauri`，不使用其 CLI/HTTP API 服务对外暴露（其自带 HTTP API 仅作 POC 对照），最终播放走自建 loopback 服务（见 §5.3）。版本锁定 `=9.*`（该 crate 大版本间 API 变化频繁：6→7→8→9 均有破坏性变更），升级需单独评估。

## 3. 核心设计决策

### 3.1 单 Session 双模式

一个 librqbit `Session` 承载所有任务，按任务指定输出目录（`AddTorrentOptions.output_folder`）：

```
添加磁力/torrent
   │ bt_probe 解析元数据（list-only，零落盘）
   ▼
文件目录树（名称 / 大小 / 类型 / 可播标记）
   │
   ├─ 勾选 + 「下载」 ──> output = 用户目录，完整保存
   └─ 单文件「预览」 ──> output = cache 目录，流式播放
```

### 3.2 缓存与 LRU

- 缓存目录：应用缓存区下独立子目录（如 `{app_cache}/bt/{infohash}/`），每个种子一个子目录。
- **淘汰粒度为整个种子**：piece 跨文件交错校验，删除半截文件会破坏校验与续传，严禁按文件/片段删。淘汰流程：确认无活跃引用 → `session.delete(id)` 连数据移除 → 删除子目录。
- 活跃引用（永不淘汰）：正在播放的任务、已 pin 的任务（见 §3.4）、元数据获取中的任务。
- 时间戳持久化：复用现有 rusqlite storage 层加表 `bt_cache_access(infohash TEXT PRIMARY KEY, last_access INTEGER)`，每次播放/预览刷新；比扫 mtime 可靠。
- 配额默认 5GB，设置页可调，支持手动一键清空。

### 3.3 播放源解析优先级（避免重复下载）

```
点击「预览」
  → 传统下载已完成且含该文件？→ 直接播本地文件
  → 缓存中已有该 infohash？→ 续播（刷新 LRU；该文件不在已选集合内则
                             `update_only_files` 把它并进去，否则引擎
                             永远不会下载它，播放会一直卡在 0）
  → 都没有 → 新建缓存任务（只选该文件），moov/首尾 piece 高优先级，
             达到起播门槛后 autoplay
```

删除/淘汰路径上的 `session.delete(...)` 必须 `await`：这是个 future，丢掉不 await 则种子仍活在引擎里，下次添加会被回答 `AlreadyManaged` 并沿用旧的输出目录与旧的文件选择。`remove_task_data`/`evict_if_needed`/`clear_cache` 因此都是 async。

### 3.4 缓存转本地

- 该文件已校验完成 → 直接导出到目标目录，即时完成。
- 未完成 → 任务打上 pinned 标记（豁免 LRU）+ 继续在缓存目录下载，完成后自动导出到目标位置并转为普通下载任务。
- **导出清单来自种子元数据**，不扫目标目录：`handle.with_metadata(…file_infos…)` 拼上 `handle.output_folder()`，按 `file_index`（预览页只导出正在播的那一个文件）或 `handle.only_files()` 过滤，跳过 padding 文件与长度为 0 的占位文件（`FilesystemStorage::init` 会为未勾选文件也建空文件）。下载任务的输出目录里混着用户自己的文件，按目录枚举会把无关文件一起打包。
- 导出形态：单文件按原名直接复制；多文件打成一个 `{任务名}.tar.gz`（与 SFTP 文件夹下载同格式，复用 tar + flate2，不引入压缩依赖）。同名文件追加 ` (n)`，不覆盖用户文件。
- 转本地成功后：预览缓存连数据删除并清除 LRU 记录；**正在播放的条目只解 pin 不删**，否则会把播放器脚下的文件抽走，交给 LRU 回收。下载任务本就在用户目录，导出即普通复制。
- 成功/失败只由 `bt://task-event` 通知一次（即时导出与延迟导出同一条路径），调用方不再自己 toast。

### 3.5 复用现有传输体系

现有传输体系已是引擎无关设计，BT 接入改动很小：

| 资产 | 位置 | 复用方式 |
|---|---|---|
| 进度模型 `TransferProgress` | src-tauri/src/models.rs:92 | 公共层，直接复用 |
| 发射函数 `emit_transfer_progress` | src-tauri/src/ssh/types.rs:17 | 提升到 crate 公共层供 bt 调用 |
| 任务 store `useTransfersStore` | src/store/transfers.ts | 只依赖 id/phase/transferred/total，零改动接入 |
| 传输面板 `TransferPanel` | src/features/transfers/TransferPanel.tsx | 进度条/速度/ETA/暂停/取消/重试全由 store 驱动 |

需要的改造：
- 事件常量 `SFTP_TRANSFER_PROGRESS` 更名 `TRANSFER_PROGRESS`（前后端同一提交内同步改；wire 字符串可保持不变）。
- BT 任务 id 加前缀 `bt:{infohash}` 防冲突。
- `TransferState` 增加可选字段 `source?: "sftp" | "bt"` 与 `mode?: "download" | "preview"`，面板行内显示徽章（SFTP/BT · 下载/在线预览）。
- BT 特有状态用 phase 文案表达（见 §6 文案原则）：`获取资源信息…` `校验中` `做种中`，不改 schema 结构。
- 在线预览的缓存下载也进传输面板（标「在线预览」徽章），避免用户看到流量却无任务的困惑。

语义映射：暂停/继续 → 引擎 pause/unpause；取消 → 删除任务（可选保留文件）；重试 → 重新添加。断点续传由 fastresume 提供，不自研。

## 4. 交互设计

### 4.1 添加与目录树

```
[输入磁力链接 / 选择 .torrent] → 解析中（加载态 + 取消按钮）
  ↓ 元数据到达
目录树（虚拟滚动）：
  [✓] BigBuckBunny.mp4    1.2G    ⬇下载  ▶预览
  [ ] poster.jpg          300K    ⬇下载  🖼预览
  [ ] sample.wav          50M     ⬇下载  ▶预览
  [ ] nfo.txt             2K      ⬇下载  📄预览
顶栏：全选 / 下载所选 / 合计大小 / 目标目录选择
```

- 磁力冷门资源元数据可能耗时数秒~数十秒：必须有加载态与超时（默认 30s）取消机制。
- 媒体类型按扩展名分级：
  - 直接可播：mp4(faststart)/m4v/webm
  - 部分可播：mkv/mov（WebView 支持度不定，失败引导下载）
  - 仅下载：其余全部（图标置灰 + title 说明）
- 预览图标按类型区分：时间轴媒体（视频/音频）用 ▶，图片用图片图标，文本用文档图标。
- 文案遵循 §6「文案原则」：优先复用 `下载` `下载所选` `取消` 等现有条目，新词仅限 `预览` 等核心动作。

### 4.1.1 任务列表 = 进度 + 历史

BT 页面顶部用公共 `ToolPageHeader`（首页按钮 + 标题 + 添加），与其他工具页一致且保持紧凑。列表一栏两用：

- 未完成：`节点 N`（点开节点浮层）+ 已下载/总量 + 细进度条。
- 已完成：视为历史记录，显示总量。
- 点击标题：复用添加流程的 `AddTorrentDialog`（`initialSource` 属性传该行磁力）——跳过输入/解析 UI，直接显示加载中，后台跑 `bt_probe` 后展示文件树；勾选、目标目录、下载按钮全部保留，标题与说明仅留给读屏。`bt_tasks` 按 infohash upsert，不会多出历史记录。
- **添加前先和引擎对账**（`reconcile_before_add`）：`add_torrent` 对已管理的种子只回 `AlreadyManaged`，既不改输出目录也不改文件选择——于是「先预览、再从这一行下载」会静默失效：数据库行指向用户目录，引擎却还在往缓存目录写，面板永远停在「准备中」。规则是目标目录相同 → 只用 `Session::update_only_files` 扩大选择；目标目录不同 → 先删任务（`delete_files: false`，用户目录里的文件不动；缓存目录属于我们、直接丢弃）再重新添加，新任务用用户选的目录。
- 进度泵不再把已完成的种子永久静音：面板行可能在完成之后才注册（重开页面、任务被重新添加），而 store 会忽略已结束行的更新，所以每个 tick 都重发是安全的。前端侧按 `mode:total` 记忆已注册的任务，预览转下载或选择变多都会让 `start()` 用同 id 顶替旧行。
- 每行动作：磁力链接（由 infohash 重建 `magnet:?xt=urn:btih:…&dn=…`，可复制）、转存到本地、删除（二次确认；下载任务可勾选「删除文件」，预览缓存始终连文件删除）。

### 4.1.2 公共预览页

`/preview` 路由承载四类预览（视频/音频/图片/文本），任何模块都能复用：

| 层 | 文件 | 职责 |
|---|---|---|
| 路由 | src/routes/preview.tsx | search 参数校验；有 `hash` 走 BT，否则用现成 `url` |
| 页壳 | src/features/preview/PreviewScreen.tsx | ToolPageHeader + 预览区 + `footer` 插槽 |
| 预览体 | src/features/preview/PreviewSurface.tsx | 按 kind 渲染 video/audio/img/文本（Range 取前 128KB） |
| 类型判定 | src/lib/preview-kind.ts | 扩展名 → kind，供各模块共用 |
| BT 容器 | src/features/bt/BtPreviewScreen.tsx | 换取流地址 + 速率/节点状态栏 |

BT 侧在 footer 放 `BtStatsBar`：每 1.5s 轮询 `bt_task_stats`，显示阶段、进度、↓/↑ 速率、节点数（点开节点浮层）。速率为 0 的方向不渲染；`Seeding` 且上行为 0 时显示「已完成」而非「做种中」——引擎会一直挂着已完成的种子，小文件下完后节点数归 0 属正常，不代表卡住。`bt_stream_url` 会按需拉起引擎，因此该页可直接刷新/深链进入。页头右侧放「下载」（对当前文件调 `bt_save_to_local`，未下完则等完成后自动转存，结果由 `bt-task-event` 通知）与「关闭」（回 `/tools/bt`）。播放中的缓存条目转存后不删除，避免把正在播放的文件删掉，交给 LRU 回收。

从弹窗进入预览时会记下当前磁力（`features/bt/probe-cache.ts`，纯内存）：返回 BT 页后自动重开弹窗，文件树直接取缓存的 `bt_probe` 结果，不再重新解析。

### 4.2 节点信息（迅雷式）

两级展示：

- **传输面板行内**：`🔗 N节点` 徽章，随现有进度事件低频更新（进度 payload 附加可选 peerCount 字段，或并入 BtTaskInfo 由面板轮询）。
- **任务详情浮层**：点开后每 2s 轮询 `bt_task_detail` + `bt_task_peers`；虚拟滚动表格列：IP（脱敏，保留前两段）、客户端、下行、上行、完成度、连接状态。汇总行显示「已连接 / Tracker 可用 / DHT 节点」。
- 明细用轮询不用事件推送：peer 集合变化频繁，推流噪音大。

### 4.3 缓存管理

BT 页面底部常驻：配额数值、当前占用与百分比、缓存条目列表（名称、大小、`使用中` 徽章、单条删除）、一键清空（无缓存任务时置灰）。播放中与 pinned 条目不可删除。

## 5. 后端设计

### 5.1 模块结构

```
src-tauri/src/bt/
├── mod.rs           # BtManager：引擎懒启动、probe/add/control/list、流地址签发
├── probe.rs         # 元数据解析：.torrent 字节 / 磁力 list-only，超时控制
├── stats.rs         # 进度泵（TRANSFER_PROGRESS）+ 单任务实时状态
├── stream_server.rs # loopback HTTP Range 流服务（token 防护）
├── cache.rs         # 配额、LRU 淘汰、缓存条目枚举、转存本地
└── models.rs        # IPC DTO（specta）
```

命令实现在 `src-tauri/src/commands/bt.rs`，命名遵循 `动词_名词`；全部走 `#[tauri::command] #[specta::specta]` 并登记 `collect_commands![]`。

### 5.2 IPC 命令

```ts
bt_probe(source) -> BtProbeResult              // 磁力 URI 或 .torrent 路径 → infohash/名称/文件列表
bt_add_download(source, fileIndices, destDir)  // 传统下载；幂等由 bt_tasks 表保证
bt_ensure_preview(source, fileIndex)           // 确保存在可流式播放的缓存任务
bt_stream_url(infohash, fileIndex) -> string   // http://127.0.0.1:{port}/{token}/…；按需拉起引擎
bt_save_to_local(infohash, destDir, fileIndex?)// fileIndex 只导出种子中的这一个文件（预览页传正在播的那个）；
                                               // 缺省则导出全部已选文件。单文件复制，多文件打 tar.gz（见 §3.4）
bt_list() -> BtTaskInfo[]                      // 含 mode、pinned、进度、已连接节点数
bt_task_stats(infohash) -> BtTaskStats         // 阶段、进度、上下行速率、节点数（预览页轮询）
bt_task_peers(infohash) -> BtPeerInfo[]        // 单节点明细（IP 脱敏、客户端、上下行、状态）
bt_control(infohash, action, deleteFiles)      // Pause | Resume | Remove
bt_cache_stats() -> BtCacheStats               // 占用、配额、条目数
bt_cache_items() -> BtCacheItem[]              // 缓存条目（名称、大小、最近使用、pinned、使用中）
bt_set_cache_quota(bytes)
bt_clear_cache() -> number                     // 返回清除的任务数
```

任务阶段等状态用 `BtTaskState` 枚举跨 IPC，中文文案留在前端（i18n 可切换）。

事件：

- `TRANSFER_PROGRESS`（共享主题，id 带 `bt:` 前缀）
- `bt://task-event`（转存结果：`saved` / `save-failed:{原因}`）

### 5.3 流媒体服务

- 自建最小 loopback HTTP 服务（复用 `lan_transfer/http_io.rs` 的 Range 响应经验，代码独立不共用进程端口），只绑 `127.0.0.1` 随机端口。
- 数据源：librqbit 对未完成文件的随机读能力（stream/piece read API）；服务端在读时把请求区间对应的 piece 提升为高优先级并阻塞等待就绪。
- 响应头：正确的 `Content-Type`、`Accept-Ranges: bytes`、`Content-Range`；对 mp4 追加建议缓存头。
- URL 含随机 token 段（进程启动时生成），防本机其他进程随意探测。
- 播放地址仅在播放会话期间有效，页面卸载/停止播放后可失效。

### 5.4 错误与边界

- 生产路径禁止 `.unwrap()/.expect()/panic!`；错误经统一 `AppError` 跨 IPC 返回，信息可诊断、不含敏感值。
- 引擎重活均在 tokio 线程池；IPC 命令只做调度与查询，不做长阻塞。
- 应用退出路径：优雅关闭 Session（可配置是否做种收尾），确保 fastresume 写盘。

## 6. 前端设计

```
src/features/bt/
├── BtTool.tsx                # 页面骨架（桌面守卫在路由薄壳处理）
├── components/
│   ├── AddTorrentBar.tsx     # 磁力输入 / .torrent 选择、剪贴板磁链识别
│   ├── TorrentFileTree.tsx   # 目录树 + 勾选 + 行内操作（@tanstack/react-virtual 虚拟化）
│   ├── ProbeLoading.tsx      # 元数据加载态 / 超时重试
│   └── VideoPlayerDialog.tsx # <video> 封装：缓冲态、起播门槛、错误降级引导
├── store.ts                  # probe 结果、播放会话、缓存统计的本地状态
└── media-type.ts             # 扩展名 → 类型/可播分级（纯函数，放 feature 内或 lib）
```

- 路由：`src/routes/` 新增薄壳路由 + 平台守卫（desktop only），首页入口注册。
- 任务列表不新建组件，复用 TransferPanel + 徽章扩展。
- 所有用户可见文案走 Lingui（`<Trans>` / ``t`...` ``），新增文案后跑 `pnpm run extract && pnpm run compile && pnpm build`。
- 图标按钮一律带 title/aria-label；颜色只用语义 token。

### 文案原则

**优先复用现有 msgid，新文案从简（短语化，不写长句）。**

已确认可直接复用（zh-CN 现有条目）：`下载` `下载所选` `暂停` `继续` `取消` `重试` `完成` `失败` `准备中` `传输` `设置` `保存到` `删除` `复制`。

BT 新增文案控制在一组核心词内，例如：

| 场景 | 文案 |
|---|---|
| 添加入口 | `磁力链接或种子文件`（占位符） |
| 预览动作 | `预览` |
| 缓存徽章 | `在线预览` |
| 元数据阶段 phase | `获取资源信息…` |
| 校验 phase | `校验中` |
| 节点徽章 | `{n} 节点` |
| 节点浮层汇总 | `已连接 {n}` `可用 {n}` |

extract 后若发现与现有条目语义重复，合并复用而非新增。

## 7. 播放体验与多路缓冲

分三层，P2 先做第一层，P3 做后两层：

1. **piece 调度（引擎内置）**：stream 读区间自动高优先级；顺序下载保证磁盘顺序写。
2. **起播门槛**：首帧所需字节（含 moov，若在尾部则首尾并行）就绪后才 autoplay，之前显示缓冲进度；目标首帧时间 < 3s（良好种子网络下）。
3. **自适应预读窗口**（自研，作用于读取侧批量预取）：按当前吞吐动态调整预读时长（30~60s 起）；窗口末端 piece 进入 endgame 多 peer 并发请求，避免慢速 peer 卡尾。seek 时丢弃旧窗口、重建新窗口并立即提升新位置优先级。

播放器/下载统计（P3）：下载任务节点面板（§4.2）；播放时叠加 peer 数、速度、缓冲健康度，帮助理解卡顿原因。

## 8. 分期实施

### P0 — 引擎 POC ✅ 已完成（go）

- `Cargo.toml` 加 `librqbit = { version = "9.0.1", default-features = false, features = ["rust-tls"] }`（关默认特性：去 openssl 与无关的 http-api-client）。`cargo check --all-targets` 与 `cargo test --locked` 全绿。
- POC 代码：`src-tauri/examples/bt_poc.rs`（P1 落地后已删除，验证结论保留于此）。

实测结论（Big Buck Bunny 263MB 磁力，live=42 peers，debug 构建）：

| 指标 | 结果 |
|---|---|
| 依赖树 | 干净；reqwest 统一 0.13.4，无新增 C++/openssl |
| 磁力元数据就绪 | 1.4s（热种子） |
| `stream()` 打开开销 | ~35µs |
| TTFB（前 256KB） | 620ms |
| seek 到 50% 后首 256KB | 2.8s（含预读窗口重建与补连 peer，速度随后爬升至 ~18MB/s） |
| 二次运行（续传） | 已下载数据 µs 级命中，无需重校验 |

API 关键确认：

- `ManagedTorrent::stream(file_id) -> FileStream`（`AsyncRead + AsyncSeek`），属核心能力，不需要 `http-api` 特性。loopback 服务直接基于它实现。
- 引擎已内置三层缓冲的第一层：每流 **32MB 滑动优先级窗口**、多流交错调度、**文件首尾 piece 优先**（`FileInfo::iter_piece_priorities`，恰好覆盖 mp4 moov 在尾部的场景）。P3 只需做读取侧自适应预读与起播门槛。
- 节点统计现成可用：`stats().live.snapshot.peer_stats.{live, connecting, queued, dead}` → 「N 节点」徽章与详情浮层的数据源。
- 幂等语义坑：重加磁盘已有文件的任务必须 `overwrite: true`（否则报 File exists）；fastresume 续传依赖该选项。P1 封装时应用层恒传 true，幂等由任务管理保证。

### P1 — 核心下载 ✅ 已完成（待真机联调）

已落地：
- 后端：`src-tauri/src/bt/`（mod.rs 引擎封装 + models.rs DTO）、`commands/bt.rs` 四命令、`storage/bt.rs` bt_tasks 表；进度泵 1s 轮询经共享事件通道推送，`TransferProgress.finished` 驱动前端自动完成。
- 传输体系：emit 函数提升至 `src-tauri/src/transfer.rs`；事件常量更名 `TRANSFER_PROGRESS`（wire 值不变）；store 增加 source/mode 字段；面板显示 BT 徽章。
- 前端：`features/bt/`（BtTool + AddTorrentDialog + TorrentFileList）、路由 `/tools/bt`、首页入口（desktop only）。
- 已知留待项：传输面板对 BT 任务暂不渲染暂停/取消按钮（注册时 cancellable:false），控制按钮接入 `bt_control` 放到 P2 一并做。

原计划内容（供回归对照）：

### P2 — 在线播放 ✅ 已完成（待真机播放联调）

已落地：
- 后端：`bt/stream_server.rs` —— loopback 流服务（随机端口 + 路径 token，只绑 127.0.0.1），支持 `bytes=a-b / a- / -N` 三种 Range，数据源为引擎 `FileStream`（读端阻塞到 piece 就绪，天然边下边播 + seek）；Content-Type 经 mime_guess。
- 播放源解析：`ensure_preview_task` —— 已有任务直接复用（含已完成的传统下载，从磁盘直读）；无任务则建缓存任务（`cache/{infohash}/`，仅选该文件）。infohash 离线可得：本地 .torrent 直接解析，磁力取 urn:btih（仅 v1 40 hex）。
- 前端：文件行「▶在线预览」按钮 → `VideoPlayerDialog`（缓冲中遮罩 / waiting 事件驱动 / 失败降级提示）；预览任务进传输面板带「在线预览」徽章。
- 清理：删除 P0 遗留 `examples/bt_poc.rs` 与 dev-dependencies。

**待真机验证**（本机开发环境无法覆盖）：
- [ ] WebView 从应用源加载 `http://127.0.0.1` 视频流不被拦截（CSP 为 null；Windows 为 http 源、macOS 为自定义协议源，理论上均放行）。若被拦，备选：Tauri 自定义协议注册 stream handler，或收紧 CSP 显式允许 `connect-src http://127.0.0.1:*`。
- [ ] mp4 边下边播起播时间、seek 到未下载区域的恢复速度。
- [ ] mkv 在当前系统 WebView 的实际表现（失败应走降级文案）。

原计划内容（供回归对照）：

### P3 — 缓存管理与优化 ✅ 已完成（待真机联调）

已落地：
- **LRU 缓存池**：`bt/cache.rs` —— 配额存 app_meta（默认 5GB，页面可调）；淘汰粒度整个种子；豁免 pinned 与有活跃播放连接的任务（stream_server 连接计数 `ActiveStreams`）；新增预览任务时触发回收。
- **缓存转本地**：`bt_save_to_local` —— 已完成即时复制（预览任务转存后脱离缓存池，下载任务等同导出）；未完成 pin + 完成观察器自动搬移，结果经 `bt://task-event` 通知前端 toast。
- **面板控制接入**：传输面板对 `bt:` 任务渲染暂停/继续/取消按钮（取消 = 删除任务；预览任务连带清缓存文件，下载任务保留用户文件）。
- **节点明细**：`bt_task_peers` 返回脱敏 IP、客户端、累计上下行（引擎 `per_peer_stats_snapshot`）。
- 模块拆分：mod.rs(571) / cache.rs(416) / stream_server.rs(289) / probe.rs(86) / models.rs(71)。
- 页内缓存管理条（占用/配额/清空），暂放 BT 页底部而非全局设置页——设置页当前只有菜单入口，待有面板布局后再迁。

未做（记录为后续可选）：
- 节点明细浮层 UI（命令已备，前端表格待做）
- 自适应预读窗口调优（引擎 32MB 窗口 + 首尾优先已覆盖主要场景）

原计划内容（供回归对照）：

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| librqbit 大版本破坏性变更频繁 | 锁定 `=9.*`；升级视为独立任务回归测试 |
| 磁力冷启动慢（DHT 找 peer） | probe 超时可取消；UI 明示「正在寻找节点」；文档说明预期 |
| NAT 无端口映射导致 peer 少 | 开启 UPnP 自动映射；失败不影响功能仅影响速度 |
| WebView 格式支持差异（mkv 等） | 可播性三级分类，失败降级引导下载后外部打开 |
| Windows 防火墙弹窗 | 首次启动说明文案；监听端口固定以便规则配置 |
| 内容合规 | 功能页显著位置加「请遵守当地法律法规」提示；不做任何资源推荐/搜索 |
| 移动端后台限制 | 已决策桌面优先；移动端入口暂缓 |

## 10. 验证清单（手工测试矩阵）

- 单文件种子 / 多文件种子 / 纯磁力（热、冷各一）
- 勾选部分文件下载，校验只有所选文件生成
- 暂停 → 继续 → 重启应用续传（fastresume 生效，不重头校验）
- mp4 边下边播：起播、顺播、随机 seek、拖到未下载区域
- mkv 播放失败降级路径
- 缓存淘汰：超配额后最久未访问种子被清、播放中种子不被清
- 缓存转本地：已完成（即时复制）/ 未完成（完成后自动移动）
- 转存产物形态：预览页「下载」得到的是正在播的那个单文件原名副本（不是压缩包、不含目标目录里的无关文件）；列表行转存多文件才得到 `{任务名}.tar.gz`
- 转存 toast 只出现一次（事件是唯一来源；页面重挂载不应让订阅泄漏成多次提示）
- 先预览再从同一条记录「勾选全部 + 下载」到用户目录：面板离开「准备中」并推进，文件落在所选目录而不是缓存目录
- 同一种子预览第二个文件：选择被扩大，播放不会永久停在 0
- 传输面板：BT 任务徽章、暂停继续、取消、节点数显示与详情浮层轮询、与 SFTP 任务共存
- i18n：zh-CN / en 全覆盖，无硬编码文案
