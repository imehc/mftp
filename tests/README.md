# 工程检查与原生手测夹具

此目录保留工程检查和原生手测样本生成器。前端单元测试与 src 源码同目录，Rust 测试放独立文件；构建、版本管理和维护工具保留在 scripts。

| 目录                       | 用途                                                   | 运行入口                                                                                                |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| checks                     | React 版本、离线解码器、产物预算、Android 插件编译检查 | `pnpm check:react`、`pnpm check:model-offline`、`pnpm check:build-budget`、`pnpm check:android-plugins` |
| [native](native/README.md) | 生成原生手测模型、环境贴图及附件样本                   | `node tests/native/generate-fixtures.mjs <空的测试目录>`                                                |

命令在仓库根目录执行。预算检查需要先构建；Android 插件环境见 [Android 说明](../docs/android.md)。原生验收需另行确认，编译通过不算原生功能通过。

待办备注编辑器的隔离构建检查：`node tests/checks/check-todo-note-editor.mjs`。使用应用的 Vite／React Compiler 配置，仅构建测试夹具到新的系统临时目录，不启动应用、不调用 IPC、不访问用户数据。输出编辑器按需加载分包大小及可供浏览器验证的静态页面路径；不代表原生剪贴板或移动端输入法验收。

待办图片剪贴板与导入竞态回归：`pnpm exec vitest run src/features/todo/notes/note-image-clipboard.test.ts src/features/todo/notes/note-imports.test.ts src/features/todo/notes/TodoNoteEditor.test.tsx`。原生剪贴板、平台检测、Canvas 和位图全部使用隔离模拟，覆盖读取期间保存门禁、迟到结果、重试、资源释放与禁止自动重复写入；不读取或修改系统剪贴板，不代表真实剪贴板验收。
