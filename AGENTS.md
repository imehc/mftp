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
- 简单修正可直接调整，无需计划文档或分阶段；具体任务计划、进度与实现细节不写入 AGENTS.md。
- 优先复用现有组件、工具和依赖，按职责拆分，避免重复抽象。
- 控件按 DESIGN.md 的页面语义、操作频率和信息密度选型；固定选项不等于分段选择。仅在适合直接切换/比较、2–5 项且放得下时使用分段，筛选工具栏和次要参数优先下拉；不得仅按数量替换。
- 新增或调整页面、布局和样式前先阅读 [DESIGN.md](DESIGN.md)，按页面类型复用共享骨架；功能完成前检查间距、密度、主题、多语言与响应式，例外写入实施计划。DESIGN.md 用 `例外：` 标注允许偏离、用 `不要：` 标注禁止做法，逐条对照。
- TS/TSX/Rust 文件最多 600 行；shadcn `components/ui/`、`bindings.ts`、`routeTree.gen.ts` 除外。
- 前端注释用中文，Rust 注释用英文；解释非直观逻辑、协议、并发和生命周期的原因。
- 业务归所属 feature/module，公共层只放共用能力；临时状态留页面，跨页资源按自身生命周期管理。
- IPC 统一走 `src/lib/ipc.ts`，事件统一走 `src/lib/events.ts`；契约在 Rust 定义，由 Specta 自动生成前端类型。
- 新功能沿用统一注册入口：前端接入路由、模块元数据和平台守卫；后端在 `app/registry` 登记命令与事件类型，同步 `command_baseline.txt`，由 `app/services` 装配。
- 错误统一为 `AppError { kind, code, message, args }`，全链路保留；按 kind/code 判断，前端用 `describeError` 展示。业务错误用英文诊断，展示文案走 Lingui。
- 用户可见文案全部走 Lingui；提交 `messages.po`。文案改动后执行 `pnpm run extract && pnpm run compile && pnpm build`。

- 阻塞工作放后端 blocking 管道；异步处理竞态、取消和清理，任务完成以实际 worker 退出为准。
- 数据迁移须版本化、幂等并保留用户数据；reset 与任务互斥，保留有效迁移标志；SQL 参数化。
- 本地维护的 `components/ui` 同样纳入 ESLint/Prettier；不再按上游组件名整目录排除。
- 修改后运行相关构建、lint 和定向测试；前端单元测试与源码同目录，Rust 测试放独立文件；工程检查放 `tests/checks/`，构建和维护工具放 `scripts/`。
- 前端测试文件中的 `describe`、`it`、`test` 标题统一使用中文。
- 前端函数体、类和类型声明、测试套件/用例/生命周期钩子之间统一空一行；连续 import、普通变量、表达式形式的箭头函数和同一函数的重载签名可紧凑排列。由 ESLint 检查/修复空行，Prettier 处理其余格式，执行 `pnpm lint:fix` 可补齐空行。
- 后续新增或发现需要长期遵守的规范、禁止行为，及时更新本文件，合并去重，保持简洁。

## 提交规范

- 完成改动后不自动提交，须向用户呈现改动摘要并等待用户手动确认后再提交；用户未确认前不执行 commit。只提交不推送，推送需用户明确要求。
- 只提交已完成的改动；仍是半成品时只暂存（`git add`）不提交，待完整后再提交。
- 按主题拆分：一个提交只做一件事，多个主题拆成多个提交，不混入无关改动。
- 采用约定式提交，类型用 `feat`、`fix`、`perf`、`refactor`、`docs`、`chore` 等，标题用中文简述，沿用仓库近期提交风格。
- 除非用户明确要求，提交信息不写测试通过、构建通过等验证结果。
- 提交和暂存只涉及本次改动涉及的文件，不覆盖或回退他人未提交的改动。

## 禁止行为

- 禁止用 npm/yarn，禁止手改生成物或在前端另写 IPC 契约；不手改 `src/types.ts`，不提交 `src/locales/**/messages.ts`。
- React Compiler 已启用，禁止常规手写 `useMemo` / `useCallback` / `memo`；特殊优化须说明依据。
- 禁止 Rust 生产路径使用 `.unwrap()`、`.expect()`、`panic!`，禁止日志或错误泄露密钥、口令、token。
- 禁止按错误文案判断类别、将结构化错误转成字符串传递，或把查询失败当作数据不存在。
- 禁止失败回滚误删已有资源、擅自删除用户文件，或以破坏性操作掩盖清理失败；破坏性测试使用隔离数据。
- 禁止自动重放认证或写操作；AI 服务密钥只能覆盖、不回显，不进入公开快照，关闭或切页清理密钥输入。
- 禁止覆盖或回退他人的未提交改动；提交和暂存只处理本次改动涉及的文件。
- 真机测试须先列计划并获用户确认；确认前禁止自行安装、启动或操作设备验收。
- 验收构建须隔离应用数据和凭据；普通自动化测试禁止访问真实系统凭据。
- 禁止把构建通过或浏览器模拟当作原生/真实后端验收；未测不得标记通过。
