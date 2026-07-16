# 前端规范 (React / TypeScript / src)

## 600 行拆分模式

上限 600 行，**唯一例外**是 `src/components/ui/**`（shadcn 安装的组件）。超标时按功能块拆分，本项目已有目录范例：`src/features/ssh-sftp/` 下按 `components/{hosts,keys,sftp,terminal}/` 分子域，`store/` 按领域分 store。

拆分方向（按优先级）：

1. **抽子组件**：把大 `.tsx` 里独立的 UI 区块拆成子组件文件，放到该 feature 的 `components/` 下。
2. **抽 hooks**：把状态/副作用/IPC 逻辑抽成 `useXxx.ts`（如 `hooks/useTransfer.ts`）。
3. **抽工具/类型**：纯函数进 `lib/` 或本地 `utils.ts`，类型进 `types.ts`。
4. **状态入 store**：跨组件共享的状态放 Zustand `store/`，别层层 props 透传。

**优先重构对象**：`SftpPanel.tsx`（1810 行）、`LanTransferTool.tsx`（828 行）应拆分为子组件 + hooks。

## 分层与边界

- **路由**（`routes/`）：仅装配页面，薄。
- **feature 组件**（`features/`）：页面/业务 UI，按功能域组织。
- **状态**（`store/`）：Zustand，跨组件共享状态与动作。
- **IPC**（`lib/ipc.ts`）：所有 `invoke`/event 封装收口于此，组件不直接散调 Tauri API。
- **UI 基础件**（`components/ui/`）：shadcn，优先复用，不要重复造。

业务/敏感逻辑归后端，前端负责展示与编排。错误统一走 toast（`sonner`）等友好提示。

## IPC / 类型 / 错误

- 所有 `invoke`/event 收口于 `lib/ipc.ts`，组件不直接散调 `@tauri-apps/api`；事件名用常量而非字面量。
- 前后端类型对齐：改到跨 IPC 的数据结构时，`src/types.ts` 必须与 Rust `models.rs` 同步（未来走 specta 生成，见 backend.md）。不用 `any`。
- 每个可能失败的 IPC 调用都要 `try/catch` 处理错误态并给 `sonner` 提示，不留未捕获 rejection。

## 测试

- 关键交互与纯逻辑用 **Vitest**（+ Testing Library）测；修 bug 先写复现测试。
- 提交前：ESLint + Prettier（或 Biome）format/lint，`pnpm build` 过类型检查。

## 响应式与样式（硬性）

页面除 PC 外**必须适配移动端**。基调：紧凑、简约大方、交互自然、入口清晰。

- **移动优先**：默认写窄屏，用 `sm: md: lg:` 向上增强。
- **紧凑布局**：克制留白与行宽；宽表格/多列在窄屏降级为卡片或可横向滚动（`scroll-area`）。
- **入口清晰**：主操作显眼固定，次要操作收进 `dropdown-menu`；触摸目标 ≥ 44px。
- **三态齐全**：加载 / 空（`empty`）/ 错误都要有，不留白屏。
- **交互自然**：过渡与动画克制（可用 `gsap`），不喧宾夺主；`next-themes` 支持深浅色。
- **无障碍**：语义标签、`aria-*`、键盘可达、可见焦点环、对比度达标。

## 性能

- 长列表用 `@tanstack/react-virtual`（已装），不要渲染上千 DOM 节点。
- 用 `React.memo` / `useMemo` / `useCallback` 保持引用稳定，避免不必要重渲染；注意 Zustand selector 精确订阅。
- IPC 调用别放在渲染路径或高频循环里；进度类数据用后端 event 推送订阅，而非前端轮询。
- 及时清理 event 监听、定时器、xterm 实例等副作用（`useEffect` cleanup）。
- 大组件用动态 `import()` / 路由级懒加载减小首屏。

## 组件复用与架构级处理

- **先复用后新建**：写组件/hook/工具前先搜 `components/ui`、已有 `features/*/components`、`store/`、`lib/`。有现成的直接用。
- **相近功能适当调整**：功能相似的组件通过加 prop / 抽公共部分 / 泛化来适配新需求，不要复制改。第三份相似实现出现时就抽公共件。
- **全局收口**：IPC 走 `lib/ipc.ts`，共享状态进 `store/`，通用逻辑进 hook/`lib/`；影响面广的改动在收口层改一次让全局受益，避免逐处打补丁。

## 国际化 (i18n)

- 面向用户的文案一律走 i18n，组件内只用 key，不写死字面量。国际化主要在前端。
- 项目当前无 i18n（文案硬编码中文）：**新代码必须用 i18n**；改到旧文件时顺手迁移该文件文案。
- 方案定为 **Lingui**（`@lingui/core`/`@lingui/react`/`@lingui/vite-plugin`）：本地词典编译进 bundle、编译期类型安全与缺失翻译检查、ICU 复数、tree-shaking、Vite 原生集成。组件里用 `` t`...` `` / `<Trans>` 宏，不写死字面量。
- 结构：`lingui.config.ts` 配置，`src/i18n/` 放 provider，`src/locales/{zh-CN,en}/` 放消息目录（按 feature 组织，防单文件超 600 行）。
- 语言偏好走全局 `I18nProvider` + `store/settings.ts` 持久化；复数/日期/数字/字节格式用 ICU 或 `Intl`，不靠字符串拼接组句。

## 第三方库

复用已装的 `react-virtual`、`react-table`、`@dnd-kit`、`gsap`、`qrcode.react`、`react-resizable-panels`。新增依赖前确认无现成方案，锁定精确版本并说明理由。

## 注释

复杂状态机、竞态处理、IPC 序列化约定、绕坑写法处写「为什么」注释。参见 SKILL.md。
