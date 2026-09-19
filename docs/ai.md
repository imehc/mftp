# 统一 AI 能力实施计划

状态：M1、M2 与 M3 已实现。首个业务用例是古诗词白话译文。服务格式只支持 Responses；Chat Completions 暂不实现。

## 原则和边界

- 用户自带服务地址、模型及 API Key。没有默认付费服务，也不在打开诗词时自动发起请求。
- 配置在设置页统一管理；业务模块只调用后端定义的任务，不在组件内发网络请求，也不接触 API Key。
- 凭据不得写入前端状态、localStorage、普通数据库、备份或日志。优先使用 macOS Keychain、Windows Credential Manager、Android Keystore、iOS Keychain；Linux 需明确验证系统 Secret Service 的可用性。平台无法提供安全存储时返回明确错误，不回退明文。
- 首个适配器通过 HTTPS 请求 `/v1/responses`；只支持 Responses，不自动降级到 Chat Completions。仅在用户明确配置本机服务时可允许 loopback HTTP；任意远端 HTTP、URL 中凭据以及重定向均拒绝。
- 生成结果标注 AI 来源，允许编辑、删除与重新生成。现有注释包仍独立展示，不被 AI 结果覆盖。
- 用户内容发送到第三方服务前必须主动点击生成。设置页面明确提示服务提供方可能收取费用；不做静默连接测试或后台批量生成。

## 数据和模块

1. `src-tauri/src/ai/`：非敏感配置、凭据访问、Responses 客户端与输出校验。请求与响应有字节/时间上限；错误可诊断但不能包含密钥或整段原文。
2. `src-tauri/src/storage/ai.rs`：主库保存非敏感配置和用户译文。译文使用作品 uid、正文指纹、语言、模式与版本关联；幂等 schema 迁移，不写入可随时删除的 `poetry.sqlite3`。
3. `src-tauri/src/commands/ai.rs` 和 `commands/poetry.rs`：配置/验证命令与诗词生成、读取、编辑、删除命令。IPC 类型来自 Rust specta；前端调用仅从 `src/lib/ipc.ts` 发起。
4. `src/features/settings/`：一个服务连接（地址、模型、Key 录入/替换/清除），保存后只返回 `hasKey`。
5. `src/features/poetry/`：原文/译文浏览及显式生成按钮，白话直译/文学意译两种模式；失败、生成中、已有用户修订的状态完整。

## 分阶段验收

### M1：统一连接

- 安全保存和删除密钥，读取配置不暴露密钥；地址验证、超时和响应上限可测试。
- Responses 请求仅发送任务允许的内容，解析 `output[].content[].output_text`，拒绝不完整、空内容或无效结构。
- 配置设置页可用。`cargo check`、相关 Rust 测试和 `pnpm build` 通过。

### M2：诗词译文

- 单篇按需生成，展示、编辑、删除；正文变动不展示旧译文。AI 结果/人工修订来源清楚，现有注释包无回归。
- 主库导出/导入有可选 AI 译文分区；凭据从不导出。同步和合集删除不会抹掉用户修订。
- 测试覆盖幂等迁移、指纹失效、同名作品不串译、失败和重复请求，并完成 i18n 提取、编译、前端构建与后端测试。

### M3：后续模块

- 不增加“任意提示词”IPC；按用途加入有限的任务类型、输入脱敏规则和结构化结果类型。（M3-1 已完成：任务策略与诗词输入白名单已收口。）
- 在验证许可后接明确允许再分发的开放译文包，记录作者、来源和许可证；不将爬取注释包当成可分发译文。
- 移动端已启用：iOS 使用系统 Keychain，Android 使用 Android Keystore；iOS ATS 和 Android 网络安全配置默认保持 HTTPS，仅为本机 loopback 服务保留 HTTP。Android 最低版本为 9（API 28）。本地模型支持与多连接管理按实际需求增加。

## 已知约束

此环境读取官方 OpenAI Docs 的 Responses 页面时被上游访问控制拦截；实施依赖本地协议契约测试，真实服务联调需用户提供其自身服务连接后进行。诗词译文默认使用 Responses 流式输出，设置中可关闭；后端消费 `response.output_text.delta` 并校验最终文本，兼容不支持流式的第三方服务。
