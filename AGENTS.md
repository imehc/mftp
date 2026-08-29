# AGENTS.md

本文件是写给 AI 编程助手看的项目规范。所有自动化编码代理在修改本项目时都应遵守这里的约定。

## 技术栈

- 本项目是 Tauri v2 跨平台桌面应用（桌面 + 移动端），前后端同仓库。
- 前端：`src/`，React 19 + TypeScript + Vite + TanStack Router + Zustand + shadcn/ui + Tailwind v4。
- 后端：`src-tauri/src/`，Rust + Tauri v2 + ssh2/libssh2。
- 包管理器：pnpm，不要用 npm/yarn。
- i18n 用 Lingui，动画用 gsap，长列表用 `@tanstack/react-virtual`。

## 目录结构

```
src/
├── bindings.ts        # specta 自动生成的 IPC 类型，禁止手改
├── types.ts           # bindings.ts 的再导出门面，新增类型改 Rust，不改这里
├── routeTree.gen.ts   # TanStack Router 自动生成，禁止手改
├── routes/            # 路由薄壳：路由定义、平台守卫、参数转交，不写业务逻辑
├── features/<name>/   # 功能模块：页面骨架、hooks、store、子组件都放这里
├── components/
│   ├── ui/            # shadcn/ui 基础组件，优先复用，不受 600 行限制
│   └── *.tsx          # 跨 feature 通用组件
├── lib/               # 跨 feature 纯工具：ipc.ts、events.ts、format.ts、platform.ts
├── store/             # 全局 Zustand store
├── i18n/              # Lingui Provider 与工具
├── locales/{zh-CN,en}/  # messages.po 是翻译源（需提交）；messages.ts 是编译产物（勿提交）
└── themes/            # 主题定义

src-tauri/src/
├── lib.rs             # specta_builder() 与 collect_commands![]，IPC 注册入口
├── commands/          # IPC 命令实现
├── error.rs           # 统一错误类型
├── models.rs          # 数据模型
└── ssh/  lan_transfer/  storage/  game_room/  poetry/   # 领域模块
```

## 编码规范

### 工作流程

非频繁改动必须先分析、再计划、后写码：

1. 读相关代码，确认职责边界、数据流、现有模式和可复用组件。
2. 判断是否会让文件超过 600 行，必要时先拆分。
3. 说明简短方案：改哪些文件、如何验证、是否引入依赖。
4. 实现后运行相关验证（见「构建与验证命令」）。

简单 typo、单行配置、小文案调整可省略正式计划，但仍要遵守文件行数、i18n 和验证要求。

### 文件行数

- `src-tauri/**/*.rs` 和 `src/**/*.{ts,tsx}` 不得超过 600 行。
- 例外：`src/components/ui/**` 下的 shadcn 组件。

### 注释

只在重要或不直观处写注释，解释「为什么」，不解释自明代码。必须注释的场景：

- 协议、状态机、并发、锁、生命周期管理。
- `cfg(mobile)`、IPC 序列化边界、Tauri 权限等容易踩坑的分支。
- 看似多余但实际必要的兼容或防御逻辑。
- 复杂正则、位运算、魔法数字。

注释语言必须统一：本项目现状以英文注释为主，新增注释默认跟随所在文件/模块的既有语言，同一文件内不要中英混用。完成一个多文件功能后，用脚本对全部新增/改动文件做一次横切扫描（注释语言、硬编码文案、行数上限），不要凭记忆抽查——前后端两侧都漏过。

### 前端

组件与架构：

- 先复用，再新建。优先级：`src/components/ui` → 已装第三方库 → 已有 feature 组件/hooks/store/lib → 新建。
- 第三次出现相似实现时，抽公共组件或 hook。
- 影响面广的问题在全局收口层处理：i18n provider、`lib/ipc.ts`、错误处理、路由配置、store。
- 同一工具实现出现第二处就抽到 `src/lib/**`。
- 平台判断用 `src/lib/platform.ts` 的现成函数，不要在组件里自行判断。

UI 与响应式：

- 页面必须兼容移动端和桌面端，移动优先，用 `sm:`/`md:`/`lg:` 向上增强。
- 保持布局紧凑、入口清晰、状态完整。
- 长列表用 `@tanstack/react-virtual` 虚拟化。
- 用户可见按钮、图标、菜单、表单控件要有可访问标签或 title。

i18n：

- 面向用户的前端文案必须走 Lingui。JSX 用 `<Trans>`，属性/toast/dialog 标题用 ``t`...` ``，非 React 渲染路径用 `translate(msg...)`。
- 表单 schema 错误文案做成接收 `t` 的 schema factory，不写成模块级固定字符串。
- `.po` 是源文件需提交；`messages.ts` 是生成物已 gitignore；`pnpm build` 会先执行 compile。
- 新增/改动文案后：`pnpm run extract && pnpm run compile && pnpm build`。

### 后端

错误处理：

- 生产路径禁止 `.unwrap()`、`.expect()`、`panic!`，用 `Result` + `?` 经统一错误类型跨 IPC 返回。
- 错误信息要可诊断，但不得泄露密钥、口令、token。

性能与边界：

- 文件系统、网络、加密、密钥、路径安全等敏感或重逻辑放后端。
- 不阻塞 async runtime，重活用 blocking 线程或独立任务。
- LAN 传输、SSH/SFTP 会话、事件监听、临时资源必须有清理路径。

数据与迁移：

- schema 变更必须版本化、幂等、向前迁移，不破坏已有用户数据。

### IPC 与类型

类型由 `specta + tauri-specta` 从 Rust 自动生成，本项目重度依赖此约定：

- 绑定产物 `src/bindings.ts` 由 `lib.rs` 的 `specta_builder()` 导出；`src/types.ts` 只是再导出门面。
- 新增命令两步走：加 `#[tauri::command] #[specta::specta]`，并加进 `collect_commands![]`，漏第二步前端看不到。
- 事件 payload 类型必须在 `specta_builder()` 里显式 `.typ::<T>()` 注册，否则不出现在 `bindings.ts`。
- `cargo test` 时会重新导出绑定（`tests::export_typescript_bindings`），后端改完跑测试即可发现不同步。
- 命令命名 `动词_名词`，如 `list_hosts`、`start_transfer`。

### 依赖策略

复杂能力优先复用成熟库。已装应优先复用：`@tanstack/react-virtual`、`@tanstack/react-table`、`@dnd-kit`、`gsap`、`qrcode.react`、`next-themes`、Lingui。

新增依赖前考虑：已有库能否覆盖、维护活跃度与稳定性、体积影响、是否涉及安全逻辑（安全相关优先成熟库）。

## 构建与验证命令

按改动范围选择验证：

- 前端改动：`pnpm build`
- i18n 文案改动：`pnpm run extract && pnpm run compile && pnpm build`
- 后端改动：`cargo check --manifest-path src-tauri/Cargo.toml`
- 后端核心逻辑：`cargo test --manifest-path src-tauri/Cargo.toml --locked`

提交前尽量完整验证：`pnpm build` + `cargo test --manifest-path src-tauri/Cargo.toml --locked`。

## Never 规则

每条背后都是真实踩坑。违反任何一条都可能导致构建失败或破坏用户数据。

生成物：

- Never 手改 `src/bindings.ts`、`src/types.ts`、`src/routeTree.gen.ts`——自动生成，源头在 Rust/路由配置。
- Never 手动提交 `src/locales/**/messages.ts`——编译产物，已 gitignore。

IPC 边界：

- Never 在组件里直接 invoke，IPC 调用集中在 `src/lib/ipc.ts`。
- Never 手写或手改前端 IPC 类型，新增类型一律改 Rust。
- Never 内联事件名字符串，统一从 `src/lib/events.ts` 引用；动态事件（如 `ssh://data/{id}`）用导出的函数生成，不在调用处拼接。
- Never 在 `collect_commands![]` 条目上写 `#[cfg]`，平台专属命令用局部 macro 按 `cfg` 选列表（见 `lib.rs` 的 `all_commands!`）。

文案与代码：

- Never 新增硬编码用户可见文案，必须走 Lingui。
- Never 生产路径使用 `.unwrap()`/`.expect()`/`panic!`。
- Never 拼接 SQL，必须参数化。

UI 与样式：

- Never 硬编码颜色/阴影/圆角（`#fff`、任意 `oklch(...)` 字面量等），必须用语义 token：Tailwind 类如 `bg-primary`、`text-muted-foreground`，或 `App.css`/`themes/presets.css` 里已定义的 CSS 变量——本项目支持多主题切换，硬编码会破坏切主题。

结构与 Git：

- Never 让源文件超过 600 行不拆分（shadcn `components/ui` 除外）。
- Never revert/reset/checkout 不是你写的未提交改动；遇到时先读懂并在其基础上继续。

## 约定与协作

### Commit 规范

- 格式：`type(scope): 中文描述`，类型：feat / fix / docs / refactor / test / chore / chore(deps)。
- 只在被明确要求时才 commit，且只 stage 自己改动且符合意图的文件。

### Code Review 标准

先列问题，按严重程度排序，给出文件和行号。重点关注：

- 行为回归和真实 bug。
- IPC 类型不一致、错误处理缺失、未处理的异步失败。
- i18n 硬编码用户文案、文件超过 600 行。
- 迁移破坏旧数据、测试或验证缺口。

如果没有发现问题，明确说明未发现阻断问题，并列出剩余风险或未跑的验证。

### 规则演进

每次 AI 犯了本文件没覆盖的错误，就在对应章节补一条规则或在 Never 规则里加一条，让这份文件随踩坑持续演进。
