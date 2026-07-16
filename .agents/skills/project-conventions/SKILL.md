---
name: project-conventions
description: "Project engineering conventions for this Tauri v2 + React app. Use when adding features, refactoring, or reviewing code in src-tauri (Rust backend) or src (React/TypeScript frontend). Enforces the 600-line file cap with functional splitting, comments on hard/important logic, analyze→plan→code workflow, component reuse, architecture-level/global fixes, local i18n (frontend), IPC contract & type sync (specta), error-handling discipline (no unwrap/panic), testing, code-style/lint gates, SQLite migrations, mobile+desktop responsive UI, and structure/performance/boundary review. Triggers on 新功能, 重构, 拆分文件, 复用, 组件, 国际化, i18n, IPC, 类型, 错误, 测试, 迁移, code review, 规范, src-tauri, features/, tsx, rs."
version: 1.0.0
---

# 项目工程规范 (Project Conventions)

> 本项目为 Tauri v2 应用：Rust 后端在 `src-tauri/src/`，React 19 + TanStack Router + Zustand + shadcn/ui + Tailwind 前端在 `src/`。所有新增/修改代码都必须遵守本规范。

## 核心工作流：先分析 → 再计划 → 后写码

任何非平凡改动（新功能、重构、跨文件修改）**禁止**直接动手写码。按顺序执行：

1. **分析 (Analyze)** — 读相关代码，弄清现有结构、数据流、边界。回答：
   - 这块逻辑属于前端还是后端？职责边界在哪？（见 [边界](#功能边界)）
   - 会不会让某个文件超过 600 行？涉及哪些模块？
   - 有没有性能热点（大列表、频繁 IPC、阻塞调用、重渲染）？
   - 已有的第三方库/工具能否复用？（见 [第三方库](#第三方库策略)）
2. **计划 (Plan)** — 输出简短方案：改哪些文件、如何拆分、用什么库、性能与边界如何处理。改动较大时用 EnterPlanMode / 让用户确认。
3. **写码 (Code)** — 按计划实现，实现后运行验证（`pnpm build` 前端类型检查、`cargo check` 后端）。

> 简单改动（改字符串、修 typo、单函数微调）可跳过正式计划，但仍要遵守行数与注释规范。

## 硬性规则：600 行文件上限

| 范围 | 上限 | 例外 |
|------|------|------|
| 后端 `src-tauri/**/*.rs` | **600 行** | 无 |
| 前端 `src/**/*.{ts,tsx}` | **600 行** | 仅 `src/components/ui/**`（shadcn 安装的组件）不限行数 |

超出即按**功能块**拆分为多个文件（不是机械地按行数切）。拆分方法见：

- 后端拆分模式 → `references/backend.md`
- 前端拆分模式 → `references/frontend.md`

**审计命令**（改动后运行，快速定位超标文件）：

```bash
bash .agents/skills/project-conventions/scripts/check_lines.sh
```

本项目当前已知超标文件（重构时优先处理，勿再往里堆代码）：
`src-tauri/src/lan_transfer.rs`、`src/features/ssh-sftp/components/sftp/SftpPanel.tsx`、`src/features/lan-transfer/LanTransferTool.tsx`。

## 注释规范

在**重要或难以理解**的地方写注释，解释「为什么」而非「做了什么」。必须加注释的情形：

- 非显而易见的算法、协议、状态机（如 LAN 传输握手、SSH/SFTP 会话生命周期）。
- 绕过陷阱的写法（并发/锁、`cfg(mobile)` 分支、IPC 序列化边界、Tauri 权限）。
- 与直觉相反或看似多余但必要的代码。
- 复杂正则、位运算、魔法数字。

不要给自解释的代码加废话注释。注释语言跟随文件既有风格（本项目中文为主）。

## 组件复用与架构级处理

**先复用，再新建。** 写任何组件/函数/store 前，先搜项目里有没有现成的或相近的。

- 有现成的直接用；有**功能相近**的，**适当调整/扩展它去适配新需求**（加 prop、抽公共部分、泛化），而不是复制一份改。
- 优先级：`src/components/ui`（shadcn 基础件）→ 已装第三方库 → 项目内已有 feature 组件/hooks/store/`lib` 工具 → 才考虑新建。
- 出现第三份相似实现时，说明该抽公共组件/hook 了。

**以架构和全局的方式处理问题，不要局部打补丁。** 遇到问题先判断它是不是某类问题的一个实例：

- 同类问题反复出现 → 在架构层一次性解决（统一封装、抽公共层、全局配置），而非每处各修一遍。
- 跨组件共享的状态/逻辑上移到 `store/`、`lib/`、公共 hook，而非层层透传或到处复制。
- 影响面广的改动（IPC 约定、错误处理、主题、i18n、路由）优先在收口层（`lib/ipc.ts`、`error.rs`、全局 provider）改，让全局自动受益。
- 权衡时说明为何选架构级方案，避免过度设计——只在有复用/扩散迹象时上抽象。

## 国际化 (i18n)

**面向用户的文案统一走 i18n，禁止在组件里硬编码可见字符串。** 国际化主要在前端。

> 现状：项目**尚无 i18n**，文案硬编码中文（如 `AppSettingsMenu.tsx`、`HomePage.tsx`）。因此按下面方式**建立机制 + 渐进迁移**——新代码一律用 i18n；改到旧文件时顺手把该文件的文案迁走。

- **方案定为 Lingui**（`@lingui/core` + `@lingui/react` + `@lingui/vite-plugin`）：本地词典编译进 bundle、不依赖远程加载；宏在编译期做类型安全与缺失翻译检查；ICU MessageFormat 原生支持复数/日期/数字;体积小、tree-shaking 好，契合 Vite + 桌面应用打包。
- Vite 集成：装 `@lingui/vite-plugin` 与 macro 支持（`babel-plugin-macros` 或 SWC 对应插件），在 `vite.config.ts` 挂上；`lingui.config.ts` 配 locales 与提取路径。
- 结构：`src/i18n/` 存配置与 provider，`src/locales/{zh-CN,en}/` 存 `.po`（编译产物 `.ts`）；按 feature 组织 message，避免单文件超 600 行。
- 组件里用宏（`` t`开始传输` ``、`<Trans>`）而非硬编码字面量；语言切换用全局 `I18nProvider`，联动已有 `store/settings.ts` 与 `next-themes` 持久化。
- 复数/日期/数字/字节大小用 ICU 或 `Intl`，不用字符串拼接组句；预留 RTL。

## IPC 契约与类型同步

本项目重度依赖 Tauri IPC，前后端类型必须严格对齐。

> 现状：Rust `models.rs` 与前端 `src/types.ts` **手动同步**，改一边漏另一边会导致 IPC 静默出错、编译期抓不到。这是最该根治的一类问题（属于[架构级处理](#组件复用与架构级处理)）。
- **方案定为 specta + tauri-specta**：从 Rust 类型/命令自动生成 TS 绑定，单一事实来源，编译期对齐。落地前需装依赖、动 `lib.rs`，作为独立任务推进；未落地前手动同步 `models.rs` ↔ `types.ts` 时，两边必须同一次改动一起改。
- 命令命名统一约定（如动词_名词 `list_hosts`、`start_transfer`），参数/返回值走生成类型，不用 `any`。
- 事件名集中为常量/枚举（前后端各一处），禁止散落字符串字面量。
- 所有 IPC 调用收口于 `lib/ipc.ts`，组件不直接散调 `@tauri-apps/api`；错误统一经 `error.rs` 映射为前端可读信息。

## 错误处理纪律

- **后端生产路径禁止 `.unwrap()` / `panic!` / `.expect()`**（仅测试代码、或逻辑上绝不可能失败且已注释说明处可用）。一律 `Result` + `?`，经 `error.rs` 统一错误类型返回，避免一个 panic 崩掉整个 app。
- 错误信息要可诊断：带上下文（哪个主机/路径/操作），但**不落密钥、口令、token 明文**。
- 前端对每个可能失败的 IPC 调用都要处理错误态（`try/catch` + `sonner` 友好提示），不留未捕获 rejection。

## 测试规范

不强求全覆盖（桌面工具类应用 ROI 有限），但守住底线：

- **核心业务逻辑必须有单元测试**：LAN 传输协议、SFTP 路径处理、storage 迁移/读写等纯逻辑。
- 新功能补测试，修 bug 先写复现测试再修。
- 后端用 Rust 内置 `#[cfg(test)]`（`cargo test`）；前端配 **Vitest**（+ Testing Library 测关键交互）。
- 纯逻辑与 IPC/UI 解耦，便于脱离 Tauri 运行时测试。

## 代码风格与提交前检查

- 后端提交前跑 `cargo fmt` + `cargo clippy`（clippy 警告尽量清零）。
- 前端配 **ESLint + Prettier**（或 Biome，二选一），提交前 format + lint。
- 提交前完整验证链：`cargo fmt && cargo clippy && cargo test`（后端）、`pnpm build`（前端类型检查）+ 相关测试。
- 这些工具项目当前**尚未配置**，需先落地工具链再强制执行；未配置前至少保持风格与既有代码一致。

## 数据与持久化 (SQLite)

- schema 变更要**版本化 + 向前迁移**（参考已有 `migrate_legacy_json`），绝不破坏用户已有数据；迁移要幂等、可回滚思路清晰。
- 迁移逻辑加注释说明「从什么版本到什么版本、为什么」。
- SQL 用参数化查询，杜绝拼接注入。

## 第三方库策略

**复杂实现优先考虑第三方库能否解决，再决定是否自己写。** 遇到有一定复杂度的功能（解析、协议、算法、动画、虚拟化、拖拽、加密等），第一步先调研成熟库，能用现成的就别重复造轮子；自研只在没有合适库、或库明显过重/不契合时才做，并说明理由。

**已装库先复用：**
- 前端：`@tanstack/react-virtual`（长列表虚拟化）、`@tanstack/react-table`、`@dnd-kit`（拖拽）、`gsap`（动画）、`qrcode.react`、`next-themes`。
- 后端：优先 crates.io 上成熟 crate。

**引入新依赖前，逐条把关（不满足就换库或自研）：**

1. **稳定 + 活跃** — 近期有维护提交/发布、issue 有人响应、版本已趋稳定（避免 0.x 早期或长期停更的库）；有一定下载量/使用面，避免小众未验证的库。
2. **体积小** — 优先轻量库，警惕引入庞大依赖树。前端先看 [bundlephobia](https://bundlephobia.com/) 的打包体积与传递依赖；能按需引入/tree-shaking 的优先。桌面应用体积敏感，一个大库要有足够充分的理由。
3. **单一职责** — 选做好一件事的小而专库，而非大而全的框架式全家桶；只为一个小功能拉进一整套生态属于过度依赖。
4. **无现成替代** — 确认项目已装库与已有 `lib/` 工具都覆盖不了（见 [组件复用](#组件复用与架构级处理)）。
5. **向用户说明** — 引入前简述：为什么需要、选它而非替代品的理由、体积与维护状况。

> 权衡时：功能核心且复杂 → 倾向成熟库；边角小功能且库过重 → 倾向自研小工具函数。安全相关（加密、鉴权、解析不可信输入）尤其**不要自己造轮子**，用经审计的成熟库。

## UI 样式与响应式（前端必读）

页面除 PC 端外**必须适配移动端**。基调：布局紧凑、简约大方、交互自然、入口清晰。

- 移动优先：默认写窄屏样式，用 Tailwind `sm: md: lg:` 向上增强；不要只写桌面布局。
- 布局紧凑：合理的间距/密度，避免大片留白与超宽行；列表/表格在窄屏下降级为卡片或可横滑。
- 入口清晰：主操作按钮显眼，次要操作收进菜单；触摸目标 ≥ 44px。
- 交互自然：加载/空/错误三态齐全（用 `empty`、`sonner` 等已有组件），过渡不突兀。
- 无障碍：语义标签、`aria-*`、键盘可达、可见焦点环。
- 复用 `src/components/ui` 里的 shadcn 组件，别重复造基础控件。

详细规则见 `references/frontend.md`。

## 结构 / 性能 / 边界 检查清单

每次改动收尾时逐项自检：

**结构**
- [ ] 无文件超过 600 行（shadcn ui 除外）
- [ ] 按功能块组织，命名清晰，无循环依赖
- [ ] 关注点分离：UI ↔ 状态 ↔ IPC ↔ 业务逻辑分层

**性能**
- [ ] 长列表用虚拟化（`react-virtual`）；避免全量重渲染（`memo`/稳定引用/`useCallback`）
- [ ] IPC 调用不在渲染/循环里高频触发；大数据流用 event/channel 而非轮询
- [ ] 后端避免阻塞 async runtime；重活放到 `spawn_blocking`/独立线程
- [ ] 无内存泄漏（事件监听、会话、临时文件都要清理）

**功能边界**
- [ ] 敏感/重逻辑放后端（文件系统、网络、加密、密钥），前端只做展示与编排
- [ ] 错误跨 IPC 边界正确传递（统一 `error.rs` → 前端友好提示）
- [ ] 输入校验、路径安全、权限（Tauri capabilities）到位
- [ ] `#[cfg(mobile)]` / 桌面专属能力有正确分支

**IPC / 类型 / 错误**
- [ ] 前后端类型对齐（`models.rs` ↔ `types.ts` 同步改，或走 specta 生成）
- [ ] IPC 调用收口于 `lib/ipc.ts`，事件名用常量而非散字符串
- [ ] 后端生产路径无 `.unwrap()`/`panic!`；错误经 `error.rs`，不泄密钥/口令
- [ ] 前端每个 IPC 调用都处理了错误态

**测试 / 质量**
- [ ] 核心业务逻辑有测试；改 bug 先写复现测试
- [ ] 提交前跑过 fmt / clippy / lint 与相关验证链
- [ ] SQLite schema 变更做了版本化迁移，未破坏旧数据

**复用 / 架构 / i18n**
- [ ] 先搜了现有组件/hook/工具，能复用则复用，相近的适当调整而非复制
- [ ] 同类问题在架构/全局层统一解决，未局部打补丁
- [ ] 面向用户的新文案走 i18n，无硬编码可见字符串

## 参考文档

- `references/backend.md` — Rust 后端拆分、性能、边界模式
- `references/frontend.md` — React 前端拆分、响应式、性能模式

> 本项目同时用 Claude Code 与 Codex；两者都通过 `.agents/skills/` 加载本技能，规则一致。
