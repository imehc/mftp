# 历史验证索引

2026-10-08 对本机 docs 下全部 Markdown 的临时路径及 Plumb 引用作只读盘点。以下文件名是本机历史记录标识；多数 docs 按仓库既定策略忽略，新克隆不保证具备这些文件。当前可执行入口及范围以 [README](README.md) 为准。

旧 `docs/qa/*-check.mjs` 与对应 HTML/TSX 的五组回归已迁入 `tests/browser`，统一运行 `pnpm qa:browser`；旧 Plumb/固定端口命令仅作历史记录。HDR、录制、附件、系统和字号夹具均进入版本控制。旧阶段一至四模型手工样本、平台关联生成工程和原生协议夹具没有被包装成新的自动化通过项；当前普通测试提供逻辑回归，历史完整场景若需重验须重建隔离夹具。

表中“存在 / 缺失 / 模式”只统计反引号内以 `/tmp/` 或 `/private/tmp/` 开头的引用；花括号、通配符等归为模式，不能当作单一文件存在证据。存在只代表本机盘点时留存，不代表内容有效或可跨机器复现。未写完整绝对路径的同目录日志、Plumb 和相对路径引用统一按历史依赖处理。原始日志和截图是输出，不要求为了复验恢复旧路径。备份不是测试入口。详细逐行盘点保留本机 `docs/project-improvement-evidence-audit.json`。

原生 SSH/LAN 临时服务、历史 iOS 配置与 FBX 验收目录仅用于解释当时结果，不能作为当前稳定入口；最终仅 macOS 原生验收时需重新列出隔离服务、数据、样本及验证标准，确认后执行。本轮没有启动这些服务或设备。设计与 Figma 文档仅纳入分类，不修改其实现或宣称 D02 完成。

| 历史记录                                                                       | 引用行数 | 存在 / 缺失 / 模式 | 当前解释或替代入口                              |
| ------------------------------------------------------------------------------ | -------- | ------------------ | ----------------------------------------------- |
| `docs/design/navigation-a/CONSISTENCY-AUDIT.md`                                | 1        | 0 / 0 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/FIGMA-SYNC.md`                                       | 5        | 0 / 1 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/IMPLEMENTATION-TO-FIGMA-PLAN.md`                     | 2        | 0 / 0 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/VALIDATION.md`                                       | 1        | 0 / 0 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/native-check/README.md`                              | 1        | 0 / 1 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/ui-refactor-7e1-ai/README.md`                        | 1        | 0 / 1 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/ui-refactor-7e1-todo/README.md`                      | 1        | 0 / 1 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/ui-refactor-7e2-backup/README.md`                    | 1        | 0 / 0 / 1          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/ui-refactor-7e2-crypto/README.md`                    | 1        | 0 / 1 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/ui-refactor-7e2-formatter/README.md`                 | 1        | 0 / 1 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/ui-refactor-7e2-home/README.md`                      | 1        | 0 / 1 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/ui-refactor-7e2-lan/README.md`                       | 1        | 0 / 1 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/ui-refactor-7e2-media/README.md`                     | 1        | 0 / 1 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/ui-refactor-7e2-ssh/README.md`                       | 1        | 0 / 1 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/ui-refactor-7e2-vault/README.md`                     | 1        | 0 / 1 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/design/navigation-a/ui-refactor-7f/NATIVE-DESKTOP-RESULTS-2026-10-02.md` | 1        | 0 / 1 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/error-handling-redesign-plan.md`                                         | 1        | 0 / 1 / 0          | 恢复备份；不是验证前置依赖                      |
| `docs/mcp-setup.md`                                                            | 7        | 0 / 0 / 0          | 设计/历史 UI；D02 保留，未重跑                  |
| `docs/model-viewer-fbx-desktop-acceptance.md`                                  | 1        | 0 / 1 / 0          | 历史原生记录；最终 macOS 验收另列计划           |
| `docs/model-viewer-stage-1-validation.md`                                      | 1        | 0 / 0 / 1          | 历史阶段结果；当前测试/构建入口见 README        |
| `docs/model-viewer-stage-2-validation.md`                                      | 1        | 1 / 0 / 0          | 历史阶段结果；当前测试/构建入口见 README        |
| `docs/model-viewer-stage-3-validation.md`                                      | 1        | 1 / 0 / 0          | 历史阶段结果；当前测试/构建入口见 README        |
| `docs/model-viewer-stage-4-validation.md`                                      | 2        | 4 / 0 / 0          | 历史阶段结果；当前测试/构建入口见 README        |
| `docs/model-viewer-stage-5-validation.md`                                      | 1        | 0 / 0 / 1          | 历史阶段结果；当前测试/构建入口见 README        |
| `docs/native-acceptance-progress.md`                                           | 8        | 0 / 9 / 0          | 历史原生记录；最终 macOS 验收另列计划           |
| `docs/project-improvement-checklist.md`                                        | 1        | 0 / 0 / 1          | 历史阶段结果；当前测试/构建入口见 README        |
| `docs/project-improvement-stage-a.md`                                          | 5        | 4 / 0 / 1          | 历史阶段结果；当前测试/构建入口见 README        |
| `docs/project-improvement-stage-b.md`                                          | 1        | 1 / 0 / 0          | 历史阶段结果；当前测试/构建入口见 README        |
| `docs/project-improvement-stage-b2-validation.md`                              | 1        | 0 / 0 / 1          | 历史阶段结果；当前测试/构建入口见 README        |
| `docs/project-improvement-stage-c.md`                                          | 7        | 5 / 0 / 9          | 当前五组浏览器入口；原生/平台生成临时夹具仅历史 |
| `docs/project-improvement-stage-d.md`                                          | 4        | 6 / 0 / 4          | 当前五组浏览器入口；原生/平台生成临时夹具仅历史 |
| `docs/updater-dialog-validation.md`                                            | 1        | 1 / 0 / 0          | 历史阶段结果；当前测试/构建入口见 README        |
