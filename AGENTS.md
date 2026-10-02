# AGENTS.md

## 技术栈

- Tauri v2，支持桌面、Android、iOS；各端独立运行，不依赖另一端提供能力。
- 前端：React 19 + TypeScript + Vite + TanStack Router + Zustand。
- UI：shadcn/ui + Tailwind v4；动画用 gsap，长列表用 `@tanstack/react-virtual`。
- 后端：Rust + ssh2/libssh2 + SQLite；IPC 类型由 Specta 生成。
- 包管理器：pnpm；国际化：Lingui；前端测试：Vitest。

## 目录结构

```text
src/
├── routes/          # 路由、守卫、参数转交，不写业务逻辑
├── features/        # 按功能组织页面、组件、hooks、store
├── components/      # 跨功能组件；ui/ 为 shadcn 基础组件
├── lib/             # 公共 IPC、事件、错误、平台、文件等工具
├── store/           # 全局状态与偏好
├── locales/         # 翻译源 messages.po
├── themes/          # 主题
├── bindings.ts      # Rust/Specta 生成的 IPC 类型
├── types.ts         # 类型再导出门面
└── routeTree.gen.ts # 自动生成的路由树

src-tauri/src/
├── app/             # 命令注册、依赖装配、生命周期协调
├── modules/         # 按功能组织命令、模型、仓储和领域逻辑
├── core/            # 共用执行与资源管理
├── adapters/        # 平台与事件适配
├── error/           # 统一错误协议
└── storage/         # 数据库与迁移
```

## 编码规范

- 新功能、重构等非简单任务，先分析项目架构、职责边界与影响范围，输出独立计划文档（方案、实施阶段、验证标准），经用户确认后分阶段实施；每阶段更新进度、验证结果与剩余事项。
- 上述任务涉及 UI 调整时，先更新 Figma 设计图，完成并经用户确认后再实施对应 UI；无法连接 Figma 时明确向用户说明，不跳过设计确认。
- 简单修正可直接调整，无需计划文档或分阶段；具体任务计划、进度与实现细节不写入 AGENTS.md。
- 优先复用现有组件、工具和依赖，按职责拆分，避免重复抽象。
- TS/TSX/Rust 文件最多 600 行；shadcn `components/ui/`、`bindings.ts`、`routeTree.gen.ts` 除外。
- 前端注释用中文，Rust 注释用英文；解释非直观逻辑、协议、并发和生命周期的原因。
- 业务归所属 feature/module，公共层只放共用能力；临时状态留页面，跨页资源按自身生命周期管理。
- IPC 统一走 `src/lib/ipc.ts`，事件统一走 `src/lib/events.ts`；契约在 Rust 定义，由 Specta 自动生成前端类型。
- 新功能沿用统一注册入口：前端接入路由、模块元数据和平台守卫；后端在 `app/registry` 登记命令与事件类型，同步 `command_baseline.txt`，由 `app/services` 装配。
- 错误统一为 `AppError { kind, code, message, args }`，全链路保留；按 kind/code 判断，前端用 `describeError` 展示。业务错误用英文诊断，展示文案走 Lingui。
- 用户可见文案全部走 Lingui；提交 `messages.po`。文案改动后执行 `pnpm run extract && pnpm run compile && pnpm build`。
- UI 按已确认的设计逐模块实现，完成后同平台、尺寸、状态对照；保留已有功能、数据和偏好。
- 布局统一以 Tailwind 默认 `md`（48rem，默认字号下 768px）分界：`>= md` 为 PC 布局，`< md` 为移动布局；复用 `useDesktopLayout` 与 `md:`/`max-md:`，不覆盖默认断点；平台能力用 `platform.ts` / `cfg(mobile)` 判断，切布局不丢状态。
- UI 复用共享组件、语义 token 和尺寸变体；工具栏用 `density="adaptive"`，主要触控目标至少约 44×44 CSS px，控件有可访问标签。
- 弹窗成对底部按钮在窄屏同行等宽、桌面靠右，复用共享 Footer；返回先关顶层浮层，再回上级，保留查询与滚动位置。
- 整体缩放默认跟随系统；新增或修改页面的文字、图标、控件和间距统一使用根级 rem/尺寸 token，支持后续全局“显示大小”设置，不另设页面倍率或用固定 px 绕过缩放。
- 缩放变化同步虚拟列表测量，主要触控目标保留下限；不重复叠加系统倍率，系统安全区与键盘 inset 不随应用倍率缩放。Canvas、终端等专用内容单独明确尺寸边界。
- Android/iOS 滚动内容延伸至底部安全区，仅末尾留白，不固定遮挡或重复避让；复用 `bottomInset="scroll"` / `app-scroll-safe-end`。固定操作栏与 Portal 独立处理安全区。
- 阻塞工作放后端 blocking 管道；异步处理竞态、取消和清理，任务完成以实际 worker 退出为准。
- 数据迁移须版本化、幂等并保留用户数据；reset 与任务互斥，保留有效迁移标志；SQL 参数化。
- 修改后运行相关构建、lint 和定向测试；前端测试与源码同目录，Rust 测试放独立文件。UI 另查窄/宽屏、主题、长文案和缩放，保证键盘下操作可达。
- 后续新增或发现需要长期遵守的规范、禁止行为，及时更新本文件，合并去重，保持简洁。

## 禁止行为

- 禁止用 npm/yarn，禁止手改生成物或在前端另写 IPC 契约；不手改 `src/types.ts`，不提交 `src/locales/**/messages.ts`。
- React Compiler 已启用，禁止常规手写 `useMemo` / `useCallback` / `memo`；特殊优化须说明依据。
- 禁止 Rust 生产路径使用 `.unwrap()`、`.expect()`、`panic!`，禁止日志或错误泄露密钥、口令、token。
- 禁止按错误文案判断类别、将结构化错误转成字符串传递，或把查询失败当作数据不存在。
- 禁止失败回滚误删已有资源、擅自删除用户文件，或以破坏性操作掩盖清理失败；破坏性测试使用隔离数据。
- 禁止把设计示例数据、假系统栏或设备外框写入生产页面；不能因设计图或宽屏布局开放平台不支持的能力。
- 移动操作不能仅依赖 hover、双击、右键或外部拖入，必须有可见的等价入口。
- 禁止自动重放认证或写操作；AI 服务密钥只能覆盖、不回显，不进入公开快照，关闭或切页清理密钥输入。
- 禁止覆盖或回退他人的未提交改动；未经明确要求不 commit，仅 stage 本次改动。
- 真机测试须先列计划并获用户确认；确认前禁止自行安装、启动或操作设备验收。
- 禁止把构建通过、设计预览或浏览器模拟当作原生/真实后端验收；未测不得标记通过。
