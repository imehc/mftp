# 封装脚本说明

`scripts/` 存放项目的构建与维护脚本。`package.json` 的 scripts 块是统一入口，
按 `前缀:动作` 分组；本文件记录每条命令的作用与运行时机。脚本实现以 `.mjs`
为主（跨平台 logic），平台工具链流程用 shell（如 `android.sh`）。

## 通用生命周期（不加分组前缀）

约定俗成的标准命令，CI 与规范文档直接引用，保持原名：

| 命令                                | 作用                                               | 何时运行               |
| ----------------------------------- | -------------------------------------------------- | ---------------------- |
| `pnpm dev`                          | 启动 Vite 前端开发服务器                           | 日常开发（仅前端）     |
| `pnpm build`                        | 前端资源构建（平台产物检查在 CI）                  | 验证前端构建           |
| `pnpm preview`                      | 预览 Vite 构建产物                                 | 本地验证构建结果       |
| `pnpm tauri`                        | Tauri CLI 包装；dev/build 前先执行翻译引擎源码准备 | 桌面/移动端开发与构建  |
| `pnpm test`                         | Vitest 前端单元测试                                | 功能改动后、提交前     |
| `pnpm lint` / `pnpm lint:fix`       | ESLint 检查/自动修复（含空行规范）                 | 提交前                 |
| `pnpm format` / `pnpm format:check` | Prettier 格式化/校验                               | 提交前                 |
| `pnpm commit`                       | cz-git 交互式生成符合规范的提交                    | 手动提交时             |
| `pnpm prepare`                      | 安装 simple-git-hooks 钩子                         | 首次安装依赖后自动运行 |

## check:* 一次性工程检查

只读校验，不修改任何文件；CI 在对应阶段逐步调用：

| 命令                      | 作用                                                         |
| ------------------------- | ------------------------------------------------------------ |
| `check:dev-isolation`     | 校验开发环境数据目录隔离（Node test runner）                 |
| `check:react`             | 校验 React 相关依赖版本一致性                                |
| `check:model-offline`     | 校验模型功能不引入联网依赖                                   |
| `check:build-budget`      | 校验前端构建产物体积预算（`tests/checks/build-budget.json`） |
| `check:platform`          | 校验各平台打包配置（Node test runner）                       |
| `check:platform-artifact` | 校验发布产物归属与必需文件                                   |
| `check:android-plugins`   | 校验 Android 插件注册与配置一致                              |

## android:* 已知平台（Android / iOS）

| 命令            | 作用                                           |
| --------------- | ---------------------------------------------- |
| `android:dev`   | 经 `scripts/android.sh` 启动 Android 开发构建  |
| `android:build` | 经 `scripts/android.sh` 执行 Android 构建流程  |
| `android:icons` | 生成 Android 应用图标                          |
| `ios:dev`       | 启动 iOS 开发构建（转发 `pnpm tauri ios dev`） |
| `ios:build`     | 执行 iOS 构建（转发 `pnpm tauri ios build`）   |

## 领域:动作（生成、准备、版本）

`subject:verb` 风格；前缀为操作对象，`:generate` 生成产物、`:prepare` 下载准备、
`:check` / `:bump` 校验或递增版本：

| 命令                  | 作用                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `routes:generate`     | 由 `src/routes/*.tsx` 重新生成 `routeTree.gen.ts`；新增路由后运行                                                        |
| `bindings:generate`   | 由 Rust/Specta 导出测试重新生成 `src/bindings.ts`；IPC 契约变更后运行                                                    |
| `translation:prepare` | 下载并校验 `engine.json` 固定版本的 llama.cpp 源码、应用补丁；`pnpm tauri` 包装与 CI 自动执行，直接调 Cargo 时需手动运行 |
| `version:check`       | 校验包版本在各清单文件间一致                                                                                             |
| `version:bump`        | 递增版本号并同步所有清单文件                                                                                             |

## i18n:* 国际化

| 命令           | 作用                                                        |
| -------------- | ----------------------------------------------------------- |
| `i18n:extract` | 从源码抽取/清理 Lingui 文案到 `messages.po`；文案改动后运行 |
| `i18n:compile` | 编译 `messages.po` 为 `messages.ts`（不提交生成物）         |

## skills:* 技能目录维护

| 命令            | 作用                         |
| --------------- | ---------------------------- |
| `skills:sync`   | 同步本地技能描述到项目记录   |
| `skills:update` | 经 skills CLI 更新已安装技能 |
