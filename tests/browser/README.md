# 本机验证入口

这些脚本验证当前工作区；不启动 Tauri，不操作设备，不访问系统凭据。浏览器结果不能替代真实后端、原生分享、文件关联、传感器或设备性能验收。

## 浏览器回归

前提：Node 22.19+（或满足 Vite 要求的更新 LTS）、项目指定的 pnpm、已安装项目依赖、Chrome/Chromium。无需 Plumb、Figma 或额外浏览器驱动依赖。首次克隆先执行 `pnpm install --frozen-lockfile`。

在仓库根目录运行：

```sh
pnpm qa:browser
pnpm qa:browser model-environment model-recording
```

| 组名              | 覆盖范围                                               | 限制                          |
| ----------------- | ------------------------------------------------------ | ----------------------------- |
| model-environment | HDR 解析与环境贴图                                     | 浏览器渲染，不含原生文件选择  |
| model-recording   | 实际浏览器 MP4 编码和导出数据                          | 不含原生保存/分享             |
| model-attachments | 附件交互、恶意 Markdown 纯文本展示                     | IPC/存储为隔离 mock           |
| model-system      | WebGL 上下文丢失/恢复、方向与渲染预算                  | 方向和温度为模拟输入          |
| ai-protocol       | 默认格式、添加/编辑三协议、草稿放弃、375/900px 布局    | 仅模拟 IPC，不含真实上游请求  |
| display-size      | 英文 320/767/768px、125% 显示大小、日历/虚拟列表/xterm | 不含系统字号、真实 SSH resize |

脚本创建本机回环 Vite 服务，依次启动独立无头 Chrome，保留默认沙箱与 GPU；每次使用新临时浏览器 profile。Vite 预扫描所有夹具依赖，避免首个用例因依赖优化而刷新。每组超时 180 秒，任何组失败都会返回非零退出码。仅关闭本次创建的进程。临时 profile 保留在系统临时目录，不复用日常浏览器数据。

- `QA_CHROME`：Chrome 可执行文件路径。默认查找 macOS Chrome 和 Linux 常用 Chrome/Chromium 路径；其他安装位置需显式指定。
- `QA_PORT`：独立服务端口，默认 1475，允许 1024–65535；占用即失败，不复用已有服务。
- 输出目录自动创建为系统临时目录下的 `mftp-browser-qa-*`，开头打印完整路径。包含 `summary.json`、Vite/每组日志、浏览器版本、断言 JSON 和 PNG。汇总记录 Node、时间、Git 基线及工作区是否有改动；dirty 基线不等于该提交的结果。
- 单独运行 `node tests/browser/<组名>-check.mjs` 时，需要自行启动同一 QA Vite 配置；可用 `QA_BASE_URL` 指定回环服务、`QA_OUTPUT_DIR` 指定结果目录。统一入口总是使用自己创建的服务和新结果目录。

结果目录是临时证据，应将关键结论写入验收记录；需长期保存时另行归档输出及对应源码。headless WebGL/编码能力依赖 Chrome 和运行环境，失败需检查日志，不能跳过并标成通过。

## 其他验证入口

| 范围          | 命令 / 入口                                                                                                                                                                                            | 结果含义                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| 前端逻辑      | `pnpm test`                                                                                                                                                                                            | 同目录 Vitest 测试                             |
| 静态检查      | `pnpm lint`                                                                                                                                                                                            | 含本地 UI 组件及 QA 夹具                       |
| 路由          | `pnpm routes:generate`                                                                                                                                                                                 | 官方 router-cli ESM 入口，生成契约不变         |
| 生产构建      | `pnpm build`                                                                                                                                                                                           | Lingui 编译、路由生成、类型检查、Vite 构建     |
| 产物预算      | 构建后 `pnpm build:budget`                                                                                                                                                                             | gzip 首屏、全部 JS、字体预算；不是运行内存     |
| 离线 3D       | 构建后 `pnpm model:offline-check`                                                                                                                                                                      | Three.js、补丁、解码器哈希及许可一致性         |
| Rust 普通测试 | `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`                                                                                                                                       | 普通隔离测试，不加 `--ignored`，不访问真实凭据 |
| Rust 静态检查 | `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --lib -- -D warnings`；`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`                                                         | 静态质量                                       |
| Android 插件  | `pnpm android:plugins:check`，见 [Android 环境说明](../../docs/android.md)                                                                                                                             | 隔离工程的两个 AAR 编译，不代表整包或设备能力  |
| Apple 插件    | 在配置好 Xcode 与对应 Rust target 的 macOS 执行 `cargo check --manifest-path src-tauri/Cargo.toml --locked -p tauri-plugin-native-export -p tauri-plugin-native-viewer --target aarch64-apple-ios-sim` | Swift 插件编译，不代表 iOS 运行                |

文案修改另需先执行 `pnpm extract` 并核对翻译，提交 `.po`，不提交生成的 `messages.ts`。真机验收另列计划、获确认后使用隔离应用数据和凭据。

历史证据的替代关系见 [历史验证索引](historical-index.md)。S05 远端 CI 和 D02 设计同步不在本轮收口范围。
