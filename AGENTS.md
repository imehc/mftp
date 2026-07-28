# AGENTS.md

本文件是本仓库的项目级 agent 规范。所有自动化编码代理在修改本项目时都应遵守这里的约定。

## 项目概览

本项目是 Tauri v2 桌面应用。

- 前端：`src/`，React 19 + TypeScript + Vite + TanStack Router + Zustand + shadcn/ui + Tailwind v4 + Lingui。
- 后端：`src-tauri/src/`，Rust + Tauri v2 + ssh2/libssh2。
- 前端通过 `src/lib/ipc.ts` 调用 Tauri IPC；不要在组件里散落直接 IPC 调用。

## 工作流程

非频繁改动必须先分析、再计划、后写码。

1. 读相关代码，确认职责边界、数据流、现有模式和可复用组件。
2. 判断是否会让文件超过 600 行，必要时先拆分。
3. 说明简短方案：改哪些文件、如何验证、是否引入依赖。
4. 实现后运行相关验证。前端至少跑 `pnpm build`；后端改动至少跑 `cargo check` 或更具体的测试。

简单 typo、单行配置、小文案调整可以省略正式计划，但仍要遵守文件行数、i18n 和验证要求。

## 硬性规则

### 文件行数

- `src-tauri/**/*.rs` 不得超过 600 行。
- `src/**/*.{ts,tsx}` 不得超过 600 行。
- 例外：`src/components/ui/**` 下的 shadcn 组件不受此限制。

### 不要破坏用户改动

工作区可能有用户或其他工具产生的未提交改动。不要 revert、reset、checkout 你没写的内容。遇到相关改动时先读懂并在其基础上继续。

### 注释

只在重要或不直观处写注释，解释“为什么”，不要解释自明代码。

必须注释的场景：

- 协议、状态机、并发、锁、生命周期管理。
- `cfg(mobile)`、IPC 序列化边界、Tauri 权限等容易踩坑的分支。
- 看似多余但实际必要的兼容或防御逻辑。
- 复杂正则、位运算、魔法数字。

## 前端规范

### 组件与架构

- 先复用，再新建。
- 优先级：`src/components/ui` → 已装第三方库 → 项目内已有 feature 组件/hooks/store/lib → 新建。
- 第三次出现相似实现时，应抽公共组件或 hook。
- 影响面广的问题要在全局收口层处理，例如 i18n provider、`lib/ipc.ts`、错误处理、路由配置、store。

### UI 与响应式

- 页面必须兼容移动端和桌面端。
- 移动优先，用 Tailwind `sm:`、`md:`、`lg:` 向上增强。
- 保持布局紧凑、入口清晰、状态完整。
- 长列表使用虚拟化，优先复用 `@tanstack/react-virtual`。
- 使用已有 shadcn/ui 基础组件，不重复造基础控件。
- 用户可见按钮、图标、菜单、表单控件要有可访问标签或 title。

### i18n

面向用户的前端文案必须走 Lingui，禁止新增硬编码可见字符串。

当前结构：

- Lingui 配置：`lingui.config.ts`
- Provider 与工具：`src/i18n/`
- 翻译源文件：`src/locales/{zh-CN,en}/messages.po`
- 编译产物：`src/locales/{zh-CN,en}/messages.ts`

规则：

- `.po` 是源文件，需要提交。
- `messages.ts` 是 `pnpm run compile` 生成物，已加入 `.gitignore`，不要手动提交。
- `pnpm build` 会先执行 `pnpm run compile`。
- JSX 文案用 `<Trans>...</Trans>`。
- 属性、toast、dialog 标题等字符串用 Lingui macro 的 ``t`...` ``。
- store、工具函数等非 React 渲染路径用 `translate(msg...)`。
- 表单 schema 中的错误文案不要写成模块级固定字符串；应做成接收 `t` 的 schema factory。
- 新增/改动文案后运行：

```bash
pnpm run extract
pnpm run compile
pnpm build
```

## 后端规范

### 错误处理

- 生产路径禁止 `.unwrap()`、`.expect()`、`panic!`。
- 使用 `Result` 和 `?`，通过统一错误类型跨 IPC 返回。
- 错误信息要可诊断，但不得泄露密钥、口令、token。

### 性能与边界

- 文件系统、网络、加密、密钥、路径安全等敏感或重逻辑放后端。
- 不要阻塞 async runtime；重活使用合适的 blocking 线程或独立任务。
- LAN 传输、SSH/SFTP 会话、事件监听、临时资源必须有清理路径。

### 数据与迁移

- schema 变更必须版本化、幂等、向前迁移。
- 不破坏已有用户数据。
- SQL 必须参数化，禁止拼接注入。

## IPC 与类型

本项目重度依赖 Tauri IPC，前后端类型必须同步。

- Rust 类型在 `src-tauri/src/`，前端类型在 `src/types.ts`。
- 未引入自动绑定前，修改 IPC 类型时必须同步修改 Rust 和 TypeScript。
- IPC 调用集中在 `src/lib/ipc.ts`。
- 事件名应集中管理，不要散落字符串字面量。
- 命令命名保持动词_名词风格，例如 `list_hosts`、`start_transfer`。

长期方向：用 `specta + tauri-specta` 从 Rust 自动生成 TS 绑定，避免手动同步遗漏。未落地前不要假设类型会自动同步。

## 依赖策略

复杂能力优先复用成熟库，避免重复造轮子。

已装且应优先复用的前端库：

- `@tanstack/react-virtual`
- `@tanstack/react-table`
- `@dnd-kit`
- `gsap`
- `qrcode.react`
- `next-themes`
- `Lingui`

新增依赖前必须考虑：

- 是否已有库或项目工具能覆盖。
- 维护活跃度、稳定性、体积、职责边界。
- 是否会显著增加 bundle 或桌面包体积。
- 是否涉及安全相关逻辑；安全相关优先成熟库。

## 测试与验证

按改动范围选择验证：

- 前端改动：`pnpm build`
- i18n 文案改动：`pnpm run extract && pnpm run compile && pnpm build`
- 后端改动：`cargo check --manifest-path src-tauri/Cargo.toml`
- 后端核心逻辑：`cargo test --manifest-path src-tauri/Cargo.toml --locked`

提交前尽量完整验证：

```bash
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

## Code Review 标准

做 review 时，先列问题，按严重程度排序，给出文件和行号。重点关注：

- 行为回归和真实 bug。
- IPC 类型不一致。
- 错误处理缺失。
- 未处理的异步失败。
- i18n 硬编码用户文案。
- 文件超过 600 行。
- 迁移破坏旧数据。
- 测试或验证缺口。

如果没有发现问题，明确说明未发现阻断问题，并列出剩余风险或未跑的验证。
